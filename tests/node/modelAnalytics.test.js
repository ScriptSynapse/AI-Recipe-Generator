const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ModelAnalyticsStore, MAX_ROWS, MAX_COMPARISONS } = require('../../backend/ai/ModelAnalyticsStore');

function tmpStore(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'model-analytics.json');
  return { store: new ModelAnalyticsStore({ filePath, ...opts }), filePath };
}
const model = (provider, status, durationMs, score) => ({
  provider, model: `${provider}-m`, status, durationMs, ...(score === undefined ? {} : { evaluation: { overallScore: score } }),
});
const comparison = (models, extra = {}) => ({ mode: 'COMPARE_ALL', best: null, fastest: null, models, ...extra });

test('MA-01 an empty store summarises to nothing -- no seeded or estimated numbers', (t) => {
  const { store } = tmpStore(t);
  assert.deepEqual(store.summary(), { comparisons: 0, models: [] });
});

test('MA-02 summary figures are exactly what was recorded', (t) => {
  const { store } = tmpStore(t);
  store.record(comparison([model('a', 'SUCCESS', 100, 80), model('b', 'FAILED', 5)], { best: 'a', fastest: 'a' }));
  store.record(comparison([model('a', 'SUCCESS', 300, 60), model('b', 'SUCCESS', 50, 90)], { best: 'b', fastest: 'b' }));
  store.record(comparison([model('a', 'REJECTED', 70), model('b', 'SKIPPED', 0)]));
  const s = store.summary();
  assert.equal(s.comparisons, 3);
  const a = s.models.find((m) => m.provider === 'a'); const b = s.models.find((m) => m.provider === 'b');
  assert.deepEqual([a.attempts, a.successes, a.rejected, a.failures, a.successRate, a.avgLatencyMs, a.avgScore, a.bestWins, a.fastestWins], [3, 2, 1, 0, 67, 200, 70, 1, 1]);
  assert.deepEqual([b.attempts, b.successes, b.failures, b.skipped, b.successRate, b.avgLatencyMs, b.avgScore, b.bestWins, b.fastestWins], [2, 1, 1, 1, 50, 50, 90, 1, 1]);
});

test('MA-03 a skipped model was never called: not an attempt, not a failure', (t) => {
  const { store } = tmpStore(t);
  store.record(comparison([model('keyless', 'SKIPPED', 0)]));
  const m = store.summary().models[0];
  assert.deepEqual([m.attempts, m.failures, m.skipped, m.successRate, m.avgLatencyMs, m.avgScore], [0, 0, 1, null, null, null]);
});

test('MA-04 the offline baseline is stored for reference but never appears as a model', (t) => {
  const { store, filePath } = tmpStore(t);
  store.record(comparison([model('offline-template', 'BASELINE', 1, 100), model('a', 'SUCCESS', 10, 50)]));
  assert.deepEqual(store.summary().models.map((m) => m.provider), ['a']);
  assert.ok(JSON.parse(fs.readFileSync(filePath, 'utf8')).rows.some((r) => r.status === 'BASELINE'));
});

test('MA-05 hostile / malformed engine data is whitelisted, clamped and cleaned', (t) => {
  const { store, filePath } = tmpStore(t);
  store.record(comparison([
    { provider: 'ev\nil\u0000<b>', model: 'm'.repeat(500), status: 'SUCCESS', durationMs: 1e12, evaluation: { overallScore: 9999 }, recipe: { secret: 'RECIPE-BODY' }, extra: 'EXTRA' },
    { provider: 'x', status: 'NOT_A_STATUS', durationMs: 5 },
    { provider: '', status: 'SUCCESS' },
    null, 'string', { provider: 'y', status: 'SUCCESS', durationMs: 'fast', evaluation: { overallScore: 'high' } },
  ], { best: 'q'.repeat(300) }));
  const file = fs.readFileSync(filePath, 'utf8');
  for (const leak of ['RECIPE-BODY', 'EXTRA', '\u0000']) assert.equal(file.includes(leak), false, leak);
  const data = JSON.parse(file);
  assert.equal(data.rows.length, 2);
  assert.ok(data.rows[0].provider.length <= 40 && !/[\n\u0000]/.test(data.rows[0].provider));
  assert.equal(data.rows[0].model.length, 80);
  assert.equal(data.rows[0].durationMs, 3_600_000);
  assert.equal(data.rows[0].score, 100);
  assert.deepEqual([data.rows[1].durationMs, data.rows[1].score], [null, null]);
  assert.equal(data.comparisons[0].best.length, 40);
});

