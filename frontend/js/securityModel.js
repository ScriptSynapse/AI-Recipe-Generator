/**
 * securityModel.js
 * ---------------------------------------------------------------------
 * Pure functions that turn /api/security/stats and /events data into view
 * models for the Security Center. No DOM access (unit-testable in Node;
 * same UMD pattern as labModel.js). Nothing is estimated here: every
 * number is passed through from the server, and a missing one is shown as
 * "—", never as zero.
 */
(function (root) {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const count = (v) => (isNum(v) && v >= 0 ? Math.floor(v) : 0);
  const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

  const WINDOWS = [
    { value: '1h', label: 'Last hour' }, { value: '24h', label: 'Last 24 hours' },
    { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
  ];

  const TYPE_LABELS = {
    PROMPT_INJECTION: 'Prompt injection', XSS_ATTEMPT: 'XSS attempts', RATE_LIMIT: 'Rate-limit violations',
    INVALID_INPUT: 'Invalid input', AI_OUTPUT_REJECTED: 'AI output violations', AUTH_FAILURE: 'Authentication failures',
    UNAUTHORIZED_ACCESS: 'Unauthorized access', MODEL_FAILURE: 'Model failures', SECURITY_SCAN: 'Security scans',
    AUTH_SUCCESS: 'Sign-ins and sign-outs', PRIVILEGE_CHANGE: 'Privilege changes',
  };

  // The headline cards, in display order. 'blocked' is a total, the rest are event types.
  const CARD_TYPES = ['PROMPT_INJECTION', 'XSS_ATTEMPT', 'RATE_LIMIT', 'AUTH_FAILURE', 'AI_OUTPUT_REJECTED'];

  const THREAT = {
    NORMAL: { label: 'Normal', tone: 'ok' },
    ELEVATED: { label: 'Elevated', tone: 'warn' },
    HIGH: { label: 'High', tone: 'bad' },
  };

  function threatView(threat) {
    const known = threat && Object.prototype.hasOwnProperty.call(THREAT, threat.level) ? threat.level : null;
    if (!known) return { level: 'UNKNOWN', label: 'Unknown', tone: 'neutral', reasons: [] };
    const reasons = Array.isArray(threat.reasons) ? threat.reasons.filter((r) => typeof r === 'string').slice(0, 5) : [];
    return { level: known, label: THREAT[known].label, tone: THREAT[known].tone, reasons };
  }

  function cards(stats) {
    const byType = (stats && stats.byType) || {};
    const blocked = stats && stats.totals ? stats.totals.blocked : undefined;
    return [
      { key: 'BLOCKED', label: 'Blocked requests', value: isNum(blocked) ? count(blocked) : null },
      ...CARD_TYPES.map((t) => ({ key: t, label: TYPE_LABELS[t], value: isNum(byType[t]) ? count(byType[t]) : null })),
    ];
  }

  /** Horizontal bars for every event type with at least one event, largest first. */
  function typeBars(stats) {
    const byType = (stats && stats.byType) || {};
    const rows = Object.keys(TYPE_LABELS)
      .map((t) => ({ key: t, label: TYPE_LABELS[t], value: count(byType[t]) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
    return rows.map((r) => ({ ...r, percent: max ? Math.max(2, Math.round((r.value / max) * 100)) : 0 }));
  }

  function bucketLabel(startIso, bucketMs) {
    const d = new Date(startIso);
    if (Number.isNaN(d.getTime())) return '';
    const iso = d.toISOString();
    return bucketMs >= 24 * 60 * 60 * 1000 ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }

  /** Columns for the activity chart: height is relative to the busiest bucket; zero stays zero. */
  function seriesView(series) {
    const buckets = Array.isArray(series && series.buckets) ? series.buckets : [];
    const bucketMs = isNum(series && series.bucketMs) ? series.bucketMs : 0;
    const max = buckets.reduce((m, b) => Math.max(m, count(b && b.total)), 0);
    const columns = buckets.map((b) => {
      const total = count(b && b.total);
      const blocked = Math.min(total, count(b && b.blocked));
      return {
        label: bucketLabel(b && b.start, bucketMs), total, blocked,
        totalPercent: max ? Math.max(total ? 3 : 0, Math.round((total / max) * 100)) : 0,
        blockedPercent: max ? Math.round((blocked / max) * 100) : 0,
      };
    });
    const total = columns.reduce((n, c) => n + c.total, 0);
    return { columns, max, summary: total === 0 ? 'No events in this period.' : `${total} event${total === 1 ? '' : 's'}; busiest period had ${max}.` };
  }

  function statusView(stats) {
    if (!stats || !stats.totals) return { text: 'Security data unavailable.', notes: [] };
    const events = count(stats.totals.events);
    const notes = [];
    const src = stats.source || {};
    if (src.truncated) notes.push('The audit log is large; only the most recent records were counted, so older figures may be understated.');
    if (count(src.skippedCorruptLines) > 0) notes.push(`${count(src.skippedCorruptLines)} unreadable audit line(s) were skipped.`);
    return { text: `Audit logging active — ${events} event${events === 1 ? '' : 's'} recorded in this period.`, notes };
  }

  function eventRow(e) {
    const ts = str(e && e.timestamp, 40);
    const d = new Date(ts);
    return {
      time: Number.isNaN(d.getTime()) ? '—' : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`,
      type: Object.prototype.hasOwnProperty.call(TYPE_LABELS, e && e.type) ? TYPE_LABELS[e.type] : 'Other',
      severity: str(e && e.severity, 10) || '—',
      result: str(e && e.result, 10) || '—',
      provider: str(e && e.provider, 40) || '—',
      action: str(e && e.action, 120) || '—',
      reason: str(e && e.reason, 300) || '—',
    };
  }

  function eventRows(events) {
    return (Array.isArray(events) ? events : []).slice(0, 100).map(eventRow);
  }

  const SecurityModel = { WINDOWS, TYPE_LABELS, threatView, cards, typeBars, seriesView, statusView, eventRows, eventRow };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SecurityModel;
  } else {
    root.SecurityModel = SecurityModel;
  }
})(typeof window !== 'undefined' ? window : this);
