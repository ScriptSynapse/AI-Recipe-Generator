// Security Center backend: SecurityStats aggregation, controller and route table.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SecurityAuditLog } = require('../../backend/audit/SecurityAuditLog');
const { SecurityStats, assessThreat, WINDOWS } = require('../../backend/audit/SecurityStats');
const { createSecurityController } = require('../../backend/controllers/securityController');
const { EVENT_TYPES, SEVERITIES, RESULTS } = require('../../backend/audit/auditEvents');
const { PERMISSIONS } = require('../../backend/authorization/permissions');
const { loadWithFakeExpress, tag, describeRoutes } = require('../helpers/fakeExpress');

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const MIN = 60 * 1000;

function setup(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secstats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = NOW;
  const log = new SecurityAuditLog({ filePath: path.join(dir, 'a.jsonl'), now: () => clock, ...opts });
  const at = (msAgo, event) => { clock = NOW - msAgo; log.record({ action: 'x', ...event }); clock = NOW; };
  const stats = new SecurityStats({ auditLog: log, now: () => NOW });
  return { log, at, stats, dir };
}
const ev = (type, severity = SEVERITIES.LOW, result = RESULTS.BLOCKED, extra = {}) => ({ type, severity, result, ...extra });

test('SS-01 an empty log yields all zeros, every type present, NORMAL threat -- nothing invented', (t) => {
  const { stats } = setup(t);
  const s = stats.compute('24h');
  assert.equal(s.totals.events, 0);
  assert.equal(s.totals.blocked, 0);
  assert.deepEqual(Object.keys(s.byType).sort(), Object.keys(EVENT_TYPES).sort());
  assert.ok(Object.values(s.byType).every((n) => n === 0));
  assert.equal(s.series.buckets.length, 24);
  assert.ok(s.series.buckets.every((b) => b.total === 0 && b.blocked === 0));
  assert.equal(s.threat.level, 'NORMAL');
  assert.deepEqual(s.threat.reasons, []);
  assert.equal(s.source.truncated, false);
});

test('SS-02 counts by type, severity, result and blocked match what was recorded', (t) => {
  const { at, stats } = setup(t);
  at(5 * MIN, ev('PROMPT_INJECTION', 'HIGH', 'BLOCKED'));
  at(6 * MIN, ev('PROMPT_INJECTION', 'HIGH', 'BLOCKED'));
  at(7 * MIN, ev('XSS_ATTEMPT', 'MEDIUM', 'BLOCKED'));
  at(8 * MIN, ev('AUTH_FAILURE', 'LOW', 'DENIED'));
  at(9 * MIN, ev('AUTH_SUCCESS', 'INFO', 'SUCCESS'));
  at(10 * MIN, ev('MODEL_FAILURE', 'LOW', 'FAILURE', { provider: 'claude' }));
  at(11 * MIN, ev('MODEL_FAILURE', 'LOW', 'FAILURE', { provider: 'claude' }));
  at(12 * MIN, ev('MODEL_FAILURE', 'LOW', 'FAILURE', { provider: 'groq' }));
  const s = stats.compute('24h');
  assert.equal(s.totals.events, 8);
  assert.equal(s.totals.blocked, 4, 'BLOCKED + DENIED count; SUCCESS and FAILURE do not');
  assert.equal(s.byType.PROMPT_INJECTION, 2);
  assert.equal(s.byType.XSS_ATTEMPT, 1);
  assert.equal(s.byType.AUTH_FAILURE, 1);
  assert.equal(s.bySeverity.HIGH, 2);
  assert.equal(s.byResult.FAILURE, 3);
  assert.deepEqual(s.modelFailuresByProvider, { claude: 2, groq: 1 });
  const sum = (k) => s.series.buckets.reduce((n, b) => n + b[k], 0);
  assert.equal(sum('total'), 8);
  assert.equal(sum('blocked'), 4);
});

