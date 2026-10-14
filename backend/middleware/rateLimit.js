/**
 * Express adapter for RateLimiter (one middleware per endpoint class).
 *
 * - Identity: the logged-in user's id, otherwise the client IP. (Behind a
 *   reverse proxy, set TRUST_PROXY_HOPS so req.ip is the real client and
 *   not the proxy; never trust X-Forwarded-For blindly.)
 * - Auth endpoints are always keyed by IP, so one IP can't dodge the limit
 *   by registering accounts.
 * - Refusals are HTTP 429 with Retry-After, and published as
 *   'ratelimit.exceeded' for the audit log -- but at most once per key per
 *   AUDIT_INTERVAL_MS (with a count of what was suppressed), so a client
 *   hammering the API can't fill the audit log: the limiter would
 *   otherwise turn into a log-flood weapon.
 */
const { errorBody } = require('./errorHandler');
const { tierOf, TIERS } = require('../ratelimit/policies');
const { requestContext } = require('../audit/requestContext');

const { AuditGate } = require('../ratelimit/AuditGate');

function createRateLimit({ limiter, policies, events, now = () => Date.now() }) {
  const gate = new AuditGate({ now });
  const shouldAudit = (key) => gate.admit(key);

  return function rateLimit(className, { byIpOnly = false } = {}) {
    const classPolicies = policies[className];
    if (!classPolicies) throw new Error(`Unknown rate-limit class: ${className}`);

    return function rateLimitMiddleware(req, res, next) {
      const tier = byIpOnly ? TIERS.ANONYMOUS : tierOf(req);
      const user = !byIpOnly && req.auth && req.auth.user;
      const subject = user ? `u:${user.id}` : `ip:${req.ip}`;
      const key = `${className}:${subject}`;
      const result = limiter.consume(key, classPolicies[tier]);

      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(result.resetSec));
      if (result.allowed) return next();

      res.setHeader('Retry-After', String(result.retryAfterSec));
      const audit = events && shouldAudit(key);
      if (audit) {
        events.emit('ratelimit.exceeded', {
          ...requestContext(req), className, tier, limit: result.limit,
          retryAfterSec: result.retryAfterSec, suppressed: audit.suppressed,
        });
      }
      const body = errorBody('RATE_LIMITED', `Too many requests. Please try again in ${result.retryAfterSec} second${result.retryAfterSec === 1 ? '' : 's'}.`);
      body.error.retryAfterSec = result.retryAfterSec;
      return res.status(429).json(body);
    };
  };
}

module.exports = { createRateLimit };
