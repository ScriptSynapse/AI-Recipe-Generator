// Integration tests: the REAL Express app (backend/app.js) listening on an
// ephemeral port, driven over HTTP with fetch. Exercises cookies, status
// codes, middleware order and persistence together -- the things the
// service-level unit tests deliberately don't cover.
//
// Skipped (not failed) if `express` isn't installed, i.e. before
// `npm install`; once dependencies are installed they always run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let express = null;
try { express = require.resolve('express'); } catch { /* not installed */ }
const skip = express ? false : 'express is not installed (run npm install)';

const PASSWORD = 'correct horse battery';
const FAST_HASH = { N: 1024, r: 8, p: 1 };      // cheap scrypt so the suite stays fast

async function startServer({ auth = {} } = {}) {
  const { createApp } = require('../../backend/app');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-int-'));
  const app = createApp({ dataDir, auth: { hasherOptions: FAST_HASH, ...auth } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app, base, dataDir,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function post(base, route, body, headers = {}) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const get = (base, route, headers = {}) => fetch(`${base}${route}`, { headers });
const cookiePair = (res) => (res.headers.getSetCookie()[0] || '').split(';')[0];   // "name=value"
const tokenOf = (res) => cookiePair(res).split('=')[1];

test('register: 201, hardened cookie, no password hash, and a "role" in the body is ignored', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const res = await post(srv.base, '/api/auth/register',
    { username: 'alice_01', password: PASSWORD, role: 'ADMIN', isAdmin: true });
  assert.equal(res.status, 201);

  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(Object.keys(body.data.user).sort(), ['id', 'role', 'username']);
  assert.equal(body.data.user.role, 'USER', 'mass assignment: the client must not be able to choose its role');
  assert.equal(JSON.stringify(body).includes('scrypt'), false);

  const setCookie = res.headers.getSetCookie();
  assert.equal(setCookie.length, 1);
  assert.match(setCookie[0], /^session=[A-Za-z0-9_-]{43};/);
  for (const attr of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=']) assert.ok(setCookie[0].includes(attr), attr);
  assert.equal(setCookie[0].includes('Secure'), false, 'plain-http dev mode must not set Secure');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('/me: 200 with the cookie, 200 with a Bearer token, 401 anonymously', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const reg = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });

  const viaCookie = await get(srv.base, '/api/auth/me', { Cookie: cookiePair(reg) });
  assert.equal(viaCookie.status, 200);
  assert.equal((await viaCookie.json()).data.user.username, 'alice_01');

  const viaBearer = await get(srv.base, '/api/auth/me', { Authorization: `Bearer ${tokenOf(reg)}` });
  assert.equal(viaBearer.status, 200);

  const anon = await get(srv.base, '/api/auth/me');
  assert.equal(anon.status, 401);
  assert.deepEqual((await anon.json()).error, { code: 'AUTH_REQUIRED', message: 'Authentication required.' });
});

test('a bogus session cookie is treated as anonymous and cleared', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const res = await get(srv.base, '/api/auth/me', { Cookie: `session=${'a'.repeat(43)}` });
  assert.equal(res.status, 401);
  assert.match(res.headers.getSetCookie()[0] || '', /^session=;.*Max-Age=0/);
});

test('login: wrong password and unknown user return identical responses', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });

  const wrong = await post(srv.base, '/api/auth/login', { username: 'alice_01', password: 'not the password' });
  const unknown = await post(srv.base, '/api/auth/login', { username: 'nobody_here', password: 'not the password' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  assert.equal(wrong.headers.getSetCookie().length, 0, 'a failed login must not set a cookie');
});

test('login then logout: the cookie is expired AND the old token stops working server-side', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  const login = await post(srv.base, '/api/auth/login', { username: 'ALICE_01', password: PASSWORD });
  assert.equal(login.status, 200);
  const cookie = cookiePair(login);

  assert.equal((await get(srv.base, '/api/auth/me', { Cookie: cookie })).status, 200);

  const logout = await post(srv.base, '/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.getSetCookie()[0], /^session=;.*Max-Age=0/);

  // Replaying the stolen/old cookie after logout must fail: real revocation.
  assert.equal((await get(srv.base, '/api/auth/me', { Cookie: cookie })).status, 401);
});

test('logout works for Bearer clients and is harmless with no session at all', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const reg = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  const bearer = { Authorization: `Bearer ${tokenOf(reg)}` };

  assert.equal((await post(srv.base, '/api/auth/logout', {}, bearer)).status, 200);
  assert.equal((await get(srv.base, '/api/auth/me', bearer)).status, 401);
  assert.equal((await post(srv.base, '/api/auth/logout', {})).status, 200);
});

