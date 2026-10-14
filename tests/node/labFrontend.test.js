// AI Lab frontend: the pure view-model, and the page script against a strict fake DOM
// (which THROWS if a script ever assigns innerHTML).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const LabModel = require('../../frontend/js/labModel');
const AuthHelpers = require('../../frontend/js/authHelpers');
const { createDocument, flush, runFrontendScript } = require('../helpers/fakeDom');

// ---- labModel ---------------------------------------------------------------
test('LF-01 parseIngredients trims, de-duplicates (case-insensitive), drops blanks, and is bounded', () => {
  assert.deepEqual(LabModel.parseIngredients(' paneer, Tomato ,, PANEER\nonion '), ['paneer', 'Tomato', 'onion']);
  assert.deepEqual(LabModel.parseIngredients(''), []);
  assert.deepEqual(LabModel.parseIngredients(null), []);
  assert.equal(LabModel.parseIngredients(Array.from({ length: 100 }, (_, i) => `item${i}`).join(',')).length, LabModel.MAX_INGREDIENTS);
  assert.equal(LabModel.parseIngredients('x'.repeat(500))[0].length, 60);
});

test('LF-02 describeModel: badges come from the server\'s winners, latency is "not called"/"not measured" rather than 0', () => {
  const comparison = { best: 'a', fastest: 'b', recommended: 'a', models: [] };
  const a = LabModel.describeModel({ provider: 'a', model: 'm', status: 'SUCCESS', durationMs: 812.4, evaluation: { overallScore: 88, ingredientScore: 100 } }, comparison);
  assert.deepEqual(a.badges, ['Best quality', 'Recommended']);
  assert.equal(a.latency, '812 ms');
  assert.deepEqual(a.scores, [{ label: 'Overall', value: 88 }, { label: 'Ingredients', value: 100 }]);
  assert.deepEqual(LabModel.describeModel({ provider: 'b', status: 'SUCCESS' }, comparison).badges, ['Fastest']);
  assert.equal(LabModel.describeModel({ provider: 'b', status: 'SUCCESS' }, comparison).latency, 'not measured');
  assert.equal(LabModel.describeModel({ provider: 'c', status: 'SKIPPED', durationMs: 0 }, comparison).latency, 'not called');
});

test('LF-03 describeModel tolerates garbage: unknown status, bad scores, wrong types', () => {
  const v = LabModel.describeModel({ provider: 5, model: null, status: 'WAT', durationMs: 'fast', evaluation: { overallScore: 'high', ingredientScore: 500, warnings: ['ok', 7, null] }, recipe: { name: 9, ingredients: [null, 'x', { name: 'rice', quantity: 2.5, unit: 'cup' }], instructions: ['step', 3] }, error: { a: 1 } }, {});
  assert.equal(v.status, 'FAILED');
  assert.equal(v.provider, '5');
  assert.deepEqual(v.scores, [{ label: 'Ingredients', value: 100 }], 'out-of-range clamped, non-numbers dropped');
  assert.deepEqual(v.warnings, ['ok']);
  assert.deepEqual(v.recipe.ingredients, ['2.5 cup rice']);
  assert.deepEqual(v.recipe.instructions, ['step']);
  assert.equal(v.recipe.name, 'Untitled recipe');
  assert.equal(v.error, '');
  assert.equal(v.latency, 'not measured');
});

test('LF-04 summarize is honest about "nothing configured" vs "nothing valid" vs success', () => {
  const m = (status, provider = 'p') => ({ provider, status });
  assert.match(LabModel.summarize({ models: [m('SKIPPED'), m('SKIPPED'), m('BASELINE', 'offline-template')] }).headline, /No AI models are configured/);
  assert.match(LabModel.summarize({ models: [m('FAILED'), m('REJECTED'), m('SKIPPED')] }).headline, /No model returned a valid recipe/);
  assert.equal(LabModel.summarize({ models: [m('SUCCESS', 'a'), m('FAILED', 'b'), m('SKIPPED', 'c')], best: 'a' }).headline, '1 of 2 models returned a valid recipe.');
  assert.equal(LabModel.summarize({ models: [m('SUCCESS')] }).headline, '1 of 1 model returned a valid recipe.');
  assert.equal(LabModel.summarize({ models: [m('SUCCESS')], best: 'p' }).hasWinner, true);
  assert.equal(LabModel.summarize(null).headline, 'No models were asked.');
});

test('LF-05 analyticsRows shows "—" for not-measured, never 0', () => {
  const rows = LabModel.analyticsRows({ models: [{ provider: 'a', model: 'm', attempts: 0, successRate: null, avgLatencyMs: null, avgScore: null, bestWins: 2, fastestWins: 1 }] });
  assert.deepEqual(rows[0], { provider: 'a', model: 'm', attempts: '0', successRate: '—', avgLatency: '—', avgScore: '—', wins: '2 best / 1 fastest' });
  assert.deepEqual(LabModel.analyticsRows(null), []);
});

