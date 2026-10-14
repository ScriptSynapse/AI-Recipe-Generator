// Phase T: idle session timeout, change-password (with session revocation), reserved-name timing.
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
const { createAuthController } = require('../../backend/controllers/authController');
const { MAPPINGS } = require('../../backend/audit/auditLogger');

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another long passphrase 42';
const MIN = 60 * 1000;

function setup(t, { idleMs = 30 * MIN } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { t: 1_700_000_000_000 };
  const events = new EventEmitter();
  const seen = [];
  for (const n of ['auth.password_changed', 'auth.password_change_failure']) events.on(n, (p) => seen.push([n, p]));
  const sessions = SessionRepository.forFile(path.join(dir, 'sessions.json'));
  const service = new AuthService({
    userRepository: UserRepository.forFile(path.join(dir, 'users.json')), sessionRepository: sessions,
    passwordHasher: new PasswordHasher({ N: 1024, r: 8, p: 1 }), events, sessionTtlMs: 8 * 60 * MIN, idleTimeoutMs: idleMs, now: () => clock.t,
  });
  return { clock, service, sessions, seen, dir };
}

test('SS-01 idle timeout: activity keeps a session alive; silence ends it; the absolute lifetime still applies', async (t) => {
  const { clock, service } = setup(t);
  const { token } = await service.register('alice', PASSWORD);
  clock.t += 20 * MIN; assert.ok(service.validateSession(token));      // used at +20
  clock.t += 20 * MIN; assert.ok(service.validateSession(token));      // +40: only 20 idle -> alive (activity was recorded)
  clock.t += 31 * MIN; assert.equal(service.validateSession(token), null);   // 31 idle -> ended
  assert.equal(service.validateSession(token), null);                  // and stays ended (record deleted)
});

test('SS-02 idle timeout can be turned off (0) and is not applied to sessions with no lastSeenAt until createdAt is idle', async (t) => {
  const off = setup(t, { idleMs: 0 });
  const a = await off.service.register('bob', PASSWORD);
  off.clock.t += 5 * 60 * MIN;
  assert.ok(off.service.validateSession(a.token));                      // 5 h idle, timeout disabled, TTL is 8 h

  const { clock, service, sessions } = setup(t);
  const b = await service.register('carol', PASSWORD);
  sessions.store.update((d) => { delete d.sessions[hashToken(b.token)].lastSeenAt; });   // a session written before this feature
  clock.t += 31 * MIN;
  assert.equal(service.validateSession(b.token), null);                 // falls back to createdAt
});

test('SS-03 activity writes are throttled: many requests inside a minute do not rewrite the session file', async (t) => {
  const { clock, service, sessions } = setup(t);
  const { token } = await service.register('dave', PASSWORD);
  let writes = 0;
  const original = sessions.touch.bind(sessions);
  sessions.touch = (...args) => { writes += 1; return original(...args); };
  for (let i = 0; i < 25; i += 1) { clock.t += 1000; service.validateSession(token); }   // 25 s total
  assert.equal(writes, 0);
  clock.t += 40 * 1000; service.validateSession(token);                 // > 60 s since last activity
  assert.equal(writes, 1);
});

test('SS-04 a failing activity write never fails the request', async (t) => {
  const { clock, service, sessions } = setup(t);
  const { token } = await service.register('erin', PASSWORD);
  sessions.touch = () => { throw new Error('disk full'); };
  clock.t += 5 * MIN;
  assert.ok(service.validateSession(token));
});

test('SS-05 changePassword: needs the right current password; new one must be valid and different; failures are audited without secrets', async (t) => {
  const { service, seen } = setup(t);
  const { user } = await service.register('frank', PASSWORD);
  await assert.rejects(service.changePassword(user.id, 'wrong password!!', NEW_PASSWORD), (e) => e instanceof AuthError && e.code === 'INVALID_CREDENTIALS' && e.status === 401);
  await assert.rejects(service.changePassword(user.id, PASSWORD, 'short'), (e) => e.status === 400);
  await assert.rejects(service.changePassword(user.id, PASSWORD, PASSWORD), (e) => e.code === 'PASSWORD_UNCHANGED');
  await assert.rejects(service.changePassword(user.id, PASSWORD, 'letmein1234'), (e) => e.status === 400);   // on the common-password list
  await assert.rejects(service.changePassword(user.id, PASSWORD, 'aaaaaaaaaaaa'), (e) => e.status === 400);
  await assert.rejects(service.changePassword(user.id, 5, NEW_PASSWORD), (e) => e.code === 'INVALID_CREDENTIALS');
  await assert.rejects(service.changePassword('no-such-user', PASSWORD, NEW_PASSWORD), (e) => e.code === 'INVALID_CREDENTIALS');
  const failures = seen.filter(([n]) => n === 'auth.password_change_failure');
  assert.equal(failures.length, 3);                                     // wrong password, malformed, unknown user (the 400s are validation, not auth failures)
  assert.doesNotMatch(JSON.stringify(seen), /correct horse|another long|wrong password/);
});

