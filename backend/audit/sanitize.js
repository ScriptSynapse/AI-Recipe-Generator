/**
 * Scrubbing for anything that is about to be written to the audit log.
 *
 * Event producers are written to supply only fixed vocabulary, and the
 * tests check that. This is the SECOND line of defence: even if a future
 * producer slips and passes something it shouldn't, the log must still
 * never contain a secret and must never be forgeable.
 *
 *  - Keys whose NAME suggests a secret (password, token, authorization,
 *    cookie, api key, credential, session, secret) are dropped, and their
 *    values are never even inspected.
 *  - String values have control characters removed (so a value cannot
 *    contain a newline and fake a second log line), API-key-shaped and
 *    long token-shaped runs redacted, and length capped.
 *  - Structures are bounded in depth and size, and prototype-polluting
 *    keys are refused.
 */
const SECRET_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|credential|session|bearer/i;
const SAFE_KEY = /^[A-Za-z0-9_.-]{1,40}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const MAX_STRING = 300;
const MAX_DEPTH = 3;
const MAX_KEYS = 30;
const MAX_ARRAY = 50;

/** Redacts secret-shaped substrings, strips control characters, truncates. */
function sanitizeText(value, maxLength = MAX_STRING) {
  let text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/gsk_[A-Za-z0-9]{10,}/g, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]');        // session tokens, hashes, anything key-like
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}...`;
  return text;
}

function sanitizeValue(value, depth) {
  if (value === null) return null;
  switch (typeof value) {
    case 'string': return sanitizeText(value);
    case 'boolean': return value;
    case 'number': return Number.isFinite(value) ? value : undefined;
    case 'object': break;
    default: return undefined;                    // function, symbol, bigint, undefined: dropped
  }
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  const out = {};
  let kept = 0;
  for (const key of Object.keys(value)) {
    if (kept >= MAX_KEYS) break;
    if (FORBIDDEN_KEYS.has(key) || !SAFE_KEY.test(key) || SECRET_KEY.test(key)) continue;
    const cleaned = sanitizeValue(value[key], depth + 1);
    if (cleaned === undefined) continue;
    out[key] = cleaned;
    kept += 1;
  }
  return out;
}

/** Sanitizes the free-form `details` object of an event. Always returns a plain object. */
function sanitizeDetails(details) {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return {};
  return sanitizeValue(details, 0);
}

module.exports = { sanitizeText, sanitizeDetails, SECRET_KEY };
