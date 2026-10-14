const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { AuthService, AuthError, hashToken } = require('../../backend/authentication/authService');
const { PasswordHasher } = require('../../backend/authentication/passwordHasher');
const { UserRepository } = require('../../backend/authentication/userRepository');
const { SessionRepository } = require('../../backend/authentication/sessionRepository');
const { ROLES } = require('../../backend/authentication/roles');

const PASSWORD = 'correct horse battery';
const HOUR = 60 * 60 * 1000;

// Builds an isolated service: temp data dir, cheap scrypt, controllable
// clock, and a recorder for every auth event.
function setup({ hasherOptions = { N: 1024, r: 8, p: 1 }, ttlMs = 8 * HOUR } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  const clock = { t: 1_700_000_000_000 };
  const events = new EventEmitter();
  const recorded = [];
  for (const name of ['auth.registered', 'auth.login_success', 'auth.login_failure', 'auth.logout']) {
    events.on(name, (payload) => recorded.push({ name, payload }));
  }
  const hasher = new PasswordHasher(hasherOptions);
  const userRepository = UserRepository.forFile(path.join(dir, 'users.json'));
  const sessionRepository = SessionRepository.forFile(path.join(dir, 'sessions.json'));
  const service = new AuthService({
    userRepository, sessionRepository, passwordHasher: hasher, events, sessionTtlMs: ttlMs, now: () => clock.t,
  });
  return {
    dir, clock, recorded, service, hasher, userRepository, sessionRepository,
    usersFile: path.join(dir, 'users.json'),
    sessionsFile: path.join(dir, 'sessions.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

async function rejectsWith(promise, code, status) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof AuthError, `expected AuthError, got ${err && err.name}`);
    assert.equal(err.code, code);
    if (status) assert.equal(err.status, status);
    return true;
  });
}

test('register creates a USER, logs them in, and never exposes the password hash', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const result = await s.service.register('alice_01', PASSWORD);
  assert.deepEqual(Object.keys(result.user).sort(), ['id', 'role', 'username']);
  assert.equal(result.user.role, ROLES.USER);
  assert.equal(result.token.length, 43);                         // 32 random bytes, base64url
  assert.equal(result.expiresAt, s.clock.t + 8 * HOUR);
  assert.equal(result.ttlMs, 8 * HOUR, 'the lifetime the cookie should carry, as a clock-independent duration');
  assert.deepEqual(s.service.validateSession(result.token), result.user);
});

test('the password is stored only as a scrypt hash, never in plaintext', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.register('alice_01', PASSWORD);
  const raw = fs.readFileSync(s.usersFile, 'utf8');
  assert.equal(raw.includes(PASSWORD), false);
  assert.match(JSON.parse(raw).users[0].passwordHash, /^scrypt\$/);
});

test('the session token is stored only as its SHA-256 hash, never raw', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const { token } = await s.service.register('alice_01', PASSWORD);
  const raw = fs.readFileSync(s.sessionsFile, 'utf8');
  assert.equal(raw.includes(token), false, 'a leaked sessions file must not contain replayable tokens');
  assert.ok(raw.includes(hashToken(token)));
});

test('usernames are unique case-insensitively; a reserved name looks exactly like a taken one', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.register('Alice_01', PASSWORD);
  await rejectsWith(s.service.register('alice_01', PASSWORD), 'USERNAME_TAKEN', 409);
  await rejectsWith(s.service.register('ALICE_01', PASSWORD), 'USERNAME_TAKEN', 409);

  const taken = await s.service.register('alice_01', PASSWORD).catch((e) => e);
  const reserved = await s.service.register('Admin', PASSWORD).catch((e) => e);
  assert.equal(reserved.code, taken.code);
  assert.equal(reserved.message, taken.message);
  assert.equal(reserved.status, taken.status);
});

