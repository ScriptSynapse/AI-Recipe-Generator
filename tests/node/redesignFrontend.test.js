// Phase Q frontend: pure view-models, shared layout, and the page scripts on a strict fake DOM
// (which THROWS on innerHTML). Not a browser test: it proves logic and structure, not looks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WizardModel = require('../../frontend/js/wizardModel');
const ResultModel = require('../../frontend/js/resultModel');
const DashboardModel = require('../../frontend/js/dashboardModel');
const LabModel = require('../../frontend/js/labModel');
const AuthHelpers = require('../../frontend/js/authHelpers');
const { FakeElement, createDocument, flush, runFrontendScript } = require('../helpers/fakeDom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');
const PAGES = ['index', 'generator', 'results', 'recipes', 'ai-lab', 'security', 'analytics', 'settings', 'login'];

// ---- WizardModel -----------------------------------------------------------------------------
test('RW-01 the ingredients step blocks until there is an ingredient; other steps never block', () => {
  assert.equal(WizardModel.blocker('ingredients', { ingredients: [] }), 'Please add at least one ingredient.');
  assert.equal(WizardModel.blocker('ingredients', null), 'Please add at least one ingredient.');
  assert.equal(WizardModel.blocker('ingredients', { ingredients: ['rice'] }), null);
  for (const k of ['preferences', 'strategy', 'review']) assert.equal(WizardModel.blocker(k, { ingredients: [] }), null);
});

test('RW-02 preChecks: counts and lengths are really measured; canSubmit follows them', () => {
  const ok = WizardModel.preChecks({ ingredients: ['rice', 'dal'] });
  assert.ok(ok.every((c) => c.status === 'pass'));
  assert.equal(WizardModel.canSubmit({ ingredients: ['rice'] }), true);
  assert.equal(WizardModel.canSubmit({ ingredients: [] }), false);
  assert.equal(WizardModel.canSubmit({ ingredients: Array.from({ length: 21 }, (_, i) => `i${i}`) }), false);
  assert.equal(WizardModel.canSubmit({ ingredients: Array.from({ length: 20 }, (_, i) => `i${i}`) }), true);
  assert.equal(WizardModel.canSubmit({ ingredients: ['x'.repeat(60)] }), true);
  assert.equal(WizardModel.canSubmit({ ingredients: ['x'.repeat(61)] }), false);
});

test('RW-03 strategies: standard goes to /generate (no Lab hand-off); the others hand off with the right Lab mode', () => {
  const prefs = { ingredients: ['rice'] };
  assert.equal(WizardModel.labHandoff('standard', prefs), null);
  assert.deepEqual(WizardModel.labHandoff('compare', prefs), { mode: 'all', preferences: prefs });
  assert.deepEqual(WizardModel.labHandoff('fastest', prefs).mode, 'fastest');
  assert.deepEqual(WizardModel.labHandoff('best', prefs).mode, 'best');
  assert.equal(WizardModel.strategy('nonsense').value, 'standard', 'unknown strategy falls back to the safe default');
  assert.equal(WizardModel.labHandoff('__proto__', prefs), null);
});

test('RW-04 the review page lists server-side checks as "run on generate", not as passed', () => {
  assert.deepEqual(WizardModel.SERVER_CHECKS, ['Input validation', 'Prompt-injection scan', 'XSS scan']);
  assert.equal(WizardModel.preChecks({ ingredients: [] }).some((c) => /injection|XSS/i.test(c.label)), false, 'the browser never claims to have run the server scans');
});

// ---- LabModel.prefillFrom ---------------------------------------------------------------------
test('RP-01 prefillFrom keeps only recognised values and rejects garbage', () => {
  const good = LabModel.prefillFrom(JSON.stringify({ mode: 'best', preferences: { ingredients: ['a', 'b'], cuisine: 'Thai', dietaryPreference: 'Vegan', cookingTime: 45 } }));
  assert.deepEqual(good, { ingredients: 'a, b', cuisine: 'Thai', diet: 'Vegan', time: 45, mode: 'best' });
  const odd = LabModel.prefillFrom(JSON.stringify({ mode: '<x>', preferences: { ingredients: ['a'], cuisine: '"><script>', dietaryPreference: 5, cookingTime: 90 } }));
  assert.deepEqual(odd, { ingredients: 'a', cuisine: 'Indian', diet: 'No Preference', time: 60, mode: 'all' });
  for (const bad of ['not json', '{}', 'null', '[]', JSON.stringify({ preferences: { ingredients: [] } }), JSON.stringify({ preferences: { ingredients: [1, null] } }), null, undefined]) {
    assert.equal(LabModel.prefillFrom(bad), null, String(bad));
  }
});

