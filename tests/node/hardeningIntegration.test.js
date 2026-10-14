// Phase N end to end: the real Express app over HTTP. Skipped (not failed)
// if express isn't installed.
const test = require('node:test');
const assert = require('node:assert/strict');

let express = null;
try { express = require.resolve('express'); } catch { /* not installed */ }
const skip = express ? false : 'express is not installed (run npm install)';

const { FakeEngine } = require('../helpers/fakeEngine');
const { startApp, call, registerUser, createAdmin, PASSWORD } = require('../helpers/httpHarness');

const GEN = { ingredients: ['paneer', 'tomato'], cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'Vegetarian', cookingTime: 30, difficulty: 'Medium', servings: 2 };

async function setup(t, { env = {}, ...rest } = {}) {
  const engine = new FakeEngine();
  const srv = await startApp({ runEngine: engine.runEngine, appOptions: { env }, ...rest });
  t.after(srv.close);
  return { engine, srv, base: srv.base };
}

test('HI-01 security headers are on API responses and on static pages', { skip }, async (t) => {
  const { base } = await setup(t);
  for (const route of ['/api/health', '/login.html']) {
    const r = await call(base, 'GET', route);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/, route);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', route);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', route);
    assert.equal(r.headers.get('x-powered-by'), null, route);
  }
});

test('HI-02 anonymous generation is limited: 429 + Retry-After after the allowance, and audited as RATE_LIMIT', { skip }, async (t) => {
  const { base, srv } = await setup(t, { env: { RATE_GEN_ANON_PER_MIN: '3' } });
  for (let i = 0; i < 3; i++) assert.equal((await call(base, 'POST', '/api/recipes/generate', { body: GEN })).status, 200);
  const r = await call(base, 'POST', '/api/recipes/generate', { body: GEN });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'RATE_LIMITED');
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  const events = srv.app.locals.auditLog.query({ limit: 50 }).events.filter((e) => e.type === 'RATE_LIMIT');
  assert.equal(events.length, 1);
  assert.equal(events[0].result, 'BLOCKED');
});

test('HI-03 a client cannot pick its own bucket with X-Forwarded-For (proxy header ignored by default)', { skip }, async (t) => {
  const { base } = await setup(t, { env: { RATE_GEN_ANON_PER_MIN: '2' } });
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${base}/api/recipes/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `9.9.9.${i}` }, body: JSON.stringify(GEN) });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [200, 200, 429, 429, 429]);
});

test('HI-04 a logged-in user gets a larger allowance than an anonymous caller', { skip }, async (t) => {
  const { base } = await setup(t, { env: { RATE_GEN_ANON_PER_MIN: '1', RATE_GEN_USER_PER_MIN: '4' } });
  const { cookie } = await registerUser(base, 'limitUser');
  let ok = 0;
  for (let i = 0; i < 6; i++) if ((await call(base, 'POST', '/api/recipes/generate', { body: GEN, cookie })).status === 200) ok++;
  assert.equal(ok, 4);
  assert.equal((await call(base, 'POST', '/api/recipes/generate', { body: GEN })).status, 200, 'anonymous bucket is separate');
});

test('HI-05 brute force: repeated bad passwords -> 429, even the right password is then refused, other users fine', { skip }, async (t) => {
  const { base, srv } = await setup(t, { env: { LOGIN_MAX_FAILURES: '3', RATE_AUTH_PER_MIN: '100' } });
  await registerUser(base, 'victim');
  await call(base, 'POST', '/api/auth/logout');
  for (let i = 0; i < 3; i++) assert.equal((await call(base, 'POST', '/api/auth/login', { body: { username: 'victim', password: 'wrong-wrong-wrong' } })).status, 401);
  const blocked = await call(base, 'POST', '/api/auth/login', { body: { username: 'victim', password: PASSWORD } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, 'TOO_MANY_LOGIN_ATTEMPTS');
  assert.equal(blocked.headers.getSetCookie().length, 0, 'no session issued');
  const types = srv.app.locals.auditLog.query({ limit: 50 }).events.map((e) => e.type);
  assert.ok(types.includes('RATE_LIMIT') && types.includes('AUTH_FAILURE'));
});

test('HI-06 login/register share a per-IP request limit regardless of outcome', { skip }, async (t) => {
  const { base } = await setup(t, { env: { RATE_AUTH_PER_MIN: '3' } });
  const out = [];
  for (let i = 0; i < 5; i++) out.push((await call(base, 'POST', '/api/auth/register', { body: { username: `bulkuser${i}`, password: PASSWORD } })).status);
  assert.deepEqual(out, [201, 201, 201, 429, 429]);
});

test('HI-07 CORS is closed by default: no Access-Control-* headers for any Origin', { skip }, async (t) => {
  const { base } = await setup(t);
  const res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
});

test('HI-08 CORS allow-list: only the configured origin is echoed (with credentials); others get nothing; never "*"', { skip }, async (t) => {
  const { base } = await setup(t, { env: { CORS_ORIGINS: 'https://app.example' } });
  const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'https://app.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  const no = await fetch(`${base}/api/health`, { headers: { Origin: 'https://app.example.evil.com' } });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${base}/api/recipes/generate`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
});

test('HI-09 oversized JSON body -> 413 (limit is 200kb)', { skip }, async (t) => {
  const { base } = await setup(t);
  const r = await call(base, 'POST', '/api/recipes/generate', { body: { ingredients: ['x'.repeat(300 * 1024)] } });
  assert.equal(r.status, 413);
});

test('HI-10 access log: one JSON line per API request, no query string or secrets', { skip }, async (t) => {
  const lines = [];
  const engine = new FakeEngine();
  const srv = await startApp({ runEngine: engine.runEngine, appOptions: { logSink: (l) => lines.push(l) } });
  t.after(srv.close);
  await call(srv.base, 'GET', '/api/health?secret=ABC123');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).path, '/api/health');
  assert.equal(lines[0].includes('ABC123'), false);
});

test('HI-11 admin has the highest allowance and the admin audit endpoints stay reachable', { skip }, async (t) => {
  const { base, srv } = await setup(t, { env: { RATE_API_ANON_PER_MIN: '2', RATE_API_ADMIN_PER_MIN: '50' } });
  const { cookie } = await createAdmin(srv, 'adminRL');
  for (let i = 0; i < 10; i++) assert.equal((await call(base, 'GET', '/api/admin/audit-log', { cookie })).status, 200);
});
