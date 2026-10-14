/**
 * security.js -- the Security Center page (admin only).
 * All server data is added with textContent / DOM nodes, never as HTML.
 * Who may see the data is decided by the server (403 for non-admins);
 * the sign-in / not-authorised messages here are display only.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(id, visible) {
    if (visible) $(id).classList.remove('hidden'); else $(id).classList.add('hidden');
  }

  function setStatus(message) { $('sec-status').textContent = message || ''; }

  function errorMessage(result) {
    return result && result.error && result.error.message ? result.error.message : 'Something went wrong. Please try again.';
  }

  // ---- render ----------------------------------------------------------------
  function renderThreat(stats) {
    const t = SecurityModel.threatView(stats.threat);
    const box = $('sec-threat');
    box.textContent = '';
    box.appendChild(el('span', `sec-threat-badge sec-tone-${t.tone}`, t.label));
    const reasons = el('ul', 'sec-reasons');
    if (t.reasons.length === 0) reasons.appendChild(el('li', null, 'No elevated activity in the last hour.'));
    t.reasons.forEach((r) => reasons.appendChild(el('li', null, r)));
    box.appendChild(reasons);

    const status = SecurityModel.statusView(stats);
    $('sec-status-line').textContent = status.text;
    const notes = $('sec-notes');
    notes.textContent = '';
    status.notes.forEach((n) => notes.appendChild(el('li', null, n)));
  }

  function renderCards(stats) {
    const holder = $('sec-cards');
    holder.textContent = '';
    SecurityModel.cards(stats).forEach((c) => {
      const card = el('div', 'card sec-card');
      card.appendChild(el('div', 'sec-card-value', c.value === null ? '—' : String(c.value)));
      card.appendChild(el('div', 'sec-card-label', c.label));
      holder.appendChild(card);
    });
  }

  function renderSeries(stats) {
    const view = SecurityModel.seriesView(stats.series);
    const chart = $('sec-series');
    chart.textContent = '';
    chart.setAttribute('aria-label', `Events over time. ${view.summary}`);
    view.columns.forEach((c) => {
      const col = el('div', 'sec-col');
      col.title = `${c.label}: ${c.total} event${c.total === 1 ? '' : 's'}, ${c.blocked} blocked`;
      const total = el('div', 'sec-col-total');
      total.style.height = `${c.totalPercent}%`;
      const blocked = el('div', 'sec-col-blocked');
      blocked.style.height = `${c.blockedPercent}%`;
      col.appendChild(total);
      col.appendChild(blocked);
      chart.appendChild(col);
    });
    $('sec-series-summary').textContent = view.summary;
  }

  function renderTypes(stats) {
    const holder = $('sec-types');
    holder.textContent = '';
    const rows = SecurityModel.typeBars(stats);
    if (rows.length === 0) { holder.appendChild(el('p', 'field-hint', 'No security events recorded in this period.')); return; }
    rows.forEach((r) => {
      const row = el('div', 'lab-score');
      row.appendChild(el('span', 'lab-score-label', r.label));
      const track = el('div', 'lab-score-track');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label', `${r.label}: ${r.value}`);
      const fill = el('div', 'lab-score-fill');
      fill.style.width = `${r.percent}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'lab-score-value', String(r.value)));
      holder.appendChild(row);
    });
  }

  function renderEvents(events) {
    const holder = $('sec-events');
    holder.textContent = '';
    const rows = SecurityModel.eventRows(events);
    if (rows.length === 0) { holder.appendChild(el('p', 'field-hint', 'No events recorded yet.')); return; }
    const table = el('table', 'lab-table');
    const thead = el('thead');
    const hr = el('tr');
    ['Time', 'Event', 'Severity', 'Result', 'Provider', 'Reason'].forEach((h) => {
      const th = el('th', null, h); th.scope = 'col'; hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      [r.time, r.type, r.severity, r.result, r.provider, r.reason].forEach((v) => tr.appendChild(el('td', null, v)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    holder.appendChild(table);
  }

  // ---- loading ---------------------------------------------------------------
  async function load() {
    const windowName = $('sec-window').value;
    const [stats, events] = await Promise.all([SecurityAPI.stats(windowName), SecurityAPI.events(20)]);
    if (!stats || !stats.success) { setStatus(errorMessage(stats)); return; }
    setStatus('');
    renderThreat(stats.data);
    renderCards(stats.data);
    renderSeries(stats.data);
    renderTypes(stats.data);
    if (events && events.success) renderEvents(events.data.events); else renderEvents([]);
  }

  function fillWindows() {
    const select = $('sec-window');
    SecurityModel.WINDOWS.forEach((w) => {
      const option = el('option', null, w.label);
      option.value = w.value;
      if (w.value === '24h') option.selected = true;
      select.appendChild(option);
    });
    select.value = '24h';
    select.addEventListener('change', load);
    $('sec-refresh').addEventListener('click', load);
  }

  async function init() {
    const me = await AuthAPI.me();
    if (!me || !me.success || !me.data || !me.data.user) {
      $('sec-signin-link').href = AuthHelpers.loginUrlFor('security.html');
      show('sec-signin', true);
      return;
    }
    if (me.data.user.role !== 'ADMIN') { show('sec-denied', true); return; }
    show('sec-main', true);
    fillWindows();
    await load();
  }

  init();
})();