test('SS-03 events outside the window are excluded; window edges and buckets are exact', (t) => {
  const { at, stats } = setup(t);
  at(30 * MIN, ev('RATE_LIMIT'));
  at(3 * 60 * MIN, ev('RATE_LIMIT'));
  at(25 * 60 * MIN, ev('RATE_LIMIT'));
  assert.equal(stats.compute('1h').totals.events, 1);
  assert.equal(stats.compute('24h').totals.events, 2);
  assert.equal(stats.compute('7d').totals.events, 3);
  const h = stats.compute('1h');
  assert.equal(h.series.buckets.length, 12);
  assert.equal(h.series.buckets[6].total, 1, '30 minutes ago is the middle 5-minute bucket');
  for (const name of Object.keys(WINDOWS)) {
    assert.equal(stats.compute(name).series.buckets.length, Math.ceil(WINDOWS[name].spanMs / WINDOWS[name].bucketMs));
  }
});

test('SS-04 future-dated events (clock skew) are not counted', (t) => {
  const { log, stats } = setup(t);
  log.now = () => NOW + 10 * MIN;
  log.record({ action: 'x', ...ev('RATE_LIMIT') });
  assert.equal(stats.compute('24h').totals.events, 0);
});

test('SS-05 threat level follows the documented thresholds and explains itself', () => {
  assert.equal(assessThreat({ recentHigh: 0, recentMedium: 0, recentBlocked: 4 }).level, 'NORMAL');
  assert.equal(assessThreat({ recentHigh: 0, recentMedium: 0, recentBlocked: 5 }).level, 'ELEVATED');
  assert.equal(assessThreat({ recentHigh: 1, recentMedium: 0, recentBlocked: 0 }).level, 'ELEVATED');
  assert.equal(assessThreat({ recentHigh: 0, recentMedium: 10, recentBlocked: 0 }).level, 'ELEVATED');
  assert.equal(assessThreat({ recentHigh: 0, recentMedium: 9, recentBlocked: 0 }).level, 'NORMAL');
  assert.equal(assessThreat({ recentHigh: 3, recentMedium: 0, recentBlocked: 0 }).level, 'HIGH');
  assert.equal(assessThreat({ recentHigh: 0, recentMedium: 0, recentBlocked: 20 }).level, 'HIGH');
  const both = assessThreat({ recentHigh: 1, recentMedium: 0, recentBlocked: 20 });
  assert.equal(both.level, 'HIGH', 'a lower rule never downgrades a higher one');
  assert.equal(both.reasons.length, 2);
});

test('SS-06 threat uses only the LAST HOUR: old high-severity events do not raise it', (t) => {
  const { at, stats } = setup(t);
  for (let i = 0; i < 5; i += 1) at((2 * 60 + i) * MIN, ev('PROMPT_INJECTION', 'HIGH'));
  const old = stats.compute('24h');
  assert.equal(old.totals.events, 5);
  assert.equal(old.threat.level, 'NORMAL');
  for (let i = 0; i < 3; i += 1) at((10 + i) * MIN, ev('PROMPT_INJECTION', 'HIGH'));
  assert.equal(stats.compute('24h').threat.level, 'HIGH');
  assert.equal(stats.compute('24h').threat.basis.recentHigh, 3);
});

test('SS-07 unknown windows are rejected; scan cap is reported, not hidden', (t) => {
  const { at, log, stats } = setup(t);
  assert.throws(() => stats.compute('1y'), RangeError);
  assert.throws(() => stats.compute('__proto__'), RangeError);
  assert.throws(() => stats.compute('constructor'), RangeError);
  for (let i = 0; i < 5; i += 1) at(i * MIN, ev('RATE_LIMIT'));
  const r = log.scan(() => {}, { maxRecords: 3 });
  assert.deepEqual([r.scanned, r.truncated], [3, true]);
  assert.equal(log.scan(() => {}, { maxRecords: 5 }).truncated, false);
});