test('SS-06 changePassword: new password works, old one does not, ALL old sessions end, a fresh session is returned', async (t) => {
  const { service, seen } = setup(t);
  const first = await service.register('gina', PASSWORD);
  const phone = await service.login('gina', PASSWORD);
  const other = await service.register('henry', PASSWORD);              // another user is untouched
  const result = await service.changePassword(first.user.id, PASSWORD, NEW_PASSWORD, { ip: '1.2.3.4', requestId: 'r1' });
  assert.equal(service.validateSession(first.token), null);
  assert.equal(service.validateSession(phone.token), null);
  assert.ok(service.validateSession(result.token));
  assert.ok(service.validateSession(other.token));
  await assert.rejects(service.login('gina', PASSWORD), (e) => e.code === 'INVALID_CREDENTIALS');
  assert.ok((await service.login('gina', NEW_PASSWORD)).token);
  const ev = seen.find(([n]) => n === 'auth.password_changed')[1];
  assert.equal(ev.sessionsRevoked, 2);
  assert.doesNotMatch(JSON.stringify(seen), /another long|correct horse/);
});

test('SS-07 the audit log knows both new events (type, severity, no secrets)', () => {
  const ok = MAPPINGS['auth.password_changed']({ userId: 'u', sessionsRevoked: 2, requestId: 'r' });
  assert.deepEqual([ok.type, ok.severity, ok.action, ok.result], ['AUTH_SUCCESS', 'INFO', 'password_change', 'SUCCESS']);
  const bad = MAPPINGS['auth.password_change_failure']({ userId: 'u', reason: 'BAD_PASSWORD' });
  assert.deepEqual([bad.type, bad.severity, bad.result], ['AUTH_FAILURE', 'LOW', 'FAILURE']);
});

test('SS-08 reserved-username registration costs a password hash, like any other registration (no timing shortcut)', async (t) => {
  const { service } = setup(t);
  let dummyCalls = 0;
  const real = service.hasher.verifyDummy.bind(service.hasher);
  service.hasher.verifyDummy = async (...a) => { dummyCalls += 1; return real(...a); };
  await assert.rejects(service.register('admin', PASSWORD), (e) => e.code === 'USERNAME_TAKEN' && e.status === 409);
  assert.equal(dummyCalls, 1);
});

// ---- controller: shape, throttle, cookie -------------------------------------------------
function ctl(t, { throttle = null } = {}) {
  const env = setup(t);
  const cookies = [];
  const sessionCookie = { set: (res, token) => cookies.push(token), clear() {}, extract: () => null };
  const controller = createAuthController({ authService: env.service, sessionCookie, loginThrottle: throttle });
  const call = async (body, { json = true, user } = {}) => {
    const res = { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const req = { body, headers: json ? { 'content-type': 'application/json' } : {}, ip: '9.9.9.9', id: 'r', app: { locals: {} }, auth: { user } };
    await new Promise((resolve, reject) => controller.changePassword(req, res, (e) => (e ? reject(e) : resolve())).then?.(resolve, reject) ?? resolve());
    return res;
  };
  return { ...env, call, cookies };
}

test('SS-09 controller: JSON only, body shape checked, success replaces the cookie and never returns the token', async (t) => {
  const { service, call, cookies } = ctl(t);
  const { user } = await service.register('iris', PASSWORD);
  assert.equal((await call({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { json: false, user })).statusCode, 415);
  for (const bad of [null, [], { currentPassword: PASSWORD }, { currentPassword: 1, newPassword: 2 }, 'x']) {
    assert.equal((await call(bad, { user })).statusCode, 400, JSON.stringify(bad));
  }
  const wrong = await call({ currentPassword: 'nope nope nope', newPassword: NEW_PASSWORD }, { user });
  assert.equal(wrong.statusCode, 401);
  assert.equal(cookies.length, 0);
  const ok = await call({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { user });
  assert.equal(ok.statusCode, 200);
  assert.equal(cookies.length, 1);
  assert.doesNotMatch(JSON.stringify(ok.body), new RegExp(cookies[0]));
});

test('SS-10 controller: repeated wrong current passwords are throttled like logins (429 + Retry-After) before any hashing', async (t) => {
  const { LoginThrottle } = require('../../backend/ratelimit/LoginThrottle');
  const throttle = new LoginThrottle({ maxPerAccountIp: 3, maxPerIp: 50, windowMs: 15 * MIN, now: () => Date.now() });
  const { service, call } = ctl(t, { throttle });
  const { user } = await service.register('jack', PASSWORD);
  for (let i = 0; i < 3; i += 1) assert.equal((await call({ currentPassword: `wrong password ${i}`, newPassword: NEW_PASSWORD }, { user })).statusCode, 401);
  const blocked = await call({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { user });   // even the RIGHT password is refused while locked
  assert.equal(blocked.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
});
