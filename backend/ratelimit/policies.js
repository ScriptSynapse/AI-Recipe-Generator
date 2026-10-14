/**
 * Which limit applies to whom. Three tiers (anonymous < user < admin) and
 * three classes of endpoint:
 *   api       everything under /api            (cheap reads/writes)
 *   generate  endpoints that run the AI engine (slow, and may cost money)
 *   compare   AI Model Lab comparison         (one call fans out to every provider)
 *   benchmark AI Model Lab benchmark (admin)   (up to 3 comparisons per call)
 *   auth      login / register                 (keyed by IP; see LoginThrottle for failures)
 * `capacity` (the burst) equals the per-minute rate, so a client can spend
 * a minute's allowance at once, then is held to the steady rate.
 */
const TIERS = Object.freeze({ ANONYMOUS: 'anonymous', USER: 'user', ADMIN: 'admin' });

function tierOf(req) {
  const user = req.auth && req.auth.user;
  if (!user) return TIERS.ANONYMOUS;
  return user.role === 'ADMIN' ? TIERS.ADMIN : TIERS.USER;     // unknown roles get the USER tier, never more
}

function buildPolicies(limits) {
  const p = (perMin) => ({ capacity: perMin, refillPerMinute: perMin });
  return Object.freeze({
    api: Object.freeze({
      [TIERS.ANONYMOUS]: p(limits.apiAnonymousPerMin),
      [TIERS.USER]: p(limits.apiUserPerMin),
      [TIERS.ADMIN]: p(limits.apiAdminPerMin),
    }),
    generate: Object.freeze({
      [TIERS.ANONYMOUS]: p(limits.generateAnonymousPerMin),
      [TIERS.USER]: p(limits.generateUserPerMin),
      [TIERS.ADMIN]: p(limits.generateAdminPerMin),
    }),
    compare: Object.freeze({
      [TIERS.ANONYMOUS]: p(limits.compareUserPerMin),     // anonymous callers are refused earlier (login required)
      [TIERS.USER]: p(limits.compareUserPerMin),
      [TIERS.ADMIN]: p(limits.compareAdminPerMin),
    }),
    benchmark: Object.freeze({
      [TIERS.ANONYMOUS]: p(limits.benchmarkPerMin),
      [TIERS.USER]: p(limits.benchmarkPerMin),
      [TIERS.ADMIN]: p(limits.benchmarkPerMin),
    }),
    auth: Object.freeze({
      [TIERS.ANONYMOUS]: p(limits.authPerMin),
      [TIERS.USER]: p(limits.authPerMin),
      [TIERS.ADMIN]: p(limits.authPerMin),
    }),
  });
}

module.exports = { TIERS, tierOf, buildPolicies };
