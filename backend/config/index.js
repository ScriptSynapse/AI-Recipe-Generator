/**
 * Centralised configuration for the Node server.
 * ---------------------------------------------------------------------
 * One place that reads environment variables, validates them and applies
 * safe defaults. Anything unparseable or out of range falls back to the
 * default (and is clamped), so a typo in .env can weaken nothing silently:
 * limits can be tuned, but never to zero, negative or NaN.
 *
 * Pure function of its input (`env`), so tests pass a plain object.
 */
const num = (raw, def, min, max) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
};

function parseOrigins(raw) {
  if (!raw) return [];
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;                       // normalised: no path, no trailing slash
  }).filter(Boolean);
}

function parseTrustProxy(raw) {
  // Number of proxy hops to trust (X-Forwarded-For). Default 0: never trust
  // the header, because a client can set it to anything and would then pick
  // its own rate-limit bucket.
  return num(raw, 0, 0, 10);
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  return Object.freeze({
    production,
    port: num(env.PORT, 3000, 1, 65535),
    trustProxyHops: parseTrustProxy(env.TRUST_PROXY_HOPS),
    // Empty list => same-origin only (no CORS headers are sent at all).
    corsOrigins: Object.freeze(parseOrigins(env.CORS_ORIGINS)),
    jsonBodyLimit: env.JSON_BODY_LIMIT || '200kb',
    hsts: production || env.COOKIE_SECURE === 'true',
    rateLimits: Object.freeze({
      // requests per minute (token-bucket refill); burst = capacity
      apiAnonymousPerMin: num(env.RATE_API_ANON_PER_MIN, 60, 1, 100000),
      apiUserPerMin: num(env.RATE_API_USER_PER_MIN, 120, 1, 100000),
      apiAdminPerMin: num(env.RATE_API_ADMIN_PER_MIN, 300, 1, 100000),
      generateAnonymousPerMin: num(env.RATE_GEN_ANON_PER_MIN, 5, 1, 10000),
      generateUserPerMin: num(env.RATE_GEN_USER_PER_MIN, 15, 1, 10000),
      generateAdminPerMin: num(env.RATE_GEN_ADMIN_PER_MIN, 60, 1, 10000),
      // AI Model Lab: one comparison calls EVERY configured provider, so it is limited far harder.
      compareUserPerMin: num(env.RATE_COMPARE_USER_PER_MIN, 3, 1, 1000),
      compareAdminPerMin: num(env.RATE_COMPARE_ADMIN_PER_MIN, 10, 1, 1000),
      benchmarkPerMin: num(env.RATE_BENCHMARK_PER_MIN, 2, 1, 100),
      authPerMin: num(env.RATE_AUTH_PER_MIN, 10, 1, 1000),
      loginMaxFailuresPerAccountIp: num(env.LOGIN_MAX_FAILURES, 5, 1, 1000),
      loginMaxFailuresPerIp: num(env.LOGIN_MAX_FAILURES_PER_IP, 20, 1, 10000),
      loginWindowMinutes: num(env.LOGIN_LOCK_MINUTES, 15, 1, 24 * 60),
    }),
    timeouts: Object.freeze({
      requestMs: num(env.REQUEST_TIMEOUT_MS, 60000, 1000, 600000),
      headersMs: num(env.HEADERS_TIMEOUT_MS, 15000, 1000, 120000),
      keepAliveMs: num(env.KEEPALIVE_TIMEOUT_MS, 5000, 1000, 120000),
    }),
  });
}

module.exports = { loadConfig, parseOrigins };
