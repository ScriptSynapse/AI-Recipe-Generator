/**
 * Shared helpers for tests that run the real Express app over HTTP.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSWORD = 'correct horse battery';
const FAST_HASH = { N: 1024, r: 8, p: 1 };   // cheap scrypt so suites stay fast

async function startApp({ runEngine, auth = {}, audit, appOptions = {} } = {}) {
  const { createApp } = require('../../backend/app');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-'));
  const app = createApp({ dataDir, runEngine, auth: { hasherOptions: FAST_HASH, ...auth }, ...(audit ? { audit } : {}), ...appOptions });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    app, dataDir,
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function call(base, method, route, { body, cookie, bearer } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const cookiePair = (res) => (res.headers.getSetCookie()[0] || '').split(';')[0];

/** Registers a normal USER over HTTP; resolves to { cookie, user }. */
async function registerUser(base, username) {
  const res = await call(base, 'POST', '/api/auth/register', { body: { username, password: PASSWORD } });
  if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${res.text}`);
  return { cookie: cookiePair(res), user: res.json.data.user };
}

/** Creates an ADMIN the way an operator would (no HTTP route exists), then logs in over HTTP. */
async function createAdmin(srv, username) {
  await srv.app.locals.auth.authService.createUser(username, PASSWORD, 'ADMIN');
  const res = await call(srv.base, 'POST', '/api/auth/login', { body: { username, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status} ${res.text}`);
  return { cookie: cookiePair(res), user: res.json.data.user };
}

const sampleRecipe = (overrides = {}) => ({
  name: 'Paneer Tikka', cuisine: 'Indian', ingredients: [{ name: 'paneer', quantity: 200, unit: 'g' }],
  instructions: ['Cube the paneer.', 'Grill until golden.'], ...overrides,
});

module.exports = { PASSWORD, FAST_HASH, startApp, call, cookiePair, registerUser, createAdmin, sampleRecipe };
