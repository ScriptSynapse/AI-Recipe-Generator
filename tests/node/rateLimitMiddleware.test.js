// Express adapters for Phase N, driven with fake req/res (no Express needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { RateLimiter } = require('../../backend/ratelimit/RateLimiter');
const { LoginThrottle } = require('../../backend/ratelimit/LoginThrottle');
const { AuditGate } = require('../../backend/ratelimit/AuditGate');
const { buildPolicies } = require('../../backend/ratelimit/policies');
const { loadConfig } = require('../../backend/config');
const { createRateLimit } = require('../../backend/middleware/rateLimit');
const { createSecurityHeaders, CSP } = require('../../backend/middleware/securityHeaders');
const { createRequestLogger } = require('../../backend/middleware/requestLogger');
const { createAuthController } = require('../../backend/controllers/authController');
const { AuthError } = require('../../backend/authentication/authService');
const { SecurityAuditLog } = require('../../backend/audit/SecurityAuditLog');
const { attachAuditLogger } = require('../../backend/audit/auditLogger');

function fakeRes() {
  const r = {
    statusCode: 200, headers: {}, body: null, listeners: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    on(ev, fn) { this.listeners[ev] = fn; },
  };
  return r;
}
const fakeReq = (over = {}) => ({ ip: '1.2.3.4', method: 'POST', originalUrl: '/api/recipes/generate', id: 'req-1', auth: null, app: { locals: {} }, headers: {}, ...over });

function setup({ limits = {}, start = 5_000_000 } = {}) {
  const clk = { t: start, now: () => clk.t };
  const events = new EventEmitter();
  const seen = []; events.on('ratelimit.exceeded', (p) => seen.push(p));
  const cfg = loadConfig({ RATE_GEN_ANON_PER_MIN: '3', RATE_GEN_USER_PER_MIN: '6', RATE_GEN_ADMIN_PER_MIN: '9', RATE_API_ANON_PER_MIN: '4', RATE_AUTH_PER_MIN: '2', ...limits });
  const rateLimit = createRateLimit({ limiter: new RateLimiter({ now: clk.now }), policies: buildPolicies(cfg.rateLimits), events, now: clk.now });
  const run = (mw, req) => { const res = fakeRes(); let nexted = false; mw(req, res, () => { nexted = true; }); return { res, nexted }; };
  return { clk, events, seen, rateLimit, run };
}