test('invalid usernames and passwords are rejected with 400 and never echo the input', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await rejectsWith(s.service.register('a', PASSWORD), 'INVALID_USERNAME', 400);
  await rejectsWith(s.service.register('has space', PASSWORD), 'INVALID_USERNAME', 400);
  await rejectsWith(s.service.register('bob_02', 'short'), 'INVALID_PASSWORD', 400);
  await rejectsWith(s.service.register('bob_02', 'password123'), 'INVALID_PASSWORD', 400);
  const err = await s.service.register('bob_02', 'tooshort').catch((e) => e);
  assert.equal(err.message.includes('tooshort'), false);
  assert.equal(fs.existsSync(s.usersFile), false, 'a rejected registration must not create anything');
});

test('login: wrong password and unknown user are indistinguishable', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.register('alice_01', PASSWORD);
  const wrongPassword = await s.service.login('alice_01', 'wrong password here').catch((e) => e);
  const unknownUser = await s.service.login('nobody_here', 'wrong password here').catch((e) => e);
  for (const err of [wrongPassword, unknownUser]) assert.ok(err instanceof AuthError);
  assert.deepEqual(
    { code: wrongPassword.code, message: wrongPassword.message, status: wrongPassword.status },
    { code: unknownUser.code, message: unknownUser.message, status: unknownUser.status });
  assert.equal(wrongPassword.code, 'INVALID_CREDENTIALS');
  assert.equal(wrongPassword.status, 401);
});

test('login: an unknown user still pays for a password hash; a real user with a bad password does not need the dummy', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.register('alice_01', PASSWORD);
  let dummyCalls = 0;
  const original = s.hasher.verifyDummy.bind(s.hasher);
  s.hasher.verifyDummy = async (pw) => { dummyCalls += 1; return original(pw); };

  await s.service.login('nobody_here', 'some password here').catch(() => {});
  assert.equal(dummyCalls, 1, 'timing equalisation for unknown users');
  await s.service.login('alice_01', 'wrong password here').catch(() => {});
  assert.equal(dummyCalls, 1, 'a real account is verified against its real hash instead');
});

test('login succeeds with the right password, case-insensitively on the username', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const registered = await s.service.register('Alice_01', PASSWORD);
  const result = await s.service.login('alice_01', PASSWORD);
  assert.deepEqual(result.user, registered.user);
  assert.deepEqual(s.service.validateSession(result.token), registered.user);
});

test('every login issues a brand-new token (no session fixation)', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const first = await s.service.register('alice_01', PASSWORD);
  const second = await s.service.login('alice_01', PASSWORD);
  const third = await s.service.login('alice_01', PASSWORD);
  assert.equal(new Set([first.token, second.token, third.token]).size, 3);
  assert.ok(s.service.validateSession(first.token) && s.service.validateSession(third.token));
});

test('malformed login input is rejected generically without hashing', async (t) => {
  const s = setup(); t.after(s.cleanup);
  let hashWork = 0;
  const v = s.hasher.verify.bind(s.hasher); const d = s.hasher.verifyDummy.bind(s.hasher);
  s.hasher.verify = async (...a) => { hashWork += 1; return v(...a); };
  s.hasher.verifyDummy = async (...a) => { hashWork += 1; return d(...a); };
  for (const [u, p] of [[undefined, PASSWORD], ['alice_01', undefined], [{ $ne: 1 }, PASSWORD], ['alice_01', ['x']],
    ['x'.repeat(65), PASSWORD], ['alice_01', 'x'.repeat(129)]]) {
    await rejectsWith(s.service.login(u, p), 'INVALID_CREDENTIALS', 401);
  }
  assert.equal(hashWork, 0, 'oversized/non-string input must not trigger expensive hashing');
  assert.ok(s.recorded.every((e) => e.payload.reason === 'MALFORMED_INPUT'));
});

