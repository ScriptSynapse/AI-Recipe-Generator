/**
 * The audit log's vocabulary. The first nine types are the ones named in
 * the project spec; AUTH_SUCCESS and PRIVILEGE_CHANGE are added because an
 * audit trail that records failed logins but not successful ones, or
 * privilege escalation, would be missing half the story (the spec's list
 * is "events include", not "events are").
 */
const EVENT_TYPES = Object.freeze({
  PROMPT_INJECTION: 'PROMPT_INJECTION',
  XSS_ATTEMPT: 'XSS_ATTEMPT',
  RATE_LIMIT: 'RATE_LIMIT',                 // request refused with HTTP 429 (Phase N)
  INVALID_INPUT: 'INVALID_INPUT',
  AI_OUTPUT_REJECTED: 'AI_OUTPUT_REJECTED',
  AUTH_FAILURE: 'AUTH_FAILURE',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  MODEL_FAILURE: 'MODEL_FAILURE',
  SECURITY_SCAN: 'SECURITY_SCAN',
  AUTH_SUCCESS: 'AUTH_SUCCESS',             // login, registration, logout
  PRIVILEGE_CHANGE: 'PRIVILEGE_CHANGE',     // a role was changed
});

const SEVERITIES = Object.freeze({ INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' });

const RESULTS = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
  BLOCKED: 'BLOCKED',     // a security control stopped the request
  DENIED: 'DENIED',       // authentication/authorization refused it
  REJECTED: 'REJECTED',   // the input or output was invalid and was not accepted
});

// A "blocked request" is any request a security control stopped.
const BLOCKED_RESULTS = Object.freeze([RESULTS.BLOCKED, RESULTS.DENIED, RESULTS.REJECTED]);

const isEventType = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(EVENT_TYPES, v);
const isSeverity = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEVERITIES, v);
const isResult = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(RESULTS, v);

module.exports = { EVENT_TYPES, SEVERITIES, RESULTS, BLOCKED_RESULTS, isEventType, isSeverity, isResult };