// ---- ResultModel -------------------------------------------------------------------------------
test('RR-01 origin: database vs real model vs offline fallback', () => {
  assert.equal(ResultModel.origin({ source: 'Database Match' }), 'database');
  assert.equal(ResultModel.origin({ source: 'AI Generated', usedFallback: false, aiProvider: 'claude' }), 'ai');
  assert.equal(ResultModel.origin({ source: 'AI Generated', usedFallback: true }), 'offline');
  assert.equal(ResultModel.origin({ source: 'AI Generated' }), 'offline', 'unknown fallback state is NOT credited to a model');
  for (const bad of [null, undefined, {}, 'x', { source: 5 }]) assert.equal(ResultModel.origin(bad), 'unknown');
});

test('RR-02 pipeline only for fresh generations, and never claims what the response cannot prove', () => {
  const db = ResultModel.pipeline({ source: 'Database Match' }, { bestDatabaseScore: 82.4, ingredientCoverageRequired: 0.8 });
  assert.deepEqual(db.map((r) => [r.label, r.status]), [
    ['Input validated', 'pass'], ['Prompt-injection and XSS scan', 'pass'], ['Database match', 'pass'], ['Ingredient coverage', 'pass'], ['AI output validation', 'na']]);
  assert.match(db[3].detail, /80%/);
  const ai = ResultModel.pipeline({ source: 'AI Generated', usedFallback: false, aiProvider: 'gemini' }, {});
  assert.deepEqual(ai.map((r) => r.status), ['pass', 'pass', 'pass', 'pass']);
  assert.equal(ai[2].detail, 'gemini');
  const offline = ResultModel.pipeline({ source: 'AI Generated', usedFallback: true }, {});
  assert.equal(offline.find((r) => r.label === 'AI generation').status, 'na');
  assert.equal(offline.find((r) => r.label === 'AI output validation').status, 'na');
  assert.deepEqual(ResultModel.pipeline({ source: 'Database Match' }, null), [], 'a saved recipe has no pipeline to show');
  assert.deepEqual(ResultModel.pipeline({ source: 'Database Match' }, 'x'), []);
});

test('RR-03 details: provider shown only when a model made it; time is "not measured" without a measurement', () => {
  assert.deepEqual(ResultModel.details({ source: 'AI Generated', usedFallback: false, aiProvider: 'groq' }, 1520), [['Produced by', 'AI model'], ['AI provider', 'groq'], ['Generation time', '1.5 s']]);
  assert.deepEqual(ResultModel.details({ source: 'Database Match' }, null), [['Produced by', 'Recipe database match'], ['Generation time', 'not measured']]);
  assert.equal(ResultModel.details({ source: 'AI Generated', usedFallback: true }, 20)[1][1], 'none (no model produced this recipe)');
  assert.equal(ResultModel.formatDuration(250.4), '250 ms');
  assert.equal(ResultModel.formatDuration(-1), 'not measured');
  assert.equal(ResultModel.formatDuration('9'), 'not measured');
});

test('RR-04 safetyChecks passes the engine\'s lines through; unknown status is a warning, never a pass; no report -> nothing', () => {
  const rows = ResultModel.safetyChecks({ checks: [{ label: 'Required ingredients respected', status: 'pass', detail: '' }, { label: '2 additional ingredients detected', status: 'warn', detail: 'x' }, { label: 'Odd', status: 'PASS' }, null, { status: 'pass' }] });
  assert.deepEqual(rows.map((r) => [r.label, r.status]), [['Required ingredients respected', 'pass'], ['2 additional ingredients detected', 'warn'], ['Odd', 'warn']]);
  for (const bad of [null, undefined, {}, { checks: 'x' }, 'x']) assert.deepEqual(ResultModel.safetyChecks(bad), []);
  assert.equal(ResultModel.safetyChecks({ checks: Array.from({ length: 20 }, () => ({ label: 'a', status: 'pass' })) }).length, 8);
});

