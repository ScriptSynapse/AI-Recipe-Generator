/**
 * AuthService -- registration, login, session validation, logout.
 * ---------------------------------------------------------------------
 * Pure business logic: no Express, no cookies, no file paths. It depends
 * on a user repository, a session repository and a password hasher that
 * are passed in (dependency injection), so it is fully unit-testable.
 *
 * Security properties (each covered by tests):
 *  - Login failure is ONE generic error for "no such user" and "wrong
 *    password" -- same code, same message -- and an unknown user still
 *    pays for a full password hash, so neither the response nor its timing
 *    reveals which usernames exist.
 *  - Session tokens are 256-bit random values; only their SHA-256 hash is
 *    stored. A fresh token is issued on every login (no session fixation).
 *  - Sessions expire; logout deletes the session server-side (real
 *    revocation, unlike a stateless token).
 *  - Public registration can only ever create role USER. Admin accounts are
 *    made by an operator via createUser().
 *  - A stored hash made with weaker parameters is upgraded after a
 *    successful login.
 *  - Events (Observer pattern, via EventEmitter) carry user ids, never
 *    passwords, tokens or the raw username that was typed. (People often
 *    paste their PASSWORD into the username box; logging what was typed
 *    would put real passwords in the audit log.) A failed login for an
 *    existing account carries that account's userId; for an unknown name
 *    it carries only a short one-way fingerprint, so repeated attempts
 *    against the same name can still be correlated. The audit logger
 *    (backend/audit) subscribes to these.
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ROLES, isValidRole } = require('./roles');
const { UsernameTakenError } = require('./userRepository');
const {
  validateUsername, validatePassword, isReservedUsername, MAX_PASSWORD_LENGTH,
} = require('./validators');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;   // 32 random bytes, base64url
const MAX_LOGIN_USERNAME_LENGTH = 64;
const FINGERPRINT_LENGTH = 12;
const TOUCH_INTERVAL_MS = 60 * 1000;           // idle-timeout activity is recorded at most once a minute

class AuthError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function toPublicUser(user) {
  return { id: user.id, username: user.username, role: user.role };
}

// A short, one-way identifier for a username that matched no account. Lets
// the audit trail show "the same unknown name was tried 40 times" without
// ever storing what was typed (which may really have been a password).
function usernameFingerprint(username) {
  return crypto.createHash('sha256').update(String(username).toLowerCase()).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

class AuthService {
  constructor({
    userRepository, sessionRepository, passwordHasher,
    events = new EventEmitter(), sessionTtlMs = 8 * 60 * 60 * 1000, idleTimeoutMs = 0, now = () => Date.now(),
  }) {
    this.users = userRepository;
    this.sessions = sessionRepository;
    this.hasher = passwordHasher;
    this.events = events;
    this.sessionTtlMs = sessionTtlMs;
    this.idleTimeoutMs = idleTimeoutMs;       // 0 = no idle timeout (only the absolute lifetime applies)
    this.now = now;
  }

  /** Public self-registration. Always role USER; logs the new user in. */
  async register(username, password, context = {}) {
    if (typeof username === 'string' && validateUsername(username).valid && isReservedUsername(username)) {
      // Same code/message as a genuinely taken name: don't publish the reserved list.
      // Burn the same CPU as a real registration first, so response time doesn't reveal it either.
      await this.hasher.verifyDummy(typeof password === 'string' ? password : '');
      throw new AuthError('USERNAME_TAKEN', 'That username is not available.', 409);
    }
    const user = await this.createUser(username, password, ROLES.USER);
    const session = this._createSession(user.id);
    this.events.emit('auth.registered', { userId: user.id, ip: context.ip, requestId: context.requestId });
    return { user: toPublicUser(user), ...session };
  }

  /** Creates an account WITHOUT logging in. Used by register() and by operator tooling for admins. */
  async createUser(username, password, role = ROLES.USER) {
    if (!isValidRole(role)) throw new RangeError('Unknown role.');
    const u = validateUsername(username);
    if (!u.valid) throw new AuthError(u.code, u.message, 400);
    const p = validatePassword(password, username);
    if (!p.valid) throw new AuthError(p.code, p.message, 400);

    const passwordHash = await this.hasher.hash(password);
    try {
      return this.users.create({
        id: crypto.randomUUID(), username, passwordHash, role, createdAt: new Date(this.now()).toISOString(),
      });
    } catch (err) {
      if (err instanceof UsernameTakenError) throw new AuthError('USERNAME_TAKEN', 'That username is not available.', 409);
      throw err;
    }
  }

  /**
   * Changes an existing account's role. Operator tooling only -- there is
   * deliberately no HTTP route to it. Because every request re-reads the
   * user's role (validateSession loads the user each time), a demotion
   * takes effect on the very next request, with no need to end sessions.
   */
  setRole(username, role, context = {}) {
    if (!isValidRole(role)) throw new RangeError('Unknown role.');
    const user = this.users.findByUsername(username);
    if (!user) throw new AuthError('USER_NOT_FOUND', 'No such user.', 404);
    if (user.role === role) return { user: toPublicUser(user), changed: false };
    this.users.updateRole(user.id, role);
    this.events.emit('auth.role_changed', {
      userId: user.id, from: user.role, to: role, actor: context.actor || 'operator', requestId: context.requestId,
    });
    return { user: { ...toPublicUser(user), role }, changed: true };
  }

  async login(username, password, context = {}) {
    const fail = (reason, identity = {}) => {
      this.events.emit('auth.login_failure', { reason, ...identity, ip: context.ip, requestId: context.requestId });
      return new AuthError('INVALID_CREDENTIALS', 'Invalid username or password.', 401);
    };

    if (typeof username !== 'string' || typeof password !== 'string'
        || username.length > MAX_LOGIN_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw fail('MALFORMED_INPUT');
    }

    const user = this.users.findByUsername(username);
    if (!user) {
      await this.hasher.verifyDummy(password);
      throw fail('UNKNOWN_USER', { usernameFingerprint: usernameFingerprint(username) });
    }
    if (!(await this.hasher.verify(password, user.passwordHash))) throw fail('BAD_PASSWORD', { userId: user.id });

    if (this.hasher.needsRehash(user.passwordHash)) {
      try {
        this.users.updatePasswordHash(user.id, await this.hasher.hash(password));
      } catch { /* upgrading the hash is best-effort; never fail a valid login over it */ }
    }

    const session = this._createSession(user.id);
    this.events.emit('auth.login_success', { userId: user.id, ip: context.ip, requestId: context.requestId });
    return { user: toPublicUser(user), ...session };
  }

  /** Returns the public user for a live session token, or null. Never throws for a bad token. */
  validateSession(token) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
    const tokenHash = hashToken(token);
    const session = this.sessions.find(tokenHash);
    if (!session) return null;
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(tokenHash);
      return null;
    }
    const nowMs = this.now();
    const lastSeen = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : session.createdAt;
    if (this.idleTimeoutMs > 0 && typeof lastSeen === 'number' && nowMs - lastSeen >= this.idleTimeoutMs) {
      this.sessions.delete(tokenHash);        // idle too long: the user must sign in again
      return null;
    }
    const user = this.users.findById(session.userId);
    if (!user) {
      this.sessions.delete(tokenHash);
      return null;
    }
    if (this.idleTimeoutMs > 0 && (typeof lastSeen !== 'number' || nowMs - lastSeen >= TOUCH_INTERVAL_MS)) {
      try { this.sessions.touch(tokenHash, nowMs); } catch { /* activity tracking never fails a request */ }
    }
    return toPublicUser(user);
  }

  /**
   * Changes the signed-in user's password. The current password must be right
   * (a stolen session alone is not enough). On success EVERY session of the
   * account is ended and a fresh one is returned for the caller's browser, so
   * anyone else holding an old session is signed out.
   */
  async changePassword(userId, currentPassword, newPassword, context = {}) {
    const fail = (reason) => {
      this.events.emit('auth.password_change_failure', { reason, userId, ip: context.ip, requestId: context.requestId });
      return new AuthError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401);
    };
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || currentPassword.length > MAX_PASSWORD_LENGTH) {
      throw fail('MALFORMED_INPUT');
    }
    const user = this.users.findById(userId);
    if (!user) throw fail('UNKNOWN_USER');
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) throw fail('BAD_PASSWORD');

    const check = validatePassword(newPassword, user.username);
    if (!check.valid) throw new AuthError(check.code, check.message, 400);
    if (newPassword === currentPassword) throw new AuthError('PASSWORD_UNCHANGED', 'Choose a password different from the current one.', 400);

    this.users.updatePasswordHash(user.id, await this.hasher.hash(newPassword));
    const revoked = this.sessions.deleteForUser(user.id);
    const session = this._createSession(user.id);
    this.events.emit('auth.password_changed', { userId: user.id, sessionsRevoked: revoked, ip: context.ip, requestId: context.requestId });
    return { user: toPublicUser(user), ...session };
  }

  logout(token, context = {}) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return;
    const tokenHash = hashToken(token);
    const session = this.sessions.find(tokenHash);
    if (!session) return;
    this.sessions.delete(tokenHash);
    this.events.emit('auth.logout', { userId: session.userId, ip: context.ip, requestId: context.requestId });
  }

  _createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const nowMs = this.now();
    const expiresAt = nowMs + this.sessionTtlMs;
    this.sessions.create(hashToken(token), { userId, createdAt: nowMs, lastSeenAt: nowMs, expiresAt }, nowMs);
    return { token, expiresAt, ttlMs: this.sessionTtlMs };
  }
}

module.exports = { AuthService, AuthError, hashToken, toPublicUser, usernameFingerprint };
