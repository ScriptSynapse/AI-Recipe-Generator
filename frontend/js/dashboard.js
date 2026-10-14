/**
 * dashboard.js -- the home page. Signed out: a short intro with sign-in.
 * Signed in: tiles, recent recipes, model status, activity and (admins
 * only) security status. Each panel loads on its own, so one failing
 * source never blanks the rest. All text goes in via textContent.
 * Whether data is returned at all is decided by the server.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const ok = (r) => Boolean(r && r.success && r.data);

  function renderTiles(sources) {
    const holder = $('dash-tiles');
    holder.textContent = '';
    DashboardModel.tiles(sources).forEach((t) => {
      const tile = el('div', 'card stat-tile');
      tile.appendChild(el('div', 'stat-value', t.value));
      tile.appendChild(el('div', 'stat-label', t.label));
      if (t.note) tile.appendChild(el('div', 'stat-note', t.note));
      holder.appendChild(tile);
    });
  }

  function renderRecent(recipes) {
    const list = $('dash-recent');
    list.textContent = '';
    const rows = DashboardModel.recentRecipes(recipes);
    if (rows.length === 0) { list.appendChild(el('li', 'dash-meta', 'No saved recipes yet.')); return; }
    rows.forEach((r) => {
      const li = el('li');
      const link = el('a', null, r.name);
      link.href = 'recipes.html';
      li.appendChild(link);
      li.appendChild(el('span', 'dash-meta', [r.cuisine, r.date].filter(Boolean).join(' · ')));
      list.appendChild(li);
    });
  }

  function renderModels(models) {
    const list = $('dash-models');
    list.textContent = '';
    const rows = DashboardModel.modelRows(models);
    if (rows.length === 0) { list.appendChild(el('li', 'dash-meta', 'Model status unavailable.')); return; }
    rows.forEach((m) => {
      const li = el('li');
      const name = el('span');
      name.appendChild(el('span', `dash-dot dash-dot-${m.tone}`));
      name.appendChild(document.createTextNode(`${m.provider} `));
      name.appendChild(el('span', 'dash-meta', m.model));
      li.appendChild(name);
      li.appendChild(el('span', 'dash-meta', m.label));
      list.appendChild(li);
    });
  }

  function renderActivity(usage) {
    const view = DashboardModel.activity(usage && usage.series);
    const chart = $('dash-activity');
    chart.textContent = '';
    chart.setAttribute('aria-label', `Recipes generated per day. ${view.summary}`);
    view.columns.forEach((c) => {
      const col = el('div', 'sec-col');
      col.title = `${c.date}: ${c.generated} generated, ${c.aiRequests} AI request${c.aiRequests === 1 ? '' : 's'}`;
      const bar = el('div', 'sec-col-total dash-bar');
      bar.style.height = `${c.percent}%`;
      col.appendChild(bar);
      chart.appendChild(col);
    });
    $('dash-activity-summary').textContent = view.summary;
  }

  function renderSecurity(stats) {
    const view = DashboardModel.securityStatus(stats);
    const box = $('dash-security');
    box.textContent = '';
    if (!view) { box.appendChild(el('p', 'dash-meta', 'Security status unavailable.')); return; }
    box.appendChild(el('span', `sec-threat-badge sec-tone-${view.tone}`, `Threat level: ${view.level}`));
    box.appendChild(el('p', 'dash-meta', `${view.blocked} blocked request${view.blocked === '1' ? '' : 's'} in the last 24 hours.`));
    view.reasons.forEach((r) => box.appendChild(el('p', 'dash-meta', r)));
    const link = el('a', null, 'Open Security Center');
    link.href = 'security.html';
    box.appendChild(link);
  }

  async function loadSignedIn(user) {
    $('dash-welcome-name').textContent = user.username;
    $('dash-user').classList.remove('hidden');
    const isAdmin = user.role === 'ADMIN';
    const [usage, saved, models, security] = await Promise.all([
      UsageAPI.me(), RecipeAPI.list(), AiLabAPI.models(), isAdmin ? SecurityAPI.stats('24h') : Promise.resolve(null),
    ]);
    const sources = {
      usage: ok(usage) ? usage.data : null,
      saved: ok(saved) && Array.isArray(saved.data.recipes) ? saved.data.recipes.length : null,
      models: ok(models) ? models.data.models : null,
      security: isAdmin && ok(security) ? security.data : null,
    };
    renderTiles(sources);
    renderRecent(ok(saved) ? saved.data.recipes : null);
    renderModels(sources.models);
    renderActivity(sources.usage);
    if (isAdmin) { $('dash-security-panel').classList.remove('hidden'); renderSecurity(sources.security); }
  }

  async function init() {
    const me = await AuthAPI.me();
    if (!me || !me.success || !me.data || !me.data.user) { $('dash-guest').classList.remove('hidden'); return; }
    await loadSignedIn(me.data.user);
  }

  init();
})();