test('RM-01 allows up to the tier limit, then 429 with Retry-After and a client-safe body', () => {
  const { rateLimit, run } = setup();
  const mw = rateLimit('generate');
  for (let i = 0; i < 3; i++) assert.equal(run(mw, fakeReq()).nexted, true);
  const { res, nexted } = run(mw, fakeReq());
  assert.equal(nexted, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.ok(Number(res.headers['Retry-After']) >= 1);
  assert.equal(res.body.error.retryAfterSec, Number(res.headers['Retry-After']));
  assert.equal(JSON.stringify(res.body).includes('1.2.3.4'), false, 'does not echo the caller IP');
});

test('RM-02 informational RateLimit-* headers are present on allowed responses', () => {
  const { rateLimit, run } = setup();
  const { res } = run(rateLimit('generate'), fakeReq());
  assert.equal(res.headers['RateLimit-Limit'], '3');
  assert.equal(res.headers['RateLimit-Remaining'], '2');
  assert.ok('RateLimit-Reset' in res.headers);
});

test('RM-03 higher tiers get higher limits (anonymous 3, user 6, admin 9)', () => {
  const { rateLimit, run } = setup();
  const mw = rateLimit('generate');
  const count = (req) => { let n = 0; while (run(mw, req).nexted && n < 50) n++; return n; };
  assert.equal(count(fakeReq({ ip: '10.0.0.1' })), 3);
  assert.equal(count(fakeReq({ ip: '10.0.0.2', auth: { user: { id: 'u1', role: 'USER' } } })), 6);
  assert.equal(count(fakeReq({ ip: '10.0.0.3', auth: { user: { id: 'a1', role: 'ADMIN' } } })), 9);
});

test('RM-04 a logged-in user is keyed by id, not IP: switching IP does not reset the bucket', () => {
  const { rateLimit, run } = setup();
  const mw = rateLimit('generate');
  const user = { id: 'u1', role: 'USER' };
  for (let i = 0; i < 6; i++) run(mw, fakeReq({ ip: `10.1.1.${i}`, auth: { user } }));
  assert.equal(run(mw, fakeReq({ ip: '10.9.9.9', auth: { user } })).res.statusCode, 429);
});

test('RM-05 two anonymous callers on different IPs do not share a bucket; same IP does', () => {
  const { rateLimit, run } = setup();
  const mw = rateLimit('generate');
  for (let i = 0; i < 3; i++) run(mw, fakeReq({ ip: '5.5.5.5' }));
  assert.equal(run(mw, fakeReq({ ip: '5.5.5.5' })).res.statusCode, 429);
  assert.equal(run(mw, fakeReq({ ip: '6.6.6.6' })).nexted, true);
});

test('RM-06 classes are separate: exhausting `generate` leaves `api` untouched', () => {
  const { rateLimit, run } = setup();
  for (let i = 0; i < 4; i++) run(rateLimit('generate'), fakeReq());
  assert.equal(run(rateLimit('api'), fakeReq()).nexted, true);
});

test('RM-07 byIpOnly (auth endpoints): a logged-in user does not get a bigger/other bucket', () => {
  const { rateLimit, run } = setup();
  const mw = rateLimit('auth', { byIpOnly: true });
  const req = () => fakeReq({ auth: { user: { id: 'u1', role: 'ADMIN' } } });
  run(mw, req()); run(mw, req());
  assert.equal(run(mw, req()).res.statusCode, 429, 'limit is the auth limit (2), not the admin tier');
});

test('RM-08 the bucket refills: a refused caller is served again after Retry-After', () => {
  const { rateLimit, run, clk } = setup();
  const mw = rateLimit('generate');
  for (let i = 0; i < 3; i++) run(mw, fakeReq());
  const refused = run(mw, fakeReq()).res;
  clk.t += Number(refused.headers['Retry-After']) * 1000;
  assert.equal(run(mw, fakeReq()).nexted, true);
});

test('RM-09 refusals are audited once per interval with a suppressed count -- no log flood', () => {
  const { rateLimit, run, seen, clk } = setup();
  const mw = rateLimit('generate');
  for (let i = 0; i < 3; i++) run(mw, fakeReq());
  for (let i = 0; i < 500; i++) run(mw, fakeReq());
  assert.equal(seen.length, 1, 'one record for 500 refusals');
  assert.equal(seen[0].className, 'generate');
  assert.equal(seen[0].tier, 'anonymous');
  clk.t += 31_000;
  for (let i = 0; i < 5; i++) run(mw, fakeReq());
  assert.equal(seen.length, 2);
  assert.equal(seen[1].suppressed, 499);
});

test('RM-10 unknown class is a programming error, caught at startup', () => {
  assert.throws(() => setup().rateLimit('nope'), /Unknown rate-limit class/);
});

test('RM-11 a refused request never reaches next() and works without an event bus', () => {
  const clk = { t: 1, now: () => 1 };
  const rl = createRateLimit({ limiter: new RateLimiter({ now: clk.now }), policies: buildPolicies(loadConfig({ RATE_API_ANON_PER_MIN: '1' }).rateLimits), events: null, now: clk.now });
  const mw = rl('api');
  mw(fakeReq(), fakeRes(), () => {});
  let nexted = false; const res = fakeRes();
  mw(fakeReq(), res, () => { nexted = true; });
  assert.equal(nexted, false); assert.equal(res.statusCode, 429);
});

// ---- RATE_LIMIT reaches the audit log -------------------------------------
test('AU-01 ratelimit.exceeded becomes a RATE_LIMIT / BLOCKED audit record with no secret fields', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-audit-'));
  try {
    const events = new EventEmitter();
    const auditLog = new SecurityAuditLog({ filePath: path.join(dir, 'a.jsonl') });
    attachAuditLogger({ events, auditLog });
    events.emit('ratelimit.exceeded', { requestId: 'r1', ip: '1.2.3.4', method: 'POST', path: '/api/recipes/generate', userId: null, className: 'generate', tier: 'anonymous', limit: 5, retryAfterSec: 12, suppressed: 7 });
    events.emit('ratelimit.exceeded', { requestId: 'r2', ip: '1.2.3.4', method: 'POST', path: '/api/auth/login', className: 'login', retryAfterSec: 900, suppressed: 0 });
    const [login, gen] = auditLog.query({ limit: 10 }).events;
    assert.deepEqual([gen.type, gen.severity, gen.result, gen.ip, gen.requestId], ['RATE_LIMIT', 'MEDIUM', 'BLOCKED', '1.2.3.4', 'r1']);
    assert.deepEqual(gen.details, { class: 'generate', tier: 'anonymous', limit: 5, retryAfterSec: 12, suppressedSinceLast: 7 });
    assert.match(login.reason, /sign-in/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- security headers ------------------------------------------------------
test('SH-01 every hardening header is set; CSP forbids inline script, plugins, framing and <base>', () => {
  const res = fakeRes(); let nexted = false;
  createSecurityHeaders()(fakeReq(), res, () => { nexted = true; });
  assert.equal(nexted, true);
  const h = res.headers;
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.match(h['Permissions-Policy'], /camera=\(\)/);
  assert.equal(h['Content-Security-Policy'], CSP);
  const scriptSrc = CSP.split('; ').find((d) => d.startsWith('script-src'));
  assert.equal(scriptSrc, "script-src 'self'");
  assert.equal(/unsafe-eval/.test(CSP), false);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"]) assert.ok(CSP.includes(d), d);
});

test('SH-02 HSTS only when the deployment is HTTPS', () => {
  const plain = fakeRes(); createSecurityHeaders({ hsts: false })(fakeReq(), plain, () => {});
  const tls = fakeRes(); createSecurityHeaders({ hsts: true })(fakeReq(), tls, () => {});
  assert.equal('Strict-Transport-Security' in plain.headers, false);
  assert.match(tls.headers['Strict-Transport-Security'], /max-age=\d+/);
});

test('SH-03 the CSP matches the real frontend: no inline <script> or on* handlers in any page', () => {
  const dir = path.join(__dirname, '..', '..', 'frontend');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc=/.test(m[1]));
    assert.equal(inline.length, 0, `${f} has an inline <script>, which the CSP would block`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${f} has an inline event handler`);
  }
});

// ---- request logger --------------------------------------------------------
test('RLG-01 one JSON line per request; no query string, body, cookie or header values', () => {
  const lines = [];
  const mw = createRequestLogger({ sink: (l) => lines.push(l) });
  const req = fakeReq({ method: 'GET', originalUrl: '/api/recipes?token=SECRET123&x=1', headers: { cookie: 'sid=SECRET456', authorization: 'Bearer SECRET789' }, body: { password: 'SECRET000' }, auth: { user: { id: 'u9' } } });
  const res = fakeRes(); res.statusCode = 200;
  mw(req, res, () => {}); res.listeners.finish();
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.deepEqual([rec.method, rec.path, rec.status, rec.userId, rec.requestId], ['GET', '/api/recipes', 200, 'u9', 'req-1']);
  assert.equal(/SECRET/.test(lines[0]), false);
});

test('RLG-02 a failing sink never breaks the response', () => {
  const mw = createRequestLogger({ sink: () => { throw new Error('disk full'); } });
  const res = fakeRes(); let nexted = false;
  mw(fakeReq(), res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.doesNotThrow(() => res.listeners.finish());
});

// ---- login throttling through the controller ------------------------------
function loginSetup({ authImpl, throttleOpts = {} } = {}) {
  const calls = { login: 0 };
  const authService = {
    login: async (...a) => { calls.login++; return authImpl(...a); },
    events: new EventEmitter(),
  };
  const sessionCookie = { set() {}, clear() {}, extract: () => null };
  const loginThrottle = new LoginThrottle({ maxPerAccountIp: 3, maxPerIp: 50, ...throttleOpts });
  const events = new EventEmitter(); const seen = []; events.on('ratelimit.exceeded', (p) => seen.push(p));
  const controller = createAuthController({ authService, sessionCookie, loginThrottle, auditGate: new AuditGate() });
  const post = async (body = { username: 'bob', password: 'x' }) => {
    const req = fakeReq({ body, headers: { 'content-type': 'application/json' }, app: { locals: { events } } });
    const res = fakeRes();
    await controller.login(req, res, (e) => { throw e; });
    return res;
  };
  return { calls, post, seen, loginThrottle };
}
const bad = () => { throw new AuthError('INVALID_CREDENTIALS', 'Invalid username or password.', 401); };

test('LC-01 after N failures the next attempt is 429 and the password is NEVER checked (no scrypt work)', async () => {
  const { calls, post } = loginSetup({ authImpl: bad });
  for (let i = 0; i < 3; i++) assert.equal((await post()).statusCode, 401);
  const before = calls.login;
  const res = await post();
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.error.code, 'TOO_MANY_LOGIN_ATTEMPTS');
  assert.ok(Number(res.headers['Retry-After']) > 0);
  assert.equal(calls.login, before, 'authService.login was not called while throttled');
});

test('LC-02 a correct password is ALSO refused while throttled (no free oracle for the attacker)', async () => {
  let correct = false;
  const { post } = loginSetup({ authImpl: () => { if (!correct) bad(); return { user: { id: 'u' }, token: 't', ttlMs: 1 }; } });
  for (let i = 0; i < 3; i++) await post();
  correct = true;
  assert.equal((await post()).statusCode, 429);
});

test('LC-03 a success clears the failure count', async () => {
  let ok = false;
  const { post } = loginSetup({ authImpl: () => { if (!ok) bad(); return { user: { id: 'u' }, token: 't', ttlMs: 1 }; } });
  await post(); await post();
  ok = true; assert.equal((await post()).statusCode, 200);
  ok = false; await post(); await post();
  assert.equal((await post()).statusCode, 401, 'only 3 failures since the success, but the 3rd is still allowed to be checked');
});

test('LC-04 non-credential errors (e.g. a crash) are not counted as guesses', async () => {
  const { post, loginThrottle } = loginSetup({ authImpl: () => { throw new Error('disk exploded'); } });
  for (let i = 0; i < 5; i++) await assert.rejects(post());
  assert.equal(loginThrottle.check('1.2.3.4', 'bob').blocked, false);
});

test('LC-05 throttled refusals are audited once (not per attempt) and carry no username', async () => {
  const { post, seen } = loginSetup({ authImpl: bad });
  for (let i = 0; i < 3; i++) await post({ username: 'hunter2-typed-as-name', password: 'x' });
  for (let i = 0; i < 20; i++) await post({ username: 'hunter2-typed-as-name', password: 'x' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].className, 'login');
  assert.equal(JSON.stringify(seen[0]).includes('hunter2'), false);
});

test('LC-06 the throttle only affects the offending IP + account', async () => {
  const { loginThrottle } = loginSetup({ authImpl: bad });
  for (let i = 0; i < 3; i++) loginThrottle.recordFailure('1.2.3.4', 'bob');
  assert.equal(loginThrottle.check('1.2.3.4', 'alice').blocked, false);
  assert.equal(loginThrottle.check('4.3.2.1', 'bob').blocked, false);
});
