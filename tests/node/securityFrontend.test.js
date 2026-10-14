// Security Center frontend: pure view-model, and the page script on a strict fake DOM
// (which THROWS if a script assigns innerHTML). Not a browser test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SecurityModel = require('../../frontend/js/securityModel');
const AuthHelpers = require('../../frontend/js/authHelpers');
const { createDocument, flush, runFrontendScript } = require('../helpers/fakeDom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');

test('SF-01 threatView: known levels map to tone; unknown/garbage never claims "normal"', () => {
  assert.deepEqual(SecurityModel.threatView({ level: 'HIGH', reasons: ['a', 5, 'b'] }), { level: 'HIGH', label: 'High', tone: 'bad', reasons: ['a', 'b'] });
  assert.equal(SecurityModel.threatView({ level: 'NORMAL' }).tone, 'ok');
  for (const bad of [null, undefined, {}, { level: 'toString' }, { level: '__proto__' }, { level: 3 }]) {
    assert.equal(SecurityModel.threatView(bad).level, 'UNKNOWN', JSON.stringify(bad));
    assert.equal(SecurityModel.threatView(bad).tone, 'neutral');
  }
});

test('SF-02 cards pass counts through; a missing number is null ("—"), not zero', () => {
  const cards = SecurityModel.cards({ totals: { blocked: 7 }, byType: { PROMPT_INJECTION: 3, XSS_ATTEMPT: 0, RATE_LIMIT: -4, AUTH_FAILURE: 'x' } });
  const by = Object.fromEntries(cards.map((c) => [c.key, c.value]));
  assert.deepEqual(by, { BLOCKED: 7, PROMPT_INJECTION: 3, XSS_ATTEMPT: 0, RATE_LIMIT: 0, AUTH_FAILURE: null, AI_OUTPUT_REJECTED: null });
  assert.equal(SecurityModel.cards(null)[0].value, null);
});

test('SF-03 typeBars: only non-zero types, largest first, scaled to the largest', () => {
  const rows = SecurityModel.typeBars({ byType: { PROMPT_INJECTION: 10, XSS_ATTEMPT: 5, RATE_LIMIT: 0, AUTH_FAILURE: 1 } });
  assert.deepEqual(rows.map((r) => [r.key, r.value, r.percent]), [['PROMPT_INJECTION', 10, 100], ['XSS_ATTEMPT', 5, 50], ['AUTH_FAILURE', 1, 10]]);
  assert.deepEqual(SecurityModel.typeBars({ byType: {} }), []);
  assert.deepEqual(SecurityModel.typeBars(null), []);
});

test('SF-04 seriesView: heights are relative to the busiest bucket; empty stays flat; blocked never exceeds total', () => {
  const v = SecurityModel.seriesView({ bucketMs: 3600000, buckets: [
    { start: '2026-10-14T10:00:00.000Z', total: 10, blocked: 4 },
    { start: '2026-10-14T11:00:00.000Z', total: 5, blocked: 99 },
    { start: '2026-10-14T12:00:00.000Z', total: 0, blocked: 0 },
  ] });
  assert.deepEqual(v.columns.map((c) => [c.totalPercent, c.blockedPercent, c.blocked]), [[100, 40, 4], [50, 50, 5], [0, 0, 0]]);
  assert.equal(v.columns[0].label, '2026-10-14 10:00 UTC');
  assert.match(v.summary, /15 events; busiest period had 10/);
  const empty = SecurityModel.seriesView({ bucketMs: 86400000, buckets: [{ start: '2026-10-14T00:00:00.000Z', total: 0, blocked: 0 }] });
  assert.equal(empty.columns[0].totalPercent, 0);
  assert.equal(empty.columns[0].label, '2026-10-14');
  assert.equal(empty.summary, 'No events in this period.');
  assert.equal(SecurityModel.seriesView(null).columns.length, 0);
  assert.ok(SecurityModel.seriesView({ bucketMs: 1, buckets: [{ start: 'nope', total: 1 }] }).columns[0].totalPercent >= 3, 'a single event is still visible');
});

test('SF-05 statusView surfaces truncation and skipped lines instead of hiding them', () => {
  assert.match(SecurityModel.statusView({ totals: { events: 1 }, source: {} }).text, /1 event recorded/);
  const s = SecurityModel.statusView({ totals: { events: 2 }, source: { truncated: true, skippedCorruptLines: 3 } });
  assert.equal(s.notes.length, 2);
  assert.match(SecurityModel.statusView(null).text, /unavailable/);
});

test('SF-06 eventRows: tolerant of garbage, bounded, unknown types shown as "Other"', () => {
  const rows = SecurityModel.eventRows([{ timestamp: '2026-10-14T12:00:05.123Z', type: 'PROMPT_INJECTION', severity: 'HIGH', result: 'BLOCKED', provider: 'claude', action: 'generate', reason: 'x'.repeat(1000) }, { type: 'WAT', timestamp: 5 }, null]);
  assert.equal(rows[0].time, '2026-10-14 12:00:05 UTC');
  assert.equal(rows[0].type, 'Prompt injection');
  assert.equal(rows[0].reason.length, 300);
  assert.deepEqual([rows[1].type, rows[1].time, rows[1].provider], ['Other', '—', '—']);
  assert.equal(rows.length, 3);
  assert.equal(SecurityModel.eventRows('nope').length, 0);
  assert.equal(SecurityModel.eventRows(Array.from({ length: 500 }, () => ({}))).length, 100);
});