// ---- DashboardModel ----------------------------------------------------------------------------
test('RD-01 tiles: unloaded sources are "—" (never 0); security tile only for admins', () => {
  const none = DashboardModel.tiles({ usage: null, saved: null, models: null, security: null });
  assert.deepEqual(none.map((t) => t.value), ['—', '—', '—', '—']);
  const t = DashboardModel.tiles({ usage: { totals: { generated: 4, aiRequests: 2 } }, saved: 0, models: [{ available: true }, { available: false }, null], security: { totals: { events: 9 } } });
  assert.deepEqual(t.map((x) => [x.key, x.value]), [['generated', '4'], ['ai', '2'], ['saved', '0'], ['models', '1'], ['security', '9']]);
  assert.equal(t[3].note, 'of 3 supported');
  assert.equal(DashboardModel.tiles({ usage: { totals: { generated: -1, aiRequests: 'x' } } })[0].value, '—');
});

test('RD-02 recentRecipes: newest five, tolerant of garbage; modelRows labels honestly', () => {
  const rows = DashboardModel.recentRecipes(Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, savedAt: `2026-10-0${i + 1}T10:00:00Z` })).concat([null, 5]));
  assert.deepEqual(rows.map((r) => r.id), ['r7', 'r6', 'r5', 'r4', 'r3']);
  assert.equal(rows[0].date, '2026-10-08');
  assert.deepEqual(DashboardModel.recentRecipes('nope'), []);
  assert.equal(DashboardModel.recentRecipes([{ id: 'a', savedAt: 'garbage' }])[0].date, '');
  const m = DashboardModel.modelRows([{ provider: 'claude', model: 'x', available: false }, { provider: 'local', model: 'y', available: true }, { provider: 'groq', model: 'z', available: false, status: 'TIMEOUT' }, { provider: 'q', available: true, status: 'API_KEY_MISSING' }]);
  assert.deepEqual(m.map((r) => [r.label, r.tone]), [['Not configured', 'neutral'], ['Available', 'ok'], ['Timeout', 'warn'], ['API key missing', 'ok']]);
});

test('RD-03 activity scales to the busiest day; no activity stays flat; securityStatus never defaults to "normal"', () => {
  const a = DashboardModel.activity([{ date: '2026-10-13', generated: 4 }, { date: '2026-10-14', generated: 2 }, { date: '2026-10-15', generated: 0 }]);
  assert.deepEqual(a.columns.map((c) => c.percent), [100, 50, 0]);
  assert.match(a.summary, /6 recipes generated in the last 3 days/);
  assert.equal(DashboardModel.activity([]).summary, 'No recipes generated in this period.');
  assert.equal(DashboardModel.activity(null).columns.length, 0);
  assert.equal(DashboardModel.securityStatus(null), null);
  assert.equal(DashboardModel.securityStatus({ threat: { level: 'toString' } }).level, 'Unknown');
  assert.equal(DashboardModel.securityStatus({ totals: { blocked: 3 }, threat: { level: 'HIGH', reasons: ['r', 5] } }).tone, 'bad');
});

