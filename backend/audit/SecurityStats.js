/**
 * SecurityStats -- aggregates the audit log into the figures the Security
 * Center shows. Every number is a count of real audit records; nothing is
 * estimated, smoothed or invented, and an empty log yields all zeros.
 *
 * Threat level is a deliberately simple, documented rule over the LAST
 * HOUR (not the whole window), so the headline reflects what is happening
 * now rather than last week:
 *
 *   HIGH      >= 3 HIGH-severity events, or >= 20 blocked requests
 *   ELEVATED  >= 1 HIGH-severity event, or >= 5 blocked requests,
 *             or >= 10 MEDIUM-severity events
 *   NORMAL    otherwise
 *
 * The reasons that tripped the level are returned with fixed text, so the
 * UI can say *why* instead of just showing a colour.
 */
const { EVENT_TYPES, SEVERITIES, RESULTS, BLOCKED_RESULTS } = require('./auditEvents');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// window name -> { span, bucketMs }. Windows are >= 1h so the "last hour"
// threat figures always lie inside the window being scanned.
const WINDOWS = Object.freeze({
  '1h': { spanMs: HOUR, bucketMs: 5 * 60 * 1000 },
  '24h': { spanMs: DAY, bucketMs: HOUR },
  '7d': { spanMs: 7 * DAY, bucketMs: DAY },
  '30d': { spanMs: 30 * DAY, bucketMs: DAY },
});
const DEFAULT_WINDOW = '24h';

const THRESHOLDS = Object.freeze({
  highSeverityForHigh: 3, blockedForHigh: 20,
  highSeverityForElevated: 1, blockedForElevated: 5, mediumForElevated: 10,
});

const zeroFilled = (keys) => Object.fromEntries(Object.keys(keys).map((k) => [k, 0]));

function assessThreat({ recentHigh, recentMedium, recentBlocked }) {
  const reasons = [];
  let level = 'NORMAL';
  const rank = { NORMAL: 0, ELEVATED: 1, HIGH: 2 };
  const raise = (to, text) => {
    reasons.push(text);
    if (rank[to] > rank[level]) level = to;
  };
  if (recentHigh >= THRESHOLDS.highSeverityForHigh) raise('HIGH', 'Several high-severity events in the last hour.');
  else if (recentHigh >= THRESHOLDS.highSeverityForElevated) raise('ELEVATED', 'A high-severity event in the last hour.');
  if (recentBlocked >= THRESHOLDS.blockedForHigh) raise('HIGH', 'A large number of blocked requests in the last hour.');
  else if (recentBlocked >= THRESHOLDS.blockedForElevated) raise('ELEVATED', 'Multiple blocked requests in the last hour.');
  if (recentMedium >= THRESHOLDS.mediumForElevated) raise('ELEVATED', 'Many medium-severity events in the last hour.');
  return { level, reasons, basis: { windowMs: HOUR, recentHigh, recentMedium, recentBlocked } };
}

class SecurityStats {
  constructor({ auditLog, now = () => Date.now() }) {
    this.auditLog = auditLog;
    this.now = now;
  }

  static isWindow(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(WINDOWS, name);
  }

  /** @throws {RangeError} for an unknown window name. */
  compute(windowName = DEFAULT_WINDOW) {
    if (!SecurityStats.isWindow(windowName)) throw new RangeError('Unknown window.');
    const { spanMs, bucketMs } = WINDOWS[windowName];
    const until = this.now();
    const since = until - spanMs;
    const bucketCount = Math.ceil(spanMs / bucketMs);

    const byType = zeroFilled(EVENT_TYPES);
    const bySeverity = zeroFilled(SEVERITIES);
    const byResult = zeroFilled(RESULTS);
    const modelFailuresByProvider = {};
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ start: new Date(since + i * bucketMs).toISOString(), total: 0, blocked: 0 }));
    let total = 0;
    let blocked = 0;
    let recentHigh = 0;
    let recentMedium = 0;
    let recentBlocked = 0;

    const scan = this.auditLog.scan((e) => {
      const t = Date.parse(e.timestamp);
      if (!Number.isFinite(t) || t < since || t > until) return;
      const isBlocked = BLOCKED_RESULTS.includes(e.result);
      total += 1;
      byType[e.type] += 1;
      if (e.severity in bySeverity) bySeverity[e.severity] += 1;
      if (e.result in byResult) byResult[e.result] += 1;
      if (isBlocked) blocked += 1;
      if (e.type === EVENT_TYPES.MODEL_FAILURE && e.provider) {
        modelFailuresByProvider[e.provider] = (modelFailuresByProvider[e.provider] || 0) + 1;
      }
      const index = Math.min(bucketCount - 1, Math.floor((t - since) / bucketMs));
      buckets[index].total += 1;
      if (isBlocked) buckets[index].blocked += 1;
      if (t >= until - HOUR) {
        if (e.severity === SEVERITIES.HIGH) recentHigh += 1;
        if (e.severity === SEVERITIES.MEDIUM) recentMedium += 1;
        if (isBlocked) recentBlocked += 1;
      }
    });

    return {
      window: windowName,
      since: new Date(since).toISOString(),
      until: new Date(until).toISOString(),
      totals: { events: total, blocked },
      byType, bySeverity, byResult, modelFailuresByProvider,
      series: { bucketMs, buckets },
      threat: assessThreat({ recentHigh, recentMedium, recentBlocked }),
      source: { recordsScanned: scan.scanned, truncated: scan.truncated, skippedCorruptLines: scan.skippedCorruptLines },
    };
  }
}

module.exports = { SecurityStats, WINDOWS, DEFAULT_WINDOW, THRESHOLDS, assessThreat };