test('MA-06 unusable input records nothing and returns null', (t) => {
  const { store } = tmpStore(t);
  for (const bad of [null, undefined, 5, 'x', {}, { models: 'no' }, { models: [] }, { models: [{ provider: 'a', status: 'WAT' }] }]) assert.equal(store.record(bad), null);
  assert.equal(store.summary().comparisons, 0);
});

test('MA-07 bounded: oldest rows and comparisons are dropped', (t) => {
  const { store, filePath } = tmpStore(t);
  const many = Array.from({ length: 50 }, (_, i) => model(`p${i}`, 'SUCCESS', i, 50));
  for (let i = 0; i < Math.ceil(MAX_ROWS / 50) + 3; i += 1) store.record(comparison(many));
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.ok(data.rows.length <= MAX_ROWS);
  for (let i = 0; i < MAX_COMPARISONS + 20; i += 1) store.record(comparison([model('a', 'SUCCESS', 1, 1)]));
  assert.ok(JSON.parse(fs.readFileSync(filePath, 'utf8')).comparisons.length <= MAX_COMPARISONS);
});

test('MA-08 file is private (0600) and a corrupt file raises rather than inventing data', (t) => {
  const { store, filePath } = tmpStore(t);
  store.record(comparison([model('a', 'SUCCESS', 1, 1)]));
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  fs.writeFileSync(filePath, '{not json');
  assert.throws(() => store.summary(), /corrupted/);
});

test('MA-H1 history: newest first, per-model rows attached, filters by provider/source/date/limit', (t) => {
  let clock = Date.parse('2026-03-01T00:00:00Z');
  const { store } = tmpStore(t, { now: () => clock });
  store.record(comparison([model('a', 'SUCCESS', 100, 80), model('b', 'FAILED', 5)], { best: 'a', fastest: 'a' }), { source: 'lab' });
  clock = Date.parse('2026-03-02T12:00:00Z');
  store.record(comparison([model('b', 'SUCCESS', 50, 90)], { best: 'b', fastest: 'b' }), { source: 'benchmark' });
  clock = Date.parse('2026-03-03T00:00:00Z');
  store.record(comparison([model('a', 'SUCCESS', 70, 60)]), { source: 'lab' });
  const all = store.history();
  assert.deepEqual(all.map((r) => r.source), ['lab', 'benchmark', 'lab']);
  assert.deepEqual(all[2].models.map((m) => [m.provider, m.status, m.durationMs, m.score]), [['a', 'SUCCESS', 100, 80], ['b', 'FAILED', 5, null]]);
  assert.equal(store.history({ provider: 'B' }).length, 2);                       // case-insensitive, runs that include b
  assert.equal(store.history({ source: 'benchmark' }).length, 1);
  assert.equal(store.history({ sinceMs: Date.parse('2026-03-02T00:00:00Z'), untilMs: Date.parse('2026-03-02T23:59:59Z') }).length, 1);
  assert.equal(store.history({ limit: 2 }).length, 2);
  assert.deepEqual(new ModelAnalyticsStore({ filePath: path.join(os.tmpdir(), `none-${Date.now()}.json`) }).history(), []);
});

test('MA-H2 a run whose rows aged out of the row log is listed with no models (not reconstructed)', (t) => {
  const { store } = tmpStore(t);
  store.record(comparison([model('a', 'SUCCESS', 1, 1)]));
  store.store.update((d) => { d.rows = []; });
  const h = store.history();
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].models, []);
});