test('sessions expire; an expired session is rejected and removed', async (t) => {
  const s = setup({ ttlMs: HOUR }); t.after(s.cleanup);
  const { token } = await s.service.register('alice_01', PASSWORD);
  s.clock.t += HOUR - 1;
  assert.ok(s.service.validateSession(token), 'still valid just before expiry');
  s.clock.t += 1;
  assert.equal(s.service.validateSession(token), null, 'invalid at the expiry instant');
  assert.equal(s.sessionRepository.find(hashToken(token)), null, 'and purged from the store');
});

test('creating a session purges other sessions that have already expired', async (t) => {
  const s = setup({ ttlMs: HOUR }); t.after(s.cleanup);
  const old = await s.service.register('alice_01', PASSWORD);
  s.clock.t += 2 * HOUR;
  await s.service.login('alice_01', PASSWORD);
  assert.equal(s.sessionRepository.find(hashToken(old.token)), null);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(s.sessionsFile, 'utf8')).sessions).length, 1);
});

test('logout revokes the session server-side and is idempotent', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const { token } = await s.service.register('alice_01', PASSWORD);
  s.service.logout(token);
  assert.equal(s.service.validateSession(token), null);
  const eventsAfterFirst = s.recorded.filter((e) => e.name === 'auth.logout').length;
  s.service.logout(token);                       // second logout: no error, no second event
  assert.equal(s.recorded.filter((e) => e.name === 'auth.logout').length, eventsAfterFirst);
  assert.equal(eventsAfterFirst, 1);
});

test('garbage tokens validate to null and never throw', async (t) => {
  const s = setup(); t.after(s.cleanup);
  for (const bad of ['', null, undefined, 123, {}, 'short', 'a'.repeat(43), 'a'.repeat(44), '!'.repeat(43), '../../etc/passwd',
    '__proto__', 'constructor']) {
    assert.equal(s.service.validateSession(bad), null, String(bad));
    assert.doesNotThrow(() => s.service.logout(bad));
  }
});

test('a session whose user no longer exists is rejected and removed', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const { token } = await s.service.register('alice_01', PASSWORD);
  fs.writeFileSync(s.usersFile, JSON.stringify({ users: [] }));
  assert.equal(s.service.validateSession(token), null);
  assert.equal(s.sessionRepository.find(hashToken(token)), null);
});

test('createUser can make an ADMIN (operator path); register can never', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const admin = await s.service.createUser('Admin', PASSWORD, ROLES.ADMIN);   // reserved name is fine for an operator
  assert.equal(admin.role, ROLES.ADMIN);
  const login = await s.service.login('admin', PASSWORD);
  assert.equal(login.user.role, ROLES.ADMIN);
  assert.equal((await s.service.register('someone_else', PASSWORD)).user.role, ROLES.USER);
  await assert.rejects(s.service.createUser('root_user', PASSWORD, 'SUPERUSER'), RangeError);
});

test('a hash made with weaker parameters is upgraded after a successful login', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.register('alice_01', PASSWORD);                       // hashed with N=1024
  const before = s.userRepository.findByUsername('alice_01').passwordHash;
  assert.equal(before.split('$')[1], '1024');

  s.hasher.N = 2048;                                                    // operator raises the cost
  await s.service.login('alice_01', PASSWORD);
  const after = s.userRepository.findByUsername('alice_01').passwordHash;
  assert.equal(after.split('$')[1], '2048', 'stored hash upgraded');
  assert.ok(await s.service.login('alice_01', PASSWORD), 'and the password still works afterwards');
});

test('concurrent registrations of the same username: exactly one wins', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 6 }, () => s.service.register('race_user', PASSWORD)));
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  const losers = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(losers.length, 5);
  assert.ok(losers.every((o) => o.reason.code === 'USERNAME_TAKEN'));
  assert.equal(JSON.parse(fs.readFileSync(s.usersFile, 'utf8')).users.length, 1);
});