// ---- page script ------------------------------------------------------------
const IDS = ['lab-signin', 'lab-signin-link', 'lab-main', 'lab-models', 'lab-form', 'lab-ingredients', 'lab-cuisine', 'lab-diet', 'lab-time',
  'lab-mode', 'lab-run', 'lab-status', 'lab-results', 'lab-summary', 'lab-grid', 'lab-admin', 'lab-runs', 'lab-benchmark', 'lab-analytics',
  'lab-history-form', 'lab-h-provider', 'lab-h-source', 'lab-h-since', 'lab-h-until', 'lab-h-status', 'lab-history', 'lab-h-compare', 'lab-h-diff'];

function walk(node, fn) { fn(node); node.children.forEach((c) => walk(c, fn)); }
const allText = (node) => { const out = []; walk(node, (n) => out.push(n._text)); return out.join('\n'); };

function boot({ role = null, compare, analytics, history } = {}) {
  const document = createDocument(IDS);
  const $ = (id) => document.getElementById(id);
  for (const id of ['lab-signin', 'lab-main', 'lab-results', 'lab-admin']) $(id).classList.add('hidden');
  $('lab-ingredients').value = 'paneer, tomato';
  $('lab-cuisine').value = 'Indian'; $('lab-diet').value = 'Vegetarian'; $('lab-time').value = '30'; $('lab-mode').value = 'all'; $('lab-runs').value = '2';
  const calls = { models: 0, compare: [], benchmark: [], analytics: 0, history: [] };
  const AuthAPI = { me: async () => (role ? { success: true, data: { user: { username: 'u', role } } } : { success: false, error: { code: 'AUTH_REQUIRED' } }) };
  const AiLabAPI = {
    models: async () => { calls.models += 1; return { success: true, data: { models: [{ provider: 'claude', model: 'claude-x', available: false }, { provider: 'local', model: 'llama', available: true }] } }; },
    compare: async (prefs, mode) => { calls.compare.push([prefs, mode]); return compare ? compare() : { success: true, data: { comparison: { mode: 'COMPARE_ALL', best: null, fastest: null, models: [] } } }; },
    benchmark: async (prefs, runs) => { calls.benchmark.push([prefs, runs]); return { success: true, data: { runs, models: [] } }; },
    history: async (filters) => { calls.history.push(filters); return history || { success: true, data: { runs: [] } }; },
    analytics: async () => { calls.analytics += 1; return analytics || { success: true, data: { comparisons: 0, models: [] } }; },
  };
  runFrontendScript('ai-lab.js', { document, AuthAPI, AiLabAPI, AuthHelpers, LabModel });
  return { document, $, calls };
}

test('LF-06 signed out: sign-in prompt with a safe return link; no Lab calls', async () => {
  const { $, calls } = boot({ role: null });
  await flush();
  assert.equal($('lab-signin').classes.has('hidden'), false);
  assert.equal($('lab-main').classes.has('hidden'), true);
  assert.equal($('lab-signin-link').href, 'login.html?next=ai-lab.html');
  assert.deepEqual([calls.models, calls.compare.length], [0, 0]);
});

test('LF-07 signed-in user: models listed, admin section stays hidden and analytics are never requested', async () => {
  const { $, calls } = boot({ role: 'USER' });
  await flush(); await flush();
  assert.equal($('lab-main').classes.has('hidden'), false);
  assert.equal($('lab-admin').classes.has('hidden'), true);
  assert.equal(calls.analytics, 0);
  assert.match(allText($('lab-models')), /claude[\s\S]*not configured[\s\S]*local[\s\S]*configured/);
});

test('LF-08 admin: benchmark section shown and analytics loaded', async () => {
  const { $, calls } = boot({ role: 'ADMIN' });
  await flush(); await flush();
  assert.equal($('lab-admin').classes.has('hidden'), false);
  assert.equal(calls.analytics, 1);
  await $('lab-benchmark').dispatch('click');
  assert.deepEqual(calls.benchmark.map(([, runs]) => runs), [2]);
});

test('LF-09 submit sends parsed preferences + the chosen mode; button is disabled while waiting and restored after', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { $, calls } = boot({ role: 'USER', compare: async () => { await gate; return { success: true, data: { comparison: { models: [] } } }; } });
  await flush(); await flush();
  const pending = $('lab-form').dispatch('submit');
  await flush();
  assert.equal($('lab-run').disabled, true);
  release(); await pending; await flush();
  assert.equal($('lab-run').disabled, false);
  assert.deepEqual(calls.compare[0][0].ingredients, ['paneer', 'tomato']);
  assert.equal(calls.compare[0][1], 'all');
  assert.equal(calls.compare[0][0].cookingTime, 30);
});