test('request-shape handling: 415 for non-JSON, 400 for malformed JSON / non-string fields', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);

  const asForm = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=a&password=b',
  });
  assert.equal(asForm.status, 415);
  const asText = await fetch(`${srv.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"username":"a","password":"b"}',
  });
  assert.equal(asText.status, 415, 'a cross-site <form> can only send these types; they must never authenticate');

  const malformed = await post(srv.base, '/api/auth/login', '{ not json');
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');

  for (const body of [{ username: { $ne: 1 }, password: PASSWORD }, { username: 'alice_01', password: ['x'] }, {}, []]) {
    const res = await post(srv.base, '/api/auth/login', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal((await res.json()).error.code, 'INVALID_REQUEST_SHAPE');
  }

  const withCharset = await post(srv.base, '/api/auth/register',
    { username: 'charset_ok', password: PASSWORD }, { 'Content-Type': 'application/json; charset=utf-8' });
  assert.equal(withCharset.status, 201);
});

test('registration validation: 400 for weak input, 409 for a duplicate (case-insensitive), no leaks', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);

  const weak = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: 'short' });
  assert.equal(weak.status, 400);
  assert.equal((await weak.json()).error.code, 'INVALID_PASSWORD');

  const common = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: 'Password123' });
  assert.equal(common.status, 400);

  const badName = await post(srv.base, '/api/auth/register', { username: '<script>', password: PASSWORD });
  assert.equal(badName.status, 400);
  assert.equal((await badName.json()).error.code, 'INVALID_USERNAME');

  assert.equal((await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD })).status, 201);
  const dup = await post(srv.base, '/api/auth/register', { username: 'ALICE_01', password: PASSWORD });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).error.code, 'USERNAME_TAKEN');
  const reserved = await post(srv.base, '/api/auth/register', { username: 'admin', password: PASSWORD });
  assert.equal(reserved.status, 409, 'public registration cannot claim a reserved name');
});

test('production mode: Secure cookie with the __Host- prefix, and it authenticates', { skip }, async (t) => {
  const srv = await startServer({ auth: { secureCookies: true } }); t.after(srv.close);
  const reg = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  const setCookie = reg.headers.getSetCookie()[0];
  assert.match(setCookie, /^__Host-session=/);
  assert.ok(setCookie.includes('; Secure'));
  assert.ok(setCookie.includes('Path=/'));
  assert.equal(setCookie.includes('Domain'), false, '__Host- cookies must not carry a Domain');
  assert.equal((await get(srv.base, '/api/auth/me', { Cookie: cookiePair(reg) })).status, 200);
});

test('sessions expire (injected clock): a valid cookie becomes useless after the TTL', { skip }, async (t) => {
  const clock = { t: 1_700_000_000_000 };
  const srv = await startServer({ auth: { now: () => clock.t, sessionTtlMs: 60_000 } }); t.after(srv.close);
  const reg = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  assert.match(reg.headers.getSetCookie()[0], /Max-Age=60;/);
  const cookie = cookiePair(reg);

  clock.t += 59_000;
  assert.equal((await get(srv.base, '/api/auth/me', { Cookie: cookie })).status, 200);
  clock.t += 2_000;
  assert.equal((await get(srv.base, '/api/auth/me', { Cookie: cookie })).status, 401);
});

test('existing anonymous endpoints are unaffected: validation 400 (not 401), JSON 404, static files', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);

  const generate = await post(srv.base, '/api/recipes/generate', {});
  assert.equal(generate.status, 400);
  assert.notEqual((await generate.json()).error.code, 'AUTH_REQUIRED');

  const unknown = await get(srv.base, '/api/does-not-exist');
  assert.equal(unknown.status, 404);
  const unknownBody = JSON.stringify(await unknown.json());
  assert.equal(unknownBody.includes('does-not-exist'), false, 'the 404 must not echo the requested path');

  const index = await get(srv.base, '/index.html');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
});

test('auth events are emitted for the audit log (Phase M): failure, unauthenticated access, success', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const seen = [];
  for (const name of ['auth.registered', 'auth.login_success', 'auth.login_failure', 'auth.logout', 'auth.unauthenticated_access']) {
    srv.app.locals.auth.events.on(name, (payload) => seen.push({ name, payload }));
  }
  await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  await post(srv.base, '/api/auth/login', { username: 'alice_01', password: 'wrong password!' });
  await get(srv.base, '/api/auth/me');

  assert.deepEqual(seen.map((e) => e.name), ['auth.registered', 'auth.login_failure', 'auth.unauthenticated_access']);
  assert.ok(seen[1].payload.ip, 'the client IP is captured for the audit trail');
  assert.equal(seen[2].payload.path, '/api/auth/me');
  assert.match(seen[2].payload.requestId, /^[0-9a-f-]{36}$/, 'every event carries the request id');
  assert.equal(JSON.stringify(seen).includes(PASSWORD), false);
  assert.equal(JSON.stringify(seen).includes('wrong password!'), false);
});

test('a broken session store degrades safely: anonymous features keep working, no internals leak', { skip }, async (t) => {
  const srv = await startServer(); t.after(srv.close);
  const reg = await post(srv.base, '/api/auth/register', { username: 'alice_01', password: PASSWORD });
  const cookie = cookiePair(reg);

  fs.writeFileSync(path.join(srv.dataDir, 'sessions.json'), '{ corrupted');
  const errors = t.mock.method(console, 'error', () => {});

  // A previously valid cookie is now just anonymous (fail towards LESS privilege)...
  const me = await get(srv.base, '/api/auth/me', { Cookie: cookie });
  assert.equal(me.status, 401);
  // ...anonymous endpoints are still served...
  assert.equal((await post(srv.base, '/api/recipes/generate', {})).status, 400);
  // ...the problem is logged loudly for the operator...
  assert.ok(errors.mock.callCount() >= 1);
  // ...and an operation that genuinely needs the store fails cleanly, leaking nothing.
  const login = await post(srv.base, '/api/auth/login', { username: 'alice_01', password: PASSWORD });
  assert.equal(login.status, 500);
  const text = JSON.stringify(await login.json());
  assert.equal(text.includes('sessions.json'), false);
  assert.equal(text.includes(srv.dataDir), false);
  assert.equal(fs.readFileSync(path.join(srv.dataDir, 'sessions.json'), 'utf8'), '{ corrupted',
    'the damaged file is left untouched for the operator');
});