test('SS-08 scan reads across rotated files and counts corrupt lines instead of failing', (t) => {
  const { at, log, stats } = setup(t, { maxBytes: 600 });
  for (let i = 0; i < 12; i += 1) at(i * MIN, ev('RATE_LIMIT'));
  assert.ok(fs.existsSync(`${log.filePath}.1`), 'log rotated');
  fs.appendFileSync(log.filePath, 'not json\n');
  const s = stats.compute('24h');
  assert.equal(s.source.skippedCorruptLines, 1);
  assert.equal(s.totals.events, s.source.recordsScanned);
});

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('SC-01 controller: default window, valid window, bad window -> 400 with fixed text (no echo)', (t) => {
  const { at, log } = setup(t);
  at(MIN, ev('RATE_LIMIT'));
  const c = createSecurityController({ auditLog: log, now: () => NOW });
  const ok = fakeRes(); c.stats({ query: {} }, ok, assert.fail);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.data.window, '24h');
  const w7 = fakeRes(); c.stats({ query: { window: '7d' } }, w7, assert.fail);
  assert.equal(w7.body.data.window, '7d');
  const bad = fakeRes(); c.stats({ query: { window: '<script>x</script>' } }, bad, assert.fail);
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.stringify(bad.body).includes('script'), false);
  const arr = fakeRes(); c.stats({ query: { window: ['1h', '7d'] } }, arr, assert.fail);
  assert.equal(arr.statusCode, 400);
});

test('SC-02 controller passes unexpected failures to next() instead of leaking them', (t) => {
  const c = createSecurityController({ auditLog: { scan() { throw new Error('disk exploded /secret/path'); } }, now: () => NOW });
  let forwarded = null;
  c.stats({ query: {} }, fakeRes(), (e) => { forwarded = e; });
  assert.ok(forwarded instanceof Error);
});

test('SW-01 /api/security routes are ALL behind SECURITY_DASHBOARD_READ, gate first', () => {
  const [{ createSecurityRouter }] = loadWithFakeExpress(['routes/security.js']);
  const noop = () => {};
  const router = createSecurityRouter({
    controller: { stats: noop }, auditController: { listAuditLog: noop }, requirePermission: (p) => tag('perm', p),
  });
  assert.deepEqual(describeRoutes(router), [
    ['GET /stats', [`perm:${PERMISSIONS.SECURITY_DASHBOARD_READ}`, 'handler']],
    ['GET /events', [`perm:${PERMISSIONS.SECURITY_DASHBOARD_READ}`, 'handler']],
  ]);
});

test('SS-09 a lower rule never downgrades a higher one, whichever rule fires first', () => {
  const r = assessThreat({ recentHigh: 3, recentMedium: 0, recentBlocked: 5 });
  assert.equal(r.level, 'HIGH', 'HIGH from severity, then an ELEVATED blocked-count rule');
  assert.equal(r.reasons.length, 2);
  assert.equal(assessThreat({ recentHigh: 3, recentMedium: 10, recentBlocked: 0 }).level, 'HIGH');
});

test('SS-10 an event stamped exactly "now" lands in the last bucket, not past the end', (t) => {
  const { at, stats } = setup(t);
  at(0, ev('RATE_LIMIT'));
  at(24 * 60 * MIN, ev('RATE_LIMIT'));            // exactly at the window start: first bucket
  const s = stats.compute('24h');
  assert.equal(s.totals.events, 2);
  assert.equal(s.series.buckets[23].total, 1);
  assert.equal(s.series.buckets[0].total, 1);
});

test('SS-11 isWindow accepts only the four named windows (no inherited names)', () => {
  for (const ok of ['1h', '24h', '7d', '30d']) assert.equal(SecurityStats.isWindow(ok), true);
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', '', '1H', null, undefined, 5, ['1h']]) {
    assert.equal(SecurityStats.isWindow(bad), false, String(bad));
  }
});
