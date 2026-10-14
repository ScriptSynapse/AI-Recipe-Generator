// Usage counters behind the dashboard: store, recording middleware, route gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { UsageStore, recordUsage, fromRecipeResponse, fromComparisonResponse, MAX_DAYS } = require('../../backend/usage/UsageStore');
const { PERMISSIONS } = require('../../backend/authorization/permissions');
const { loadWithFakeExpress, tag, describeRoutes } = require('../helpers/fakeExpress');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-14T12:00:00Z');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = T0;
  const store = new UsageStore({ filePath: path.join(dir, 'usage.json'), now: () => clock });
  return { store, dir, setClock: (v) => { clock = v; } };
}

test('US-01 an unused user has all-zero totals and a full zero-filled 14-day series', (t) => {
  const { store } = setup(t);
  const s = store.summary('u1');
  assert.deepEqual(s.totals, { generated: 0, aiRequests: 0 });
  assert.equal(s.series.length, 14);
  assert.equal(s.series[13].date, '2026-10-14');
  assert.equal(s.series[0].date, '2026-10-01');
  assert.ok(s.series.every((d) => d.generated === 0 && d.aiRequests === 0));
});

test('US-02 counters add up per day and per user; users never see each other\'s numbers', (t) => {
  const { store, setClock } = setup(t);
  store.record('u1', 'generated'); store.record('u1', 'generated'); store.record('u1', 'aiRequests', 3);
  setClock(T0 - 2 * DAY);
  store.record('u1', 'generated');
  store.record('u2', 'generated', 5);
  setClock(T0);
  const s = store.summary('u1');
  assert.deepEqual(s.totals, { generated: 3, aiRequests: 3 });
  assert.equal(s.series[13].generated, 2);
  assert.equal(s.series[11].generated, 1);
  assert.equal(store.summary('u2').totals.generated, 5);
  assert.deepEqual(store.summary('nobody').totals, { generated: 0, aiRequests: 0 });
});

test('US-03 bad input is ignored, not stored (including prototype-pollution names)', (t) => {
  const { store } = setup(t);
  for (const [u, k, n] of [['', 'generated', 1], [null, 'generated', 1], ['u', 'other', 1], ['u', 'generated', 0], ['u', 'generated', -1], ['u', 'generated', 1.5], ['u', 'generated', 1000], ['x'.repeat(65), 'generated', 1]]) {
    assert.equal(store.record(u, k, n), false, JSON.stringify([u, k, n]));
  }
  assert.equal(store.record('__proto__', 'generated'), true);
  assert.equal(({}).generated, undefined, 'Object.prototype was not polluted');
  assert.deepEqual(store.summary('constructor').totals, { generated: 0, aiRequests: 0 });
});

test('US-04 only the most recent MAX_DAYS days are kept per user', (t) => {
  const { store, setClock, dir } = setup(t);
  for (let i = MAX_DAYS + 10; i >= 0; i -= 1) { setClock(T0 - i * DAY); store.record('u1', 'generated'); }
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
  assert.equal(Object.keys(raw.users.u1).length, MAX_DAYS);
  assert.equal(store.summary('u1').totals.generated, MAX_DAYS);
});

test('US-05 extractors: only AI-sourced, non-fallback recipes and really-called models count as AI requests', () => {
  assert.deepEqual(fromRecipeResponse({ data: { recipe: { source: 'AI Generated', usedFallback: false } } }), { generated: 1, aiRequests: 1 });
  assert.deepEqual(fromRecipeResponse({ data: { recipe: { source: 'AI Generated', usedFallback: true } } }), { generated: 1, aiRequests: 0 });
  assert.deepEqual(fromRecipeResponse({ data: { recipe: { source: 'Database Match' } } }), { generated: 1, aiRequests: 0 });
  assert.deepEqual(fromRecipeResponse({ data: { recipe: { source: 'AI Generated' } } }), { generated: 1, aiRequests: 0 }, 'unknown fallback state is not credited to a model');
  assert.equal(fromRecipeResponse({ data: {} }), null);
  const models = [{ status: 'SUCCESS' }, { status: 'FAILED' }, { status: 'REJECTED' }, { status: 'SKIPPED' }, { status: 'BASELINE' }, null];
  assert.deepEqual(fromComparisonResponse({ data: { comparison: { models } } }), { aiRequests: 3 });
  assert.equal(fromComparisonResponse({ data: { comparison: {} } }), null);
});

function run(store, extract, { user = { id: 'u1' }, status = 200, body = { success: true, data: {} } } = {}) {
  const res = { statusCode: status, sent: null, json(b) { this.sent = b; return this; } };
  const req = { auth: user ? { user } : null };
  recordUsage(store, extract)(req, res, () => {});
  res.json(body);
  return res;
}

test('US-06 middleware counts only successful responses of signed-in users, and passes the body through untouched', (t) => {
  const { store } = setup(t);
  const extract = () => ({ generated: 1, aiRequests: 1 });
  const body = { success: true, data: { x: 1 } };
  assert.equal(run(store, extract, { body }).sent, body);
  assert.deepEqual(store.summary('u1').totals, { generated: 1, aiRequests: 1 });
  run(store, extract, { status: 400, body: { success: false } });
  run(store, extract, { body: { success: false } });
  run(store, extract, { status: 500, body: { success: true } });
  run(store, extract, { user: null });
  assert.deepEqual(store.summary('u1').totals, { generated: 1, aiRequests: 1 }, 'errors and anonymous calls are not counted');
});

test('US-07 a failing store or extractor never breaks the response', () => {
  const broken = { record() { throw new Error('disk full'); } };
  const res = run(broken, () => ({ generated: 1 }));
  assert.deepEqual(res.sent, { success: true, data: {} });
  const res2 = run({ record() {} }, () => { throw new Error('bad'); });
  assert.deepEqual(res2.sent, { success: true, data: {} });
});

test('US-08 /api/usage/me is behind a permission gate and reads only the caller\'s own id', () => {
  const [{ createUsageRouter }] = loadWithFakeExpress(['routes/usage.js']);
  const router = createUsageRouter({ usageStore: {}, requirePermission: (p) => tag('perm', p) });
  assert.deepEqual(describeRoutes(router), [['GET /me', [`perm:${PERMISSIONS.RECIPE_READ_OWN}`, 'handler']]]);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'routes', 'usage.js'), 'utf8');
  assert.ok(src.includes('req.auth.user.id') && !src.includes('req.params') && !src.includes('req.query'));
});
