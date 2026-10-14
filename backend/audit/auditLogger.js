/**
 * AuditLogger -- the Observer that turns the app's event bus into audit
 * records. Producers (AuthService, the authorization gate, the validators,
 * and the C++ engine via engineEvents.js) publish events without knowing
 * or caring whether anyone is recording them; this is the one place that
 * decides how each becomes a SecurityAuditLog entry.
 *
 * Recording must never break a request, so a failure to write is caught
 * and reported LOUDLY on the server console instead of propagating. That
 * keeps the app available, at the price of a gap in the audit trail --
 * which is why the failure is reported rather than swallowed.
 *
 * Severity guide used below:
 *   INFO    routine, expected (successful login, clean scan)
 *   LOW     worth recording, not alarming (one failed login, malformed input,
 *           an unauthenticated request, a transient provider failure)
 *   MEDIUM  a real control fired (permission denied, AI output rejected, rate limit hit)
 *   HIGH    an attack was blocked, or privilege changed
 */
const { EVENT_TYPES, SEVERITIES, RESULTS, isEventType, isSeverity, isResult } = require('./auditEvents');

const action = (p) => `${p.method || '?'} ${p.path || '?'}`;

function mapEngineEvent(payload) {
  const e = payload.event || {};
  const known = isEventType(e.type) && isSeverity(e.severity) && isResult(e.result);
  const common = { requestId: payload.requestId, userId: payload.userId, ip: payload.ip };
  if (!known) {
    // The engine and the server have drifted apart. Keep the fact that
    // SOMETHING happened -- but trust none of the unrecognised fields.
    return {
      ...common, type: EVENT_TYPES.SECURITY_SCAN, severity: SEVERITIES.MEDIUM, action: 'engine_event',
      result: RESULTS.FAILURE, reason: 'Unrecognised security event received from the engine.',
    };
  }
  return {
    ...common, type: e.type, severity: e.severity, action: e.action, result: e.result,
    reason: e.reason, provider: e.provider, details: e.details,
  };
}

/** The mapping from each bus event to an audit record. */
const MAPPINGS = {
  'auth.login_failure': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_FAILURE, severity: SEVERITIES.LOW, action: 'login', result: RESULTS.FAILURE,
    reason: 'Login failed.',
    details: { cause: p.reason, usernameFingerprint: p.usernameFingerprint },
  }),
  'auth.login_success': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_SUCCESS, severity: SEVERITIES.INFO, action: 'login', result: RESULTS.SUCCESS, reason: 'Login succeeded.',
  }),
  'auth.registered': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_SUCCESS, severity: SEVERITIES.INFO, action: 'register', result: RESULTS.SUCCESS, reason: 'Account registered.',
  }),
  'auth.logout': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_SUCCESS, severity: SEVERITIES.INFO, action: 'logout', result: RESULTS.SUCCESS, reason: 'Logged out.',
  }),
  'auth.password_changed': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_SUCCESS, severity: SEVERITIES.INFO, action: 'password_change', result: RESULTS.SUCCESS,
    reason: 'Password changed.', details: { sessionsRevoked: p.sessionsRevoked },
  }),
  'auth.password_change_failure': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.AUTH_FAILURE, severity: SEVERITIES.LOW, action: 'password_change', result: RESULTS.FAILURE,
    reason: 'Password change failed.', details: { cause: p.reason },
  }),
  'auth.unauthenticated_access': (p) => ({
    requestId: p.requestId, ip: p.ip,
    type: EVENT_TYPES.UNAUTHORIZED_ACCESS, severity: SEVERITIES.LOW, action: action(p), result: RESULTS.DENIED,
    reason: 'Authentication required.',
  }),
  'authz.denied': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.UNAUTHORIZED_ACCESS, severity: SEVERITIES.MEDIUM, action: action(p), result: RESULTS.DENIED,
    reason: 'Permission denied.', details: { permission: p.permission, role: p.role },
  }),
  'auth.role_changed': (p) => ({
    requestId: p.requestId, userId: p.userId,
    type: EVENT_TYPES.PRIVILEGE_CHANGE, severity: SEVERITIES.HIGH, action: 'role_change', result: RESULTS.SUCCESS,
    reason: 'Account role changed.', details: { from: p.from, to: p.to, actor: p.actor },
  }),
  'http.invalid_input': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.INVALID_INPUT, severity: SEVERITIES.LOW, action: action(p), result: RESULTS.REJECTED,
    reason: 'Request was malformed.', details: { code: p.code, status: p.status },
  }),
  'ratelimit.exceeded': (p) => ({
    requestId: p.requestId, ip: p.ip, userId: p.userId,
    type: EVENT_TYPES.RATE_LIMIT, severity: SEVERITIES.MEDIUM, action: action(p), result: RESULTS.BLOCKED,
    reason: p.className === 'login' ? 'Too many failed sign-in attempts.' : 'Rate limit exceeded.',
    details: { class: p.className, tier: p.tier, limit: p.limit, retryAfterSec: p.retryAfterSec, suppressedSinceLast: p.suppressed },
  }),
  'security.engine_event': mapEngineEvent,
};

/**
 * Subscribes the audit log to every mapped event on `events`.
 * @returns {() => void} a function that unsubscribes again
 */
function attachAuditLogger({ events, auditLog, logger = console }) {
  const listeners = Object.entries(MAPPINGS).map(([name, map]) => {
    const listener = (payload) => {
      try {
        auditLog.record(map(payload || {}));
      } catch (err) {
        logger.error(`[audit] FAILED to record "${name}" -- the audit trail has a gap: ${err.name}: ${err.message}`);
      }
    };
    events.on(name, listener);
    return [name, listener];
  });
  return () => listeners.forEach(([name, listener]) => events.removeListener(name, listener));
}

module.exports = { attachAuditLogger, MAPPINGS };
