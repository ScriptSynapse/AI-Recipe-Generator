/**
 * dashboardModel.js
 * ---------------------------------------------------------------------
 * Pure view-model for the dashboard (same UMD pattern as labModel.js).
 * Every figure comes from a server response; a missing or failed source is
 * shown as "—" and never as zero, and never estimated.
 */
(function (root) {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
  const show = (v) => (isNum(v) ? String(Math.floor(v)) : '—');

  const MODEL_STATUS = {
    AVAILABLE: { label: 'Available', tone: 'ok' },
    API_KEY_MISSING: { label: 'API key missing', tone: 'neutral' },
    UNAVAILABLE: { label: 'Unavailable', tone: 'bad' },
    TIMEOUT: { label: 'Timeout', tone: 'warn' },
    RATE_LIMITED: { label: 'Rate limited', tone: 'warn' },
  };

  /** Tiles. Each source may be null (not loaded / not permitted) -> "—". */
  function tiles({ usage, saved, models, security }) {
    const totals = usage && usage.totals;
    const modelList = Array.isArray(models) ? models : null;
    const active = modelList ? modelList.filter((m) => m && m.available === true).length : null;
    const tilesOut = [
      { key: 'generated', label: 'Recipes generated', value: show(totals && totals.generated), note: 'by you' },
      { key: 'ai', label: 'AI requests', value: show(totals && totals.aiRequests), note: 'calls that reached a model' },
      { key: 'saved', label: 'Saved recipes', value: show(saved), note: '' },
      { key: 'models', label: 'Active models', value: show(active), note: modelList ? `of ${modelList.length} supported` : '' },
    ];
    if (security) {
      tilesOut.push({ key: 'security', label: 'Security events', value: show(security.totals && security.totals.events), note: 'last 24 hours' });
    }
    return tilesOut;
  }

  function recentRecipes(recipes) {
    if (!Array.isArray(recipes)) return [];
    return recipes
      .filter((r) => r && typeof r === 'object')
      .slice()
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
      .slice(0, 5)
      .map((r) => ({
        id: str(r.id, 80), name: str(r.name, 80) || 'Untitled recipe', cuisine: str(r.cuisine, 40),
        date: /^\d{4}-\d{2}-\d{2}/.test(str(r.savedAt, 40)) ? str(r.savedAt, 10) : '',
      }));
  }

  function modelRows(models) {
    if (!Array.isArray(models)) return [];
    return models.filter((m) => m && typeof m === 'object').map((m) => {
      const known = Object.prototype.hasOwnProperty.call(MODEL_STATUS, m.status) ? MODEL_STATUS[m.status] : null;
      const fallback = m.available === true ? MODEL_STATUS.AVAILABLE : { label: 'Not configured', tone: 'neutral' };
      const s = known || fallback;
      return { provider: str(m.provider, 40), model: str(m.model, 60), label: s.label, tone: m.available === true ? 'ok' : s.tone };
    });
  }

  function activity(series) {
    const days = Array.isArray(series) ? series : [];
    const rows = days.map((d) => ({ date: str(d && d.date, 10), generated: isNum(d && d.generated) ? d.generated : 0, aiRequests: isNum(d && d.aiRequests) ? d.aiRequests : 0 }));
    const max = rows.reduce((m, r) => Math.max(m, r.generated), 0);
    const total = rows.reduce((n, r) => n + r.generated, 0);
    return {
      columns: rows.map((r) => ({ ...r, percent: max ? Math.max(r.generated ? 4 : 0, Math.round((r.generated / max) * 100)) : 0 })),
      summary: total === 0 ? 'No recipes generated in this period.' : `${total} recipe${total === 1 ? '' : 's'} generated in the last ${rows.length} days.`,
    };
  }

  const THREAT_LABEL = { NORMAL: ['Normal', 'ok'], ELEVATED: ['Elevated', 'warn'], HIGH: ['High', 'bad'] };
  function securityStatus(stats) {
    if (!stats) return null;
    const entry = stats.threat && Object.prototype.hasOwnProperty.call(THREAT_LABEL, stats.threat.level) ? THREAT_LABEL[stats.threat.level] : null;
    return {
      level: entry ? entry[0] : 'Unknown', tone: entry ? entry[1] : 'neutral',
      blocked: show(stats.totals && stats.totals.blocked),
      reasons: Array.isArray(stats.threat && stats.threat.reasons) ? stats.threat.reasons.filter((r) => typeof r === 'string').slice(0, 3) : [],
    };
  }

  const DashboardModel = { tiles, recentRecipes, modelRows, activity, securityStatus };
  if (typeof module !== 'undefined' && module.exports) module.exports = DashboardModel; else root.DashboardModel = DashboardModel;
})(typeof window !== 'undefined' ? window : this);