test('events: emitted for register/login/logout/failure, with no password or token in any payload', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const reg = await s.service.register('alice_01', PASSWORD, { ip: '203.0.113.7' });
  await s.service.login('alice_01', 'definitely wrong pw', { ip: '203.0.113.8' }).catch(() => {});
  await s.service.login('nobody_here', 'definitely wrong pw').catch(() => {});
  const login = await s.service.login('alice_01', PASSWORD);
  s.service.logout(login.token);

  assert.deepEqual(s.recorded.map((e) => e.name),
    ['auth.registered', 'auth.login_failure', 'auth.login_failure', 'auth.login_success', 'auth.logout']);
  assert.equal(s.recorded[0].payload.userId, reg.user.id);
  assert.equal(s.recorded[0].payload.ip, '203.0.113.7');
  assert.deepEqual(s.recorded.filter((e) => e.name === 'auth.login_failure').map((e) => e.payload.reason),
    ['BAD_PASSWORD', 'UNKNOWN_USER']);

  const everything = JSON.stringify(s.recorded);
  for (const secret of [PASSWORD, 'definitely wrong pw', reg.token, login.token]) {
    assert.equal(everything.includes(secret), false, 'secrets must never appear in event payloads');
  }
});

test('events: the raw username typed at login is NEVER recorded (people paste passwords into that box)', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const registered = await s.service.register('alice_01', PASSWORD);

  // A password typed into the username field, and a forged-log-line attempt.
  const typedPassword = 'my-real-password-1';
  const forged = 'bob\n[INFO] auth.login_success userId=admin\r\n\u0000' + 'x'.repeat(200);
  await s.service.login(typedPassword, 'some password here').catch(() => {});
  await s.service.login(forged, 'some password here').catch(() => {});
  await s.service.login('alice_01', 'a wrong password!!').catch(() => {});      // a real account, wrong password
  await s.service.login('nobody_here', 'some password here').catch(() => {});

  const failures = s.recorded.filter((e) => e.name === 'auth.login_failure').map((e) => e.payload);
  assert.equal(failures.length, 4);
  const everything = JSON.stringify(failures);
  for (const raw of [typedPassword, 'nobody_here', 'bob', 'INFO', 'alice_01']) {
    assert.equal(everything.includes(raw), false, `"${raw}" must not appear in a login-failure event`);
  }
  assert.equal(failures.some((p) => 'usernameAttempted' in p), false);

  // What IS recorded: the targeted account's id when it exists; otherwise a short one-way fingerprint.
  const badPassword = failures.find((p) => p.reason === 'BAD_PASSWORD');
  assert.equal(badPassword.userId, registered.user.id);
  assert.equal('usernameFingerprint' in badPassword, false);
  const unknown = failures.filter((p) => p.reason === 'UNKNOWN_USER');
  assert.equal(unknown.length, 2);
  for (const u of unknown) {
    assert.match(u.usernameFingerprint, /^[0-9a-f]{12}$/);
    assert.equal('userId' in u, false);
  }
  assert.notEqual(unknown[0].usernameFingerprint, unknown[1].usernameFingerprint);
});

test('events: the same unknown name always has the same fingerprint, regardless of case (so repeated attempts correlate)', async (t) => {
  const s = setup(); t.after(s.cleanup);
  await s.service.login('Ghost_Account', 'a wrong password!!').catch(() => {});
  await s.service.login('ghost_account', 'another wrong one!!').catch(() => {});
  const [a, b] = s.recorded.map((e) => e.payload.usernameFingerprint);
  assert.equal(a, b);
});

test('events: a request id supplied in the context is carried on every auth event', async (t) => {
  const s = setup(); t.after(s.cleanup);
  const ctx = { ip: '203.0.113.5', requestId: 'req-42' };
  const reg = await s.service.register('alice_01', PASSWORD, ctx);
  await s.service.login('alice_01', 'a wrong password!!', ctx).catch(() => {});
  const login = await s.service.login('alice_01', PASSWORD, ctx);
  s.service.logout(login.token, ctx);
  assert.ok(reg.token);
  assert.equal(s.recorded.length, 4);
  assert.ok(s.recorded.every((e) => e.payload.requestId === 'req-42'), JSON.stringify(s.recorded.map((e) => e.name)));
});
