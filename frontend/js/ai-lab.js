/**
 * ai-lab.js -- the AI Model Lab page.
 * Every piece of server data is added to the page with textContent / DOM
 * nodes, never as HTML. Whether the user may use the Lab (or the admin
 * section) is decided by the server; hiding things here is display only.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(result) {
    const message = result && result.error && result.error.message ? result.error.message : 'Something went wrong. Please try again.';
    $('lab-status').textContent = message;
  }

  // ---- models list ---------------------------------------------------------
  function renderModels(models) {
    const list = $('lab-models');
    list.textContent = '';
    models.forEach((m) => {
      const li = el('li', 'lab-model');
      li.appendChild(el('strong', null, m.provider));
      li.appendChild(el('span', 'lab-model-name', m.model));
      li.appendChild(el('span', m.available ? 'chip chip-diet' : 'chip chip-source', m.available ? 'configured' : 'not configured'));
      list.appendChild(li);
    });
  }

  // ---- result cards --------------------------------------------------------
  function scoreBar(score) {
    const row = el('div', 'lab-score');
    row.appendChild(el('span', 'lab-score-label', score.label));
    const track = el('div', 'lab-score-track');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${score.label}: ${Math.round(score.value)} out of 100`);
    const fill = el('div', 'lab-score-fill');
    fill.style.width = `${Math.round(score.value)}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el('span', 'lab-score-value', String(Math.round(score.value))));
    return row;
  }

  function renderCard(view) {
    const card = el('article', `card lab-card lab-${view.status.toLowerCase()}`);

    const head = el('header', 'lab-card-head');
    head.appendChild(el('h3', 'lab-card-title', view.provider));
    head.appendChild(el('span', 'lab-card-model', view.model));
    card.appendChild(head);

    const meta = el('div', 'lab-meta');
    meta.appendChild(el('span', `chip lab-status-${view.status.toLowerCase()}`, view.statusLabel));
    view.badges.forEach((b) => meta.appendChild(el('span', 'chip chip-ai', b)));
    meta.appendChild(el('span', 'lab-latency', `⏱ ${view.latency}`));
    card.appendChild(meta);

    if (view.error) card.appendChild(el('p', 'lab-error', view.error));

    if (view.scores.length) {
      const scores = el('div', 'lab-scores');
      view.scores.forEach((s) => scores.appendChild(scoreBar(s)));
      card.appendChild(scores);
    }

    if (view.recipe) {
      card.appendChild(el('h4', 'lab-recipe-name', view.recipe.name));
      const ing = el('ul', 'lab-ingredients');
      view.recipe.ingredients.forEach((i) => ing.appendChild(el('li', null, i)));
      card.appendChild(ing);
      const steps = el('ol', 'lab-steps');
      view.recipe.instructions.forEach((s) => steps.appendChild(el('li', null, s)));
      card.appendChild(steps);
    }

    if (view.warnings.length) {
      const warn = el('ul', 'lab-warnings');
      view.warnings.forEach((w) => warn.appendChild(el('li', null, w)));
      card.appendChild(warn);
    }
    return card;
  }

  function renderComparison(comparison) {
    const grid = $('lab-grid');
    grid.textContent = '';
    comparison.models.forEach((m) => grid.appendChild(renderCard(LabModel.describeModel(m, comparison))));
    $('lab-summary').textContent = LabModel.summarize(comparison).headline;
    $('lab-results').classList.remove('hidden');
  }

  // ---- analytics (admin) ---------------------------------------------------
  function renderAnalytics(summary) {
    const holder = $('lab-analytics');
    holder.textContent = '';
    const rows = LabModel.analyticsRows(summary);
    if (rows.length === 0) {
      holder.appendChild(el('p', 'field-hint', 'No comparisons recorded yet.'));
      return;
    }
    const table = el('table', 'lab-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Provider', 'Model', 'Attempts', 'Success', 'Avg latency', 'Avg score', 'Wins'].forEach((h) => {
      const th = el('th', null, h); th.scope = 'col'; hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      [r.provider, r.model, r.attempts, r.successRate, r.avgLatency, r.avgScore, r.wins].forEach((v) => tr.appendChild(el('td', null, v)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    holder.appendChild(table);
  }

  async function loadAnalytics() {
    const result = await AiLabAPI.analytics();
    if (result && result.success) { renderAnalytics(result.data); fillProviderMenu(result.data); }
    loadHistory();
  }

  // ---- benchmark history ---------------------------------------------------
  let historyRuns = [];
  let rawRuns = [];       // the server's numbers, for comparing (historyRuns holds display strings)
  const picked = new Set();

  function table(headers) {
    const t = el('table', 'lab-table');
    const hr = el('tr');
    headers.forEach((h) => { const th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); });
    const thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
    const tbody = el('tbody'); t.appendChild(tbody);
    return { t, tbody };
  }

  function renderHistory(data) {
    const holder = $('lab-history');
    holder.textContent = '';
    picked.clear();
    $('lab-h-compare').disabled = true;
    $('lab-h-diff').textContent = '';
    historyRuns = LabModel.historyRows(data);
    rawRuns = Array.isArray(data && data.runs) ? data.runs : [];
    if (historyRuns.length === 0) {
      holder.appendChild(el('p', 'field-hint', 'No runs match. Runs appear here after a comparison or benchmark has been recorded.'));
      return;
    }
    const { t, tbody } = table(['Compare', 'When', 'Type', 'Result', 'Best', 'Fastest', 'Models']);
    historyRuns.forEach((r) => {
      const tr = el('tr');
      const box = el('input'); box.type = 'checkbox';
      box.setAttribute('aria-label', `Select run from ${r.at}`);
      box.addEventListener('change', () => {
        if (box.checked) picked.add(r.id); else picked.delete(r.id);
        if (picked.size > 2) { picked.delete(r.id); box.checked = false; $('lab-h-status').textContent = 'Pick exactly two runs to compare.'; }
        $('lab-h-compare').disabled = picked.size !== 2;
      });
      const c0 = el('td'); c0.appendChild(box); tr.appendChild(c0);
      const when = Date.parse(r.at);
      tr.appendChild(el('td', null, Number.isNaN(when) ? r.at : new Date(when).toLocaleString()));
      [r.source, r.summary, r.best, r.fastest].forEach((v) => tr.appendChild(el('td', null, v)));
      tr.appendChild(el('td', null, r.models.map((m) => `${m.provider}: ${m.status === 'SUCCESS' ? `${m.latency}, score ${m.score}` : (LabModel.STATUS_LABELS[m.status] || m.status)}`).join(' | ') || '—'));
      tbody.appendChild(tr);
    });
    holder.appendChild(t);
  }

  async function loadHistory() {
    const filters = {
      provider: $('lab-h-provider').value, source: $('lab-h-source').value,
      since: $('lab-h-since').value, until: $('lab-h-until').value,
    };
    $('lab-h-status').textContent = '';
    const result = await AiLabAPI.history(filters);
    if (result && result.success) renderHistory(result.data);
    else $('lab-h-status').textContent = (result && result.error && result.error.message) || 'Could not load the history.';
  }

  function fillProviderMenu(summary) {
    const select = $('lab-h-provider');
    const keep = select.value;
    select.textContent = '';
    const any = el('option', null, 'All'); any.value = '';
    select.appendChild(any);
    (Array.isArray(summary && summary.models) ? summary.models : []).forEach((m) => {
      const o = el('option', null, String(m.provider)); o.value = String(m.provider); select.appendChild(o);
    });
    select.value = keep;
  }

  function renderRunDiff() {
    const holder = $('lab-h-diff');
    holder.textContent = '';
    const [a, b] = rawRuns.filter((r) => picked.has(String(r.id))).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    if (!a || !b) return;
    const diff = LabModel.compareRuns(a, b);
    holder.appendChild(el('p', 'field-hint', `Older run → newer run (${new Date(Date.parse(a.at)).toLocaleString()} → ${new Date(Date.parse(b.at)).toLocaleString()}). Only models with a valid reply in both runs are compared.`));
    if (diff.rows.length === 0) { holder.appendChild(el('p', 'field-hint', 'No model has a valid reply in both runs.')); return; }
    const sign = (v, unit) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`);
    const num = (v, unit) => (typeof v === 'number' ? `${v}${unit}` : '—');
    const { t, tbody } = table(['Model', 'Latency (older)', 'Latency (newer)', 'Change', 'Score (older)', 'Score (newer)', 'Change']);
    diff.rows.forEach((r) => {
      const tr = el('tr');
      [r.provider, num(r.latencyA, ' ms'), num(r.latencyB, ' ms'), sign(r.latencyDelta, ' ms'), num(r.scoreA, ''), num(r.scoreB, ''), sign(r.scoreDelta, '')]
        .forEach((v) => tr.appendChild(el('td', null, v)));
      tbody.appendChild(tr);
    });
    holder.appendChild(t);
  }

  // ---- form ----------------------------------------------------------------
  function readPreferences() {
    return {
      ingredients: LabModel.parseIngredients($('lab-ingredients').value),
      cuisine: $('lab-cuisine').value,
      mealType: 'Dinner',
      dietaryPreference: $('lab-diet').value,
      cookingTime: Number($('lab-time').value),
      difficulty: 'Medium',
      servings: 2,
    };
  }

  async function withBusy(button, message, work) {
    button.disabled = true;
    $('lab-status').textContent = message;
    try { await work(); } finally { button.disabled = false; }
  }

  function wireForm(isAdmin) {
    $('lab-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const preferences = readPreferences();
      if (preferences.ingredients.length === 0) { $('lab-status').textContent = 'Add at least one ingredient.'; return; }
      withBusy($('lab-run'), 'Asking the models… this can take up to 30 seconds.', async () => {
        const result = await AiLabAPI.compare(preferences, $('lab-mode').value);
        if (!result || !result.success) { showError(result); return; }
        $('lab-status').textContent = '';
        renderComparison(result.data.comparison);
        if (isAdmin) loadAnalytics();
      });
    });

    if (isAdmin) {
      $('lab-admin').classList.remove('hidden');
      $('lab-benchmark').addEventListener('click', () => {
        const preferences = readPreferences();
        if (preferences.ingredients.length === 0) { $('lab-status').textContent = 'Add at least one ingredient.'; return; }
        withBusy($('lab-benchmark'), 'Running benchmark…', async () => {
          const result = await AiLabAPI.benchmark(preferences, Number($('lab-runs').value));
          if (!result || !result.success) { showError(result); return; }
          $('lab-status').textContent = `Benchmark finished (${result.data.runs} run${result.data.runs === 1 ? '' : 's'}).`;
          loadAnalytics();
        });
      });
      $('lab-history-form').addEventListener('submit', (event) => { event.preventDefault(); loadHistory(); });
      $('lab-h-compare').addEventListener('click', renderRunDiff);
      loadAnalytics();
    }
  }

  // ---- start ---------------------------------------------------------------
  async function init() {
    const me = await AuthAPI.me();
    if (!me || !me.success || !me.data || !me.data.user) {
      $('lab-signin-link').href = AuthHelpers.loginUrlFor('ai-lab.html');
      $('lab-signin').classList.remove('hidden');
      return;
    }
    $('lab-main').classList.remove('hidden');
    const models = await AiLabAPI.models();
    if (models && models.success) renderModels(models.data.models); else showError(models);
    wireForm(me.data.user.role === 'ADMIN');
    applyPrefill();
  }

  // The guided generator can hand its request over; fill the form, never auto-run (a comparison costs money).
  function applyPrefill() {
    let raw = null;
    try { raw = sessionStorage.getItem('labPrefill'); sessionStorage.removeItem('labPrefill'); } catch { return; }
    const prefill = raw ? LabModel.prefillFrom(raw) : null;
    if (!prefill) return;
    $('lab-ingredients').value = prefill.ingredients;
    $('lab-cuisine').value = prefill.cuisine;
    $('lab-diet').value = prefill.diet;
    $('lab-time').value = String(prefill.time);
    $('lab-mode').value = prefill.mode;
    $('lab-status').textContent = 'Filled in from the generator. Press "Compare models" to run it.';
  }

  init();
})();
