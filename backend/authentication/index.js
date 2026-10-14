/**
 * Composition root for authentication: builds the repositories, hasher,
 * service, cookie handling, middleware and router and hands back one
 * object. app.js calls this once; tests call it with a temp directory and
 * cheap hashing parameters.
 */
const path = require('path');
const { EventEmitter } = require('events');

const { PasswordHasher } = require('./passwordHasher');
const { UserRepository } = require('./userRepository');
const { SessionRepository } = require('./sessionRepository');
const { AuthService } = require('./authService');
const { SessionCookie } = require('./sessionCookie');
const { createAuthenticate, createRequireAuth } = require('../middleware/authenticate');
const { createAuthController } = require('../controllers/authController');
const { createAuthRouter } = require('../routes/auth');

function envSessionTtlMs() {
  const hours = Number(process.env.SESSION_TTL_HOURS);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : 8 * 60 * 60 * 1000;
}

// Idle timeout: a session unused for this long ends, even before its absolute lifetime. 0 turns it off.
function envIdleTimeoutMs() {
  const raw = process.env.SESSION_IDLE_MINUTES;
  if (raw === undefined || raw === '') return 60 * 60 * 1000;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 24 * 60) * 60 * 1000 : 60 * 60 * 1000;
}

function createAuthModule({
  dataDir,
  secureCookies = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
  sessionTtlMs = envSessionTtlMs(),
  idleTimeoutMs = envIdleTimeoutMs(),
  hasherOptions,
  now,
  events = new EventEmitter(),
  loginThrottle = null,
  authLimit,
  auditGate = null,
} = {}) {
  if (!dataDir) throw new Error('createAuthModule requires a dataDir.');

  const userRepository = UserRepository.forFile(path.join(dataDir, 'users.json'));
  const sessionRepository = SessionRepository.forFile(path.join(dataDir, 'sessions.json'));
  const passwordHasher = new PasswordHasher(hasherOptions);
  const authService = new AuthService({
    userRepository, sessionRepository, passwordHasher, events, sessionTtlMs, idleTimeoutMs, ...(now ? { now } : {}),
  });
  const sessionCookie = new SessionCookie({ secure: secureCookies });

  const authenticate = createAuthenticate({ authService, sessionCookie });
  const requireAuth = createRequireAuth({ authService });
  const controller = createAuthController({ authService, sessionCookie, loginThrottle, auditGate });
  const router = createAuthRouter({ controller, requireAuth, authLimit });

  return { authService, sessionCookie, authenticate, requireAuth, router, events };
}

module.exports = { createAuthModule };