test('LF-10 submit with no ingredients does not call the API', async () => {
  const { $, calls } = boot({ role: 'USER' });
  await flush(); await flush();
  $('lab-ingredients').value = ' , ,';
  await $('lab-form').dispatch('submit'); await flush();
  assert.equal(calls.compare.length, 0);
  assert.match($('lab-status').textContent, /at least one ingredient/);
});

test('LF-11 the server\'s error message is shown (rate limit, injection block, ...)', async () => {
  const { $ } = boot({ role: 'USER', compare: async () => ({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in 12 seconds.' } }) });
  await flush(); await flush();
  await $('lab-form').dispatch('submit'); await flush();
  assert.equal($('lab-status').textContent, 'Too many requests. Please try again in 12 seconds.');
  assert.equal($('lab-results').classes.has('hidden'), true);
});

test('LF-12 hostile model/recipe text is rendered as TEXT only (the fake DOM throws on innerHTML)', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const comparison = { mode: 'COMPARE_ALL', best: evil, fastest: null, models: [
    { provider: evil, model: '<b>m</b>', status: 'SUCCESS', durationMs: 5, evaluation: { overallScore: 70, warnings: [evil] },
      recipe: { name: evil, ingredients: [{ name: evil, quantity: 1, unit: '"><script>' }], instructions: [evil] }, error: evil },
  ] };
  const { $ } = boot({ role: 'USER', compare: async () => ({ success: true, data: { comparison } }) });
  await flush(); await flush();
  await $('lab-form').dispatch('submit'); await flush();
  const tags = new Set(); const texts = [];
  walk($('lab-grid'), (n) => { tags.add(n.tagName); texts.push(n._text); });
  assert.ok(texts.some((t) => t === evil), 'the markup appears literally, as text');
  assert.equal([...tags].some((t) => ['IMG', 'SCRIPT', 'B'].includes(t)), false, 'no element was created from the data');
  assert.equal($('lab-results').classes.has('hidden'), false);
});

test('LF-13 score bars carry an accessible label and a clamped width', async () => {
  const comparison = { models: [{ provider: 'a', model: 'm', status: 'SUCCESS', durationMs: 1, evaluation: { overallScore: 250 }, recipe: { name: 'r', ingredients: [], instructions: [] } }] };
  const { $ } = boot({ role: 'USER', compare: async () => ({ success: true, data: { comparison } }) });
  await flush(); await flush();
  await $('lab-form').dispatch('submit'); await flush();
  let track = null; let fill = null;
  walk($('lab-grid'), (n) => { if (n.attributes && n.attributes['aria-label']) track = n; if (n.className === 'lab-score-fill') fill = n; });
  assert.equal(track.attributes['aria-label'], 'Overall: 100 out of 100');
  assert.equal(fill.style.width, '100%');
});

test('LF-14 static checks: the Lab page has no inline script/handlers, no string-built HTML in its script, and the nav links to it everywhere', () => {
  const root = path.join(__dirname, '..', '..', 'frontend');
  const html = fs.readFileSync(path.join(root, 'ai-lab.html'), 'utf8');
  assert.equal([...html.matchAll(/<script\b([^>]*)>/gi)].filter((m) => !/\bsrc=/.test(m[1])).length, 0);
  assert.equal(/\son[a-z]+\s*=/i.test(html), false);
  const src = fs.readFileSync(path.join(root, 'js', 'ai-lab.js'), 'utf8') + fs.readFileSync(path.join(root, 'js', 'labModel.js'), 'utf8');
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.equal(src.includes(banned), false, banned);
  for (const page of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
    assert.ok(fs.readFileSync(path.join(root, page), 'utf8').includes('href="ai-lab.html"'), `${page} has no AI Lab nav link`);
  }
  assert.ok(AuthHelpers.RETURN_PAGES.includes('ai-lab.html'));
});

// ---- benchmark history -----------------------------------------------------
const RUN_OLD = { id: 'r1', at: '2026-01-01T10:00:00.000Z', source: 'benchmark', mode: 'COMPARE_ALL', best: 'a', fastest: 'b',
  models: [{ provider: 'a', model: 'ma', status: 'SUCCESS', durationMs: 900, score: 70 }, { provider: 'b', model: 'mb', status: 'SUCCESS', durationMs: 400, score: 60 },
    { provider: 'c', model: 'mc', status: 'SKIPPED', durationMs: 0, score: null }] };
const RUN_NEW = { id: 'r2', at: '2026-01-02T10:00:00.000Z', source: 'lab', mode: 'COMPARE_ALL', best: 'a', fastest: 'a',
  models: [{ provider: 'a', model: 'ma', status: 'SUCCESS', durationMs: 600, score: 75 }, { provider: 'b', model: 'mb', status: 'FAILED', durationMs: 5, score: null },
    { provider: 'd', model: 'md', status: 'SUCCESS', durationMs: 100, score: 50 }] };

test('LF-10 historyRows: real numbers pass through, gaps are "—", skipped models are not counted as called', () => {
  const rows = LabModel.historyRows({ runs: [RUN_OLD, { id: 'r3', at: 'x', source: 'lab', models: [] }, { id: 'r4', at: 'y', models: [{ provider: 'q', status: 'SUCCESS', durationMs: null, score: null }] }] });
  assert.equal(rows[0].source, 'Benchmark');
  assert.equal(rows[0].summary, '2 of 2 models valid');
  assert.deepEqual(rows[0].models[0], { provider: 'a', status: 'SUCCESS', latency: '900 ms', score: '70' });
  assert.equal(rows[0].models[2].latency, '0 ms');
  assert.equal(rows[1].summary, 'Per-model data no longer stored');
  assert.deepEqual([rows[2].models[0].latency, rows[2].models[0].score, rows[2].best], ['—', '—', '—']);
  assert.deepEqual(LabModel.historyRows(null), []);
});

test('LF-11 compareRuns: only models valid in BOTH runs; deltas are newer minus older; no guessing', () => {
  const d = LabModel.compareRuns(RUN_OLD, RUN_NEW);
  assert.deepEqual(d.rows, [{ provider: 'a', latencyA: 900, latencyB: 600, latencyDelta: -300, scoreA: 70, scoreB: 75, scoreDelta: 5 }]);
  assert.deepEqual(d.onlyInA, ['b']);       // b failed in the newer run
  assert.deepEqual(d.onlyInB, ['d']);
  const missing = LabModel.compareRuns({ models: [{ provider: 'a', status: 'SUCCESS', durationMs: 10, score: null }] }, { models: [{ provider: 'a', status: 'SUCCESS', durationMs: 30, score: 80 }] });
  assert.deepEqual([missing.rows[0].latencyDelta, missing.rows[0].scoreDelta], [20, null]);
  assert.deepEqual(LabModel.compareRuns(null, undefined), { rows: [], onlyInA: [], onlyInB: [] });
});

test('LF-12 admin page: history loads with no filters, renders rows, filters are sent, compare shows deltas; user never asks', async () => {
  const { $, calls, document } = boot({ role: 'ADMIN', history: { success: true, data: { runs: [RUN_NEW, RUN_OLD] } } });
  await flush(); await flush(); await flush();
  assert.equal(calls.history.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.history[0])), { provider: '', source: '', since: '', until: '' });   // JSON round-trip: the object comes from the script's own vm realm
  assert.match(allText($('lab-history')), /Benchmark[\s\S]*2 of 2 models valid/);
  const boxes = $('lab-history').querySelectorAll('input');
  assert.equal(boxes.length, 2);
  boxes[0].checked = true; await boxes[0].dispatch('change');
  assert.equal($('lab-h-compare').disabled, true);          // one is not enough
  boxes[1].checked = true; await boxes[1].dispatch('change');
  assert.equal($('lab-h-compare').disabled, false);
  await $('lab-h-compare').dispatch('click');
  assert.match(allText($('lab-h-diff')), /-300 ms[\s\S]*\+5/);
  $('lab-h-source').value = 'lab'; $('lab-h-since').value = '2026-01-02';
  await $('lab-history-form').dispatch('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.history[1])), { provider: '', source: 'lab', since: '2026-01-02', until: '' });

  const user = boot({ role: 'USER' });
  await flush(); await flush();
  assert.equal(user.calls.history.length, 0);
});

test('LF-13 a third tick is refused; a failed history call shows its message instead of crashing', async () => {
  const three = { success: true, data: { runs: [RUN_NEW, RUN_OLD, { ...RUN_OLD, id: 'r9' }] } };
  const { $ } = boot({ role: 'ADMIN', history: three });
  await flush(); await flush(); await flush();
  const boxes = $('lab-history').querySelectorAll('input');
  for (const b of boxes) { b.checked = true; await b.dispatch('change'); }
  assert.equal(boxes[2].checked, false);
  assert.equal($('lab-h-status').textContent, 'Pick exactly two runs to compare.');
  const bad = boot({ role: 'ADMIN', history: { success: false, error: { message: 'Invalid date filter.' } } });
  await flush(); await flush(); await flush();
  assert.equal(bad.$('lab-h-status').textContent, 'Invalid date filter.');
});
