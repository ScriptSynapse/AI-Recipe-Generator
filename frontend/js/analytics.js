/**
 * analytics.js -- admin Analytics page: provider status and lifetime model
 * figures. Text-only rendering; access is decided by the server (403).
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

  function renderProviders(models) {
    const list = $('an-providers');
    list.textContent = '';
    const rows = DashboardModel.modelRows(models);
    if (rows.length === 0) { list.appendChild(el('li', 'dash-meta', 'Provider status unavailable.')); return; }
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

  function renderModels(summary) {
    const holder = $('an-models');
    holder.textContent = '';
    const rows = LabModel.analyticsRows(summary);
    if (rows.length === 0) { holder.appendChild(el('p', 'field-hint', 'No comparisons recorded yet.')); return; }
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

  async function init() {
    const me = await AuthAPI.me();
    if (!me || !me.success || !me.data || !me.data.user) {
      $('an-signin-link').href = AuthHelpers.loginUrlFor('analytics.html');
      $('an-signin').classList.remove('hidden');
      return;
    }
    if (me.data.user.role !== 'ADMIN') { $('an-denied').classList.remove('hidden'); return; }
    $('an-main').classList.remove('hidden');
    const [providers, analytics] = await Promise.all([AiLabAPI.providers(), AiLabAPI.analytics()]);
    renderProviders(ok(providers) ? providers.data.models : null);
    if (ok(analytics)) renderModels(analytics.data); else $('an-status').textContent = 'Analytics could not be loaded.';
  }

  init();
})();