// ---- page script -------------------------------------------------------------------------------
const IDS = ['sec-signin', 'sec-signin-link', 'sec-denied', 'sec-main', 'sec-window', 'sec-refresh', 'sec-status', 'sec-threat', 'sec-status-line', 'sec-notes', 'sec-cards', 'sec-series', 'sec-series-summary', 'sec-types', 'sec-events'];
const allText = (n) => n.textContent;

const STATS = {
  window: '24h', totals: { events: 4, blocked: 3 },
  byType: { PROMPT_INJECTION: 2, XSS_ATTEMPT: 1, RATE_LIMIT: 0, AUTH_FAILURE: 1, AI_OUTPUT_REJECTED: 0, MODEL_FAILURE: 0 },
  series: { bucketMs: 3600000, buckets: [{ start: '2026-10-14T10:00:00.000Z', total: 3, blocked: 2 }, { start: '2026-10-14T11:00:00.000Z', total: 1, blocked: 1 }] },
  threat: { level: 'ELEVATED', reasons: ['A high-severity event in the last hour.'] }, source: { truncated: false, skippedCorruptLines: 0 },
};

function boot({ role, stats = { success: true, data: STATS }, events }) {
  const document = createDocument(IDS);
  const $ = (id) => document.getElementById(id);
  $('sec-main').classes.add('hidden'); $('sec-denied').classes.add('hidden'); $('sec-signin').classes.add('hidden');
  const calls = { stats: [], events: [] };
  const AuthAPI = { me: async () => (role ? { success: true, data: { user: { username: 'u', role } } } : { success: false }) };
  const SecurityAPI = {
    stats: async (w) => { calls.stats.push(w); return stats; },
    events: async (n) => { calls.events.push(n); return events || { success: true, data: { events: [{ timestamp: '2026-10-14T11:00:00.000Z', type: 'XSS_ATTEMPT', severity: 'MEDIUM', result: 'BLOCKED', reason: '<img src=x onerror=alert(1)>' }] } }; },
  };
  runFrontendScript('security.js', { document, AuthAPI, SecurityAPI, AuthHelpers, SecurityModel });
  return { $, calls };
}

test('SF-07 signed out: sign-in prompt with a safe return link; no data requested', async () => {
  const { $, calls } = boot({ role: null });
  await flush();
  assert.equal($('sec-signin').classes.has('hidden'), false);
  assert.equal($('sec-signin-link').href, 'login.html?next=security.html');
  assert.deepEqual([calls.stats.length, calls.events.length], [0, 0]);
});

test('SF-08 a plain USER sees "no access" and the page never asks for security data', async () => {
  const { $, calls } = boot({ role: 'USER' });
  await flush();
  assert.equal($('sec-denied').classes.has('hidden'), false);
  assert.equal($('sec-main').classes.has('hidden'), true);
  assert.deepEqual([calls.stats.length, calls.events.length], [0, 0]);
});

test('SF-09 admin: stats and events are loaded and rendered as text (hostile event text stays inert)', async () => {
  const { $, calls } = boot({ role: 'ADMIN' });
  await flush(); await flush(); await flush();
  assert.equal($('sec-main').classes.has('hidden'), false);
  assert.deepEqual(calls.stats, ['24h']);
  assert.match(allText($('sec-threat')), /Elevated[\s\S]*high-severity event/);
  assert.match(allText($('sec-cards')), /Blocked requests/);
  assert.equal($('sec-series').children.length, 2);
  assert.match(allText($('sec-types')), /Prompt injection/);
  assert.match(allText($('sec-events')), /<img src=x onerror=alert\(1\)>/, 'shown literally as text');
  assert.match($('sec-series').getAttribute('aria-label'), /4 events/);
});

test('SF-10 changing the period re-requests stats for that period; a server error is shown, not thrown', async () => {
  const { $, calls } = boot({ role: 'ADMIN' });
  await flush(); await flush(); await flush();
  assert.ok($('sec-window').children.length === 4);
  $('sec-window').value = '7d';
  await $('sec-window').dispatch('change');
  await flush();
  assert.deepEqual(calls.stats, ['24h', '7d']);

  const failing = boot({ role: 'ADMIN', stats: { success: false, error: { code: 'FORBIDDEN', message: 'Not allowed.' } } });
  await flush(); await flush(); await flush();
  assert.equal(failing.$('sec-status').textContent, 'Not allowed.');
});

test('SF-11 security.html: structure, no inline script/handlers, and the script order is right', () => {
  const html = fs.readFileSync(path.join(FRONTEND, 'security.html'), 'utf8');
  for (const id of IDS.filter((i) => i !== 'sec-window' || true)) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, 'no inline script');
  assert.equal(/\son[a-z]+\s*=/i.test(html), false, 'no inline event handlers');
  const order = ['js/api.js', 'js/authHelpers.js', 'js/auth-status.js', 'js/securityModel.js', 'js/security.js'].map((s) => html.indexOf(s));
  assert.ok(order.every((n, i) => n > -1 && (i === 0 || n > order[i - 1])));
  assert.match(html, /<label[^>]*for="sec-window"/);
});

test('SF-12 security.js and securityModel.js never use innerHTML/eval, and security.html is a valid post-login return page', () => {
  for (const f of ['security.js', 'securityModel.js']) {
    const src = fs.readFileSync(path.join(FRONTEND, 'js', f), 'utf8');
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), false, f);
  }
  assert.equal(AuthHelpers.safeNextTarget('security.html'), 'security.html');
});