// ---- shared layout -----------------------------------------------------------------------------
test('RL-01 every page has the same navigation, the Sentinel theme, the new brand and a skip-free semantic shell', () => {
  const navOf = (html) => (html.match(/<ul class="nav-links">[\s\S]*?<\/ul>/)[0]).replace(/ class="active" aria-current="page"/, '');
  const reference = navOf(read('index.html'));
  for (const name of PAGES) {
    const html = read(`${name}.html`);
    assert.equal(navOf(html), reference, `${name}: nav differs`);
    assert.ok(html.includes('css/sentinel.css'), `${name}: theme missing`);
    assert.ok(/<title>[^<]*RecipeAI Sentinel<\/title>/.test(html), `${name}: title`);
    assert.ok(html.includes('Secure Multi-LLM Recipe Intelligence Platform'), `${name}: subtitle`);
    assert.equal(html.includes('AI Recipe Generator'), false, `${name}: old brand`);
    assert.ok(/<main[\s>]/.test(html) && /<nav[^>]*aria-label="Main"/.test(html) && /lang="en"/.test(html), `${name}: semantic shell`);
    assert.equal((html.match(/id="auth-nav"/g) || []).length, 1);
    assert.equal(/<script(?![^>]*\bsrc=)/i.test(html), false, `${name}: inline script`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${name}: inline handler`);
  }
  for (const label of ['Dashboard', 'Generate', 'AI Lab', 'My Recipes', 'Security', 'Analytics', 'Settings']) assert.ok(reference.includes(`>${label}</a>`), label);
});

test('RL-02 Security and Analytics links are admin-only (hidden by default); each page marks its own link active', () => {
  const nav = read('index.html').match(/<ul class="nav-links">[\s\S]*?<\/ul>/)[0];
  assert.match(nav, /class="admin-only hidden"><a href="security.html"/);
  assert.match(nav, /class="admin-only hidden"><a href="analytics.html"/);
  assert.equal((nav.match(/admin-only/g) || []).length, 2);
  for (const [page, href] of [['index', 'index.html'], ['generator', 'generator.html'], ['results', 'generator.html'], ['recipes', 'recipes.html'], ['ai-lab', 'ai-lab.html'], ['security', 'security.html'], ['analytics', 'analytics.html'], ['settings', 'settings.html']]) {
    assert.match(read(`${page}.html`), new RegExp(`<a href="${href}" class="active" aria-current="page">`), page);
  }
  assert.equal(/class="active"/.test(read('login.html')), false);
});

test('RL-03 the theme keeps text readable: key colour pairs meet WCAG AA (4.5:1)', () => {
  const css = read('css/sentinel.css');
  const token = (n) => css.match(new RegExp(`--${n}:\\s*(#[0-9A-Fa-f]{6})`))[1];
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const bg of ['color-paper', 'color-card']) {
    for (const fg of ['color-ink', 'color-ink-soft', 'color-ink-faint', 'color-basil', 'color-brick', 'color-saffron-dark']) {
      assert.ok(ratio(token(fg), token(bg)) >= 4.5, `${fg} on ${bg}: ${ratio(token(fg), token(bg)).toFixed(2)}`);
    }
  }
  assert.ok(ratio('#FFFFFF', '#4361EE') >= 4.5, 'primary button text');
});

// ---- page scripts ------------------------------------------------------------------------------
const walkText = (node) => node.textContent;
const okRes = (data) => ({ success: true, data });

function bootDashboard({ role, usage = okRes({ totals: { generated: 3, aiRequests: 1 }, series: [{ date: '2026-10-14', generated: 3, aiRequests: 1 }] }), recipes = okRes({ recipes: [{ id: 'a', name: '<b>Dal</b>', cuisine: 'Indian', savedAt: '2026-10-10T00:00:00Z' }] }), models = okRes({ models: [{ provider: 'claude', model: 'm', available: false }, { provider: 'local', model: 'l', available: true }] }), stats = okRes({ totals: { events: 7, blocked: 2 }, threat: { level: 'ELEVATED', reasons: ['why'] } }) } = {}) {
  const ids = ['dash-guest', 'dash-user', 'dash-welcome-name', 'dash-tiles', 'dash-recent', 'dash-models', 'dash-activity', 'dash-activity-summary', 'dash-security-panel', 'dash-security'];
  const document = createDocument(ids);
  ['dash-guest', 'dash-user', 'dash-security-panel'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  const calls = [];
  const AuthAPI = { me: async () => (role ? okRes({ user: { username: 'sam', role } }) : { success: false }) };
  const track = (name, value) => async () => { calls.push(name); return value; };
  runFrontendScript('dashboard.js', {
    document, AuthAPI, DashboardModel,
    UsageAPI: { me: track('usage', usage) }, RecipeAPI: { list: track('recipes', recipes) },
    AiLabAPI: { models: track('models', models) }, SecurityAPI: { stats: track('security', stats) },
  });
  return { $: (id) => document.getElementById(id), calls };
}

test('RS-01 dashboard, signed out: intro shown, nothing requested', async () => {
  const { $, calls } = bootDashboard({ role: null });
  await flush(); await flush();
  assert.equal($('dash-guest').classes.has('hidden'), false);
  assert.equal($('dash-user').classes.has('hidden'), true);
  assert.deepEqual(calls, []);
});

test('RS-02 dashboard, user: tiles from real responses; hostile recipe name stays inert text; no security request', async () => {
  const { $, calls } = bootDashboard({ role: 'USER' });
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal($('dash-user').classes.has('hidden'), false);
  assert.equal($('dash-welcome-name').textContent, 'sam');
  assert.match(walkText($('dash-tiles')), /3Recipes generated/);
  assert.match(walkText($('dash-recent')), /<b>Dal<\/b>/);
  assert.match(walkText($('dash-models')), /claude[\s\S]*Not configured[\s\S]*local[\s\S]*Available/);
  assert.equal($('dash-security-panel').classes.has('hidden'), true);
  assert.equal(calls.includes('security'), false);
});

test('RS-03 dashboard, admin: security status shown; one failing source leaves "—" without blanking the rest', async () => {
  const admin = bootDashboard({ role: 'ADMIN' });
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(admin.$('dash-security-panel').classes.has('hidden'), false);
  assert.match(walkText(admin.$('dash-security')), /Threat level: Elevated/);
  assert.match(walkText(admin.$('dash-tiles')), /7Security events/);

  const partial = bootDashboard({ role: 'USER', usage: { success: false }, models: { success: false } });
  for (let i = 0; i < 4; i += 1) await flush();
  assert.match(walkText(partial.$('dash-tiles')), /—Recipes generated/);
  assert.match(walkText(partial.$('dash-tiles')), /1Saved recipes/);
  assert.match(walkText(partial.$('dash-models')), /unavailable/);
  assert.match(walkText(partial.$('dash-recent')), /Dal/);
});

// ---- generator wizard script -------------------------------------------------------------------
function bootGenerator({ generate = async () => okRes({ recipe: { id: 'x' }, matchInfo: {} }), search = '' } = {}) {
  const document = createDocument([]);
  const reg = new Map();
  const make = (id, tag = 'div') => { const e = new FakeElement(tag, id); reg.set(id, e); return e; };
  document.getElementById = (id) => reg.get(id) || null;
  const root = new FakeElement('body'); document.roots.push(root);
  const ids = ['ingredient-input', 'add-ingredient-btn', 'ingredient-chips', 'ingredient-empty-hint', 'cuisine-select', 'diet-select', 'servings-minus', 'servings-plus', 'servings-value',
    'strategy-list', 'review-summary', 'review-prechecks', 'review-server', 'stepper', 'wizard-next', 'wizard-back', 'generate-btn', 'generator-form', 'loading-state', 'error-banner'];
  ids.forEach((id) => make(id));
  reg.get('cuisine-select').value = 'Indian'; reg.get('diet-select').value = 'No Preference'; reg.get('servings-value').textContent = '2';
  const pill = (group, value, selected) => { const p = new FakeElement('div'); p.className = 'option-pill'; p.setAttribute('data-value', value); if (selected) p.classList.add('selected'); group.appendChild(p); return p; };
  const pills = {};
  for (const [id, vals] of [['meal-type-group', ['Breakfast', 'Dinner']], ['cooking-time-group', ['15', '30', '45']], ['difficulty-group', ['Easy', 'Medium']]]) {
    const g = make(id); pills[id] = vals.map((v) => pill(g, v));
  }
  ['ingredients', 'preferences', 'strategy', 'review'].forEach((k) => {
    const section = new FakeElement('section'); section.className = 'wizard-step'; section.appendChild(new FakeElement('h2')); root.appendChild(section);
  });
  const store = new Map();
  const sessionStorage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null, removeItem: (k) => store.delete(k) };
  const window = { location: { search, href: 'generator.html' } };
  const calls = [];
  const RecipeAPI = { generate: async (p) => { calls.push(p); return generate(p); } };
  runFrontendScript('generator.js', { document, window, sessionStorage, RecipeAPI, WizardModel });
  const $ = (id) => reg.get(id);
  const steps = root.children;
  const add = async (text) => { $('ingredient-input').value = text; await $('add-ingredient-btn').dispatch('click'); };
  return { $, steps, calls, store, window, add, pills, root };
}

const activeStep = (steps) => steps.findIndex((s) => s.classes.has('active'));

test('RG-01 wizard opens on step 1; Next is blocked with no ingredient and shows why', async () => {
  const g = bootGenerator();
  assert.equal(activeStep(g.steps), 0);
  assert.equal(g.$('wizard-back').classes.has('hidden'), true);
  await g.$('wizard-next').dispatch('click');
  assert.equal(activeStep(g.steps), 0);
  assert.equal(g.$('error-banner').textContent, 'Please add at least one ingredient.');
  assert.equal(g.$('ingredient-empty-hint').classes.has('visible'), true);
});

test('RG-02 ingredients are added as text (hostile input stays inert), de-duplicated, comma-split; removing works', async () => {
  const g = bootGenerator();
  await g.add('Paneer, tomato, paneer, <img src=x onerror=alert(1)>');
  const chips = g.$('ingredient-chips').children;
  assert.equal(chips.length, 3);
  assert.match(chips[2].textContent, /<img src=x onerror=alert\(1\)>/);
  await chips[0].children[1].dispatch('click');
  assert.equal(g.$('ingredient-chips').children.length, 2);
});

test('RG-03 full path: Next x3 reaches the review (last) step with Generate shown; Back works', async () => {
  const g = bootGenerator();
  await g.add('rice');
  for (let i = 1; i <= 3; i += 1) { await g.$('wizard-next').dispatch('click'); assert.equal(activeStep(g.steps), i); }
  assert.equal(g.$('generate-btn').classes.has('hidden'), false);
  assert.equal(g.$('wizard-next').classes.has('hidden'), true);
  assert.match(g.$('review-summary').textContent, /Ingredientsrice/);
  assert.match(g.$('review-server').textContent, /Prompt-injection scan[\s\S]*runs when you generate/);
  assert.equal(g.$('stepper').children.length, 4);
  await g.$('wizard-back').dispatch('click');
  assert.equal(activeStep(g.steps), 2);
  assert.equal(g.$('generate-btn').classes.has('hidden'), true);
});

test('RG-04 standard strategy: generate is called with the chosen preferences, timing and result are stashed, then results.html', async () => {
  const g = bootGenerator();
  await g.add('rice, dal');
  await g.pills['cooking-time-group'][2].dispatch('click');
  await g.$('servings-plus').dispatch('click');
  for (let i = 0; i < 3; i += 1) await g.$('wizard-next').dispatch('click');
  await g.$('generator-form').dispatch('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(g.calls)), [{ ingredients: ['rice', 'dal'], cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'No Preference', cookingTime: 45, difficulty: 'Medium', servings: 3 }]);
  assert.equal(g.window.location.href, 'results.html');
  assert.ok(JSON.parse(g.store.get('lastRecipeResult')).matchInfo);
  assert.ok(Number(g.store.get('lastGenerationMs')) >= 0);
  assert.deepEqual(JSON.parse(g.store.get('lastPreferences')).ingredients, ['rice', 'dal']);
});

test('RG-05 a Lab strategy never calls /generate: it stores a hand-off and goes to the AI Lab', async () => {
  const g = bootGenerator();
  await g.add('rice');
  await g.$('wizard-next').dispatch('click'); await g.$('wizard-next').dispatch('click');
  const radios = g.$('strategy-list').querySelectorAll('input');
  assert.equal(radios.length, 4);
  radios[3].checked = true; await radios[3].dispatch('change');       // best quality
  await g.$('wizard-next').dispatch('click');
  await g.$('generator-form').dispatch('submit');
  assert.deepEqual(g.calls, []);
  assert.equal(g.window.location.href, 'ai-lab.html');
  const handoff = JSON.parse(g.store.get('labPrefill'));
  assert.equal(handoff.mode, 'best');
  assert.deepEqual(handoff.preferences.ingredients, ['rice']);
});

test('RG-06 a server rejection is shown (form returns) and nothing is stashed', async () => {
  const g = bootGenerator({ generate: async () => ({ success: false, error: { code: 'PROMPT_INJECTION', message: 'Your request was blocked.' } }) });
  await g.add('rice');
  for (let i = 0; i < 3; i += 1) await g.$('wizard-next').dispatch('click');
  await g.$('generator-form').dispatch('submit');
  assert.equal(g.$('error-banner').textContent, 'Your request was blocked.');
  assert.equal(g.$('generator-form').classes.has('hidden'), false);
  assert.equal(g.store.size, 0);
  assert.equal(g.window.location.href, 'generator.html');
});

test('RG-07 an over-long ingredient is caught by the review pre-check before anything is sent', async () => {
  const g = bootGenerator();
  await g.add('x'.repeat(200));
  for (let i = 0; i < 3; i += 1) await g.$('wizard-next').dispatch('click');
  assert.match(g.$('review-prechecks').textContent, /!/);
  await g.$('generator-form').dispatch('submit');
  assert.deepEqual(g.calls, []);
  assert.match(g.$('error-banner').textContent, /fix/i);
});

test('RG-08 the ?cuisine= query pre-selects a cuisine', () => {
  const g = bootGenerator({ search: '?cuisine=Thai' });
  assert.equal(g.$('cuisine-select').value, 'Thai');
});

// ---- admin pages, settings, nav reveal -----------------------------------------------------------
function bootSimple(file, ids, { role, extra = {} }) {
  const document = createDocument(ids);
  ids.filter((i) => /signin$|denied$|main$/.test(i)).forEach((i) => document.getElementById(i).classList.add('hidden'));
  const window = { location: { href: 'x.html' } };
  const AuthAPI = { me: async () => (role ? okRes({ user: { username: 'sam', role } }) : { success: false }), logout: async () => ({ success: true }) };
  runFrontendScript(file, { document, window, AuthAPI, AuthHelpers, DashboardModel, LabModel, ...extra });
  return { $: (id) => document.getElementById(id), window };
}

test('RA-01 analytics: user is denied without any data request; admin sees providers and the empty-state table', async () => {
  const asked = [];
  const AiLabAPI = { providers: async () => { asked.push('p'); return okRes({ models: [{ provider: 'claude', model: 'm', status: 'API_KEY_MISSING', available: false }] }); }, analytics: async () => { asked.push('a'); return okRes({ comparisons: 0, models: [] }); } };
  const ids = ['an-signin', 'an-signin-link', 'an-denied', 'an-main', 'an-providers', 'an-models', 'an-status'];
  const user = bootSimple('analytics.js', ids, { role: 'USER', extra: { AiLabAPI } });
  await flush(); await flush();
  assert.equal(user.$('an-denied').classes.has('hidden'), false);
  assert.deepEqual(asked, []);
  const admin = bootSimple('analytics.js', ids, { role: 'ADMIN', extra: { AiLabAPI } });
  for (let i = 0; i < 4; i += 1) await flush();
  assert.match(admin.$('an-providers').textContent, /claude[\s\S]*API key missing/);
  assert.match(admin.$('an-models').textContent, /No comparisons recorded yet/);
  const out = bootSimple('analytics.js', ids, { role: null, extra: { AiLabAPI } });
  await flush(); await flush();
  assert.equal(out.$('an-signin-link').href, 'login.html?next=analytics.html');
});

const SETTINGS_IDS = ['set-signin', 'set-signin-link', 'set-main', 'set-username', 'set-role', 'set-signout', 'set-status',
  'set-password', 'pw-form', 'pw-current', 'pw-new', 'pw-confirm', 'pw-error', 'pw-submit'];

test('RA-02 settings: shows the account as text; sign-out calls logout and returns to the dashboard', async () => {
  const ids = SETTINGS_IDS;
  const s = bootSimple('settings.js', ids, { role: 'ADMIN' });
  await flush(); await flush();
  assert.equal(s.$('set-username').textContent, 'sam');
  assert.equal(s.$('set-role').textContent, 'Administrator');
  await s.$('set-signout').dispatch('click');
  assert.equal(s.window.location.href, 'index.html');
  const out = bootSimple('settings.js', ids, { role: null });
  await flush(); await flush();
  assert.equal(out.$('set-signin-link').href, 'login.html?next=settings.html');
});

test('RA-03 auth-status reveals the admin-only nav links for an ADMIN only', async () => {
  const run = async (role) => {
    const slot = new FakeElement('li', 'auth-nav');
    const adminItems = [new FakeElement('li'), new FakeElement('li')];
    adminItems.forEach((i) => i.classes.add('hidden'));
    const document = { getElementById: (id) => (id === 'auth-nav' ? slot : null), createElement: (t) => new FakeElement(t), querySelectorAll: (sel) => (sel === '.admin-only' ? adminItems : []) };
    runFrontendScript('auth-status.js', { document, window: { location: { pathname: '/index.html', href: '' } }, AuthHelpers, AuthAPI: { me: async () => okRes({ user: { username: 'sam', role } }), logout: async () => ({}) } });
    await flush(); await flush();
    return adminItems.map((i) => i.classes.has('hidden'));
  };
  assert.deepEqual(await run('ADMIN'), [false, false]);
  assert.deepEqual(await run('USER'), [true, true]);
});

test('RA-04 none of the new page scripts use innerHTML/eval; new pages are valid post-login return targets', () => {
  for (const f of ['dashboard.js', 'dashboardModel.js', 'wizardModel.js', 'resultModel.js', 'analytics.js', 'settings.js', 'generator.js']) {
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(read(`js/${f}`)), false, f);
  }
  for (const p of ['analytics.html', 'settings.html', 'security.html']) assert.equal(AuthHelpers.safeNextTarget(p), p);
});

// ---- settings: change password ----------------------------------------------------------------
async function settingsWith(result) {
  const document = createDocument(SETTINGS_IDS);
  SETTINGS_IDS.filter((i) => /signin$|main$|password$/.test(i)).forEach((i) => document.getElementById(i).classList.add('hidden'));
  const window = { location: { href: 'x.html' } };
  const calls = [];
  const AuthAPI = {
    me: async () => okRes({ user: { username: 'sam', role: 'USER' } }), logout: async () => ({ success: true }),
    changePassword: async (cur, next) => { calls.push([cur, next]); return result; },
  };
  runFrontendScript('settings.js', { document, window, AuthAPI, AuthHelpers });
  await flush(); await flush();
  const $ = (id) => document.getElementById(id);
  const submit = async (cur, next, confirm) => { $('pw-current').value = cur; $('pw-new').value = next; $('pw-confirm').value = confirm; await $('pw-form').dispatch('submit'); };
  return { $, calls, submit, window };
}

test('RA-04 settings: the password form is shown only when signed in; mismatch / short / empty are caught before any request', async () => {
  const p = await settingsWith({ success: true });
  assert.equal(p.$('set-password').classes.has('hidden'), false);
  await p.submit('', 'long enough pass', 'long enough pass');
  assert.equal(p.$('pw-error').textContent, 'Enter your current password.');
  await p.submit('old', 'short', 'short');
  assert.match(p.$('pw-error').textContent, /at least 10/);
  await p.submit('old', 'long enough pass', 'different pass!!');
  assert.match(p.$('pw-error').textContent, /do not match/);
  assert.deepEqual(p.calls, []);
});

test('RA-05 settings: success clears every field and says other devices were signed out; a server refusal shows its message and keeps the fields', async () => {
  const ok = await settingsWith({ success: true });
  await ok.submit('old password!', 'a brand new passphrase', 'a brand new passphrase');
  assert.deepEqual(JSON.parse(JSON.stringify(ok.calls)), [['old password!', 'a brand new passphrase']]);
  assert.deepEqual(['pw-current', 'pw-new', 'pw-confirm'].map((id) => ok.$(id).value), ['', '', '']);
  assert.match(ok.$('set-status').textContent, /Other devices have been signed out/);
  assert.equal(ok.$('pw-submit').disabled, false);

  const no = await settingsWith({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' } });
  await no.submit('wrong', 'a brand new passphrase', 'a brand new passphrase');
  assert.equal(no.$('pw-error').textContent, 'Current password is incorrect.');
  assert.equal(no.$('pw-new').value, 'a brand new passphrase');

  const expired = await settingsWith({ success: false, error: { code: 'AUTH_REQUIRED', message: 'x' } });
  await expired.submit('old password!', 'a brand new passphrase', 'a brand new passphrase');
  assert.equal(expired.window.location.href, 'login.html?next=settings.html');
});

test('RA-06 settings.html: password inputs have labels, the right autocomplete hints and are never prefilled', () => {
  const html = read('settings.html');
  for (const [id, ac] of [['pw-current', 'current-password'], ['pw-new', 'new-password'], ['pw-confirm', 'new-password']]) {
    assert.match(html, new RegExp(`<label[^>]*for="${id}"`));
    assert.match(html, new RegExp(`<input type="password" id="${id}" autocomplete="${ac}"`));
  }
  assert.doesNotMatch(html, /type="password"[^>]*value=/);
});
