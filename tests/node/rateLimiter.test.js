// Pure logic of Phase N: token bucket, login throttle, audit gate, config, tiers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../../backend/ratelimit/RateLimiter');
const { LoginThrottle } = require('../../backend/ratelimit/LoginThrottle');
const { AuditGate } = require('../../backend/ratelimit/AuditGate');
const { tierOf, buildPolicies, TIERS } = require('../../backend/ratelimit/policies');
const { loadConfig, parseOrigins } = require('../../backend/config');

const clock = (start = 1_000_000) => { const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } }; return c; };
const P = (n) => ({ capacity: n, refillPerMinute: n });

// ---- RateLimiter -----------------------------------------------------------
test('RL-01 a full bucket allows exactly `capacity` requests, then refuses', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 5; i++) assert.equal(rl.consume('k', P(5)).allowed, true, `request ${i + 1}`);
  const r = rl.consume('k', P(5));
  assert.equal(r.allowed, false);
  assert.equal(r.remaining, 0);
});

test('RL-02 refused result carries a sensible Retry-After (>=1s, matches the refill rate)', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 6; i++) rl.consume('k', P(6));      // 6/min => one token per 10s
  const r = rl.consume('k', P(6));
  assert.equal(r.allowed, false);
  assert.equal(r.retryAfterSec, 10);
});

test('RL-03 tokens refill with time and never exceed capacity', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 6; i++) rl.consume('k', P(6));
  c.advance(10_000);
  assert.equal(rl.consume('k', P(6)).allowed, true);
  assert.equal(rl.consume('k', P(6)).allowed, false);
  c.advance(60 * 60 * 1000);                               // an hour idle
  for (let i = 0; i < 6; i++) assert.equal(rl.consume('k', P(6)).allowed, true);
  assert.equal(rl.consume('k', P(6)).allowed, false, 'capacity, not more, after a long idle');
});

test('RL-04 keys are independent', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 3; i++) rl.consume('a', P(3));
  assert.equal(rl.consume('a', P(3)).allowed, false);
  assert.equal(rl.consume('b', P(3)).allowed, true);
});

test('RL-05 a clock that goes backwards never mints tokens', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 3; i++) rl.consume('k', P(3));
  c.advance(-120_000);
  assert.equal(rl.consume('k', P(3)).allowed, false);
});

test('RL-05b a backwards clock jump does not leave the caller penalised afterwards', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  for (let i = 0; i < 6; i++) rl.consume('k', P(6));          // drained; 1 token per 10s
  c.advance(-120_000);
  assert.equal(rl.consume('k', P(6)).allowed, false);
  c.advance(11_000);                                          // 11s later => one token has refilled
  assert.equal(rl.consume('k', P(6)).allowed, true);
});

test('RL-06 a lower policy applies immediately (demotion clamps stored tokens)', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now });
  rl.consume('k', P(100));                                  // 99 left
  for (let i = 0; i < 2; i++) rl.consume('k', P(2));        // clamped to 2 => only 2 more... then refuse
  assert.equal(rl.consume('k', P(2)).allowed, false);
});

test('RL-07 memory is bounded: never more than maxKeys buckets, even under a key flood', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now, maxKeys: 50 });
  for (let i = 0; i < 5000; i++) rl.consume(`ip:${i}`, P(5));
  assert.ok(rl.size <= 50, `size ${rl.size}`);
});

test('RL-08 eviction drops the LEAST recently used key, not a hot one', () => {
  const c = clock(); const rl = new RateLimiter({ now: c.now, maxKeys: 3 });
  for (let i = 0; i < 3; i++) rl.consume('hot', P(3));      // hot is drained
  rl.consume('x', P(3)); rl.consume('hot', P(3));           // touch hot again => most recent
  rl.consume('y', P(3)); rl.consume('z', P(3));             // forces eviction
  assert.equal(rl.consume('hot', P(3)).allowed, false, 'the drained hot bucket survived eviction');
});

test('RL-09 invalid policies are programming errors', () => {
  const rl = new RateLimiter();
  for (const bad of [{ capacity: 0, refillPerMinute: 1 }, { capacity: 1, refillPerMinute: 0 }, { capacity: NaN, refillPerMinute: 1 }, { capacity: 1, refillPerMinute: -5 }, {}]) {
    assert.throws(() => rl.consume('k', bad), RangeError);
  }
});

// ---- LoginThrottle ---------------------------------------------------------
test('LT-01 blocks an (ip, account) pair after N failures, with a retry time', () => {
  const c = clock(); const t = new LoginThrottle({ maxPerAccountIp: 3, windowMs: 60_000, now: c.now });
  for (let i = 0; i < 2; i++) { assert.equal(t.check('1.1.1.1', 'bob').blocked, false); t.recordFailure('1.1.1.1', 'bob'); }
  assert.equal(t.check('1.1.1.1', 'bob').blocked, false);
  t.recordFailure('1.1.1.1', 'bob');
  const g = t.check('1.1.1.1', 'bob');
  assert.equal(g.blocked, true);
  assert.equal(g.retryAfterSec, 60);
});

test('LT-02 a different account from the same IP is not blocked by the pair limit (until the IP limit)', () => {
  const t = new LoginThrottle({ maxPerAccountIp: 2, maxPerIp: 10 });
  t.recordFailure('1.1.1.1', 'bob'); t.recordFailure('1.1.1.1', 'bob');
  assert.equal(t.check('1.1.1.1', 'bob').blocked, true);
  assert.equal(t.check('1.1.1.1', 'alice').blocked, false);
});

test('LT-03 password spraying: the per-IP limit blocks many accounts from one IP', () => {
  const t = new LoginThrottle({ maxPerAccountIp: 5, maxPerIp: 4 });
  for (let i = 0; i < 4; i++) t.recordFailure('9.9.9.9', `user${i}`);
  assert.equal(t.check('9.9.9.9', 'brand-new-name').blocked, true);
  assert.equal(t.check('8.8.8.8', 'brand-new-name').blocked, false, 'other IPs unaffected');
});

test('LT-04 an attacker cannot lock a victim out from another IP (account is never keyed alone)', () => {
  const t = new LoginThrottle({ maxPerAccountIp: 2 });
  for (let i = 0; i < 50; i++) t.recordFailure('6.6.6.6', 'victim');
  assert.equal(t.check('7.7.7.7', 'victim').blocked, false);
});

test('LT-05 the window expires and the counters reset', () => {
  const c = clock(); const t = new LoginThrottle({ maxPerAccountIp: 1, windowMs: 1000, now: c.now });
  t.recordFailure('1.1.1.1', 'bob');
  assert.equal(t.check('1.1.1.1', 'bob').blocked, true);
  c.advance(1001);
  assert.equal(t.check('1.1.1.1', 'bob').blocked, false);
});

test('LT-05b after the window expires the throttle ARMS AGAIN (counters restart, not stay stale)', () => {
  const c = clock(); const t = new LoginThrottle({ maxPerAccountIp: 2, windowMs: 1000, now: c.now });
  t.recordFailure('1.1.1.1', 'bob'); t.recordFailure('1.1.1.1', 'bob');
  assert.equal(t.check('1.1.1.1', 'bob').blocked, true);
  c.advance(1500);
  assert.equal(t.check('1.1.1.1', 'bob').blocked, false);
  t.recordFailure('1.1.1.1', 'bob'); t.recordFailure('1.1.1.1', 'bob');
  assert.equal(t.check('1.1.1.1', 'bob').blocked, true, 'a fresh window must be able to block again');
});

test('LT-06 a success clears the pair counter; username case does not matter', () => {
  const t = new LoginThrottle({ maxPerAccountIp: 3 });
  t.recordFailure('1.1.1.1', 'Bob'); t.recordFailure('1.1.1.1', 'BOB');
  t.recordSuccess('1.1.1.1', 'bob');
  t.recordFailure('1.1.1.1', 'bob'); t.recordFailure('1.1.1.1', 'bob');
  assert.equal(t.check('1.1.1.1', 'bob').blocked, false);
});

test('LT-07 bounded memory, no usernames stored, odd input tolerated', () => {
  const t = new LoginThrottle({ maxKeys: 100 });
  for (let i = 0; i < 2000; i++) t.recordFailure(`ip${i}`, `name${i}`);
  assert.ok(t.counters.size <= 100);
  t.recordFailure('1.1.1.1', 'secret-pass-typed-as-username');
  for (const k of t.counters.keys()) assert.equal(k.includes('secret'), false);
  assert.doesNotThrow(() => { t.check('1.1.1.1', undefined); t.check('1.1.1.1', { a: 1 }); t.recordFailure('1.1.1.1', null); });
});

// ---- AuditGate -------------------------------------------------------------
test('AG-01 admits the first event, suppresses the rest in the interval, then reports the count', () => {
  const c = clock(); const g = new AuditGate({ intervalMs: 1000, now: c.now });
  assert.deepEqual(g.admit('k'), { suppressed: 0 });
  for (let i = 0; i < 5; i++) assert.equal(g.admit('k'), null);
  c.advance(1000);
  assert.deepEqual(g.admit('k'), { suppressed: 5 });
  assert.deepEqual(g.admit('other'), { suppressed: 0 });
});

test('AG-02 bounded memory', () => {
  const g = new AuditGate({ maxKeys: 20 });
  for (let i = 0; i < 1000; i++) g.admit(`k${i}`);
  assert.ok(g.seen.size <= 20);
});

// ---- policies / config -----------------------------------------------------
test('PO-01 tiers: anonymous < user < admin, for every class; unknown role gets USER, never more', () => {
  assert.equal(tierOf({ auth: null }), TIERS.ANONYMOUS);
  assert.equal(tierOf({ auth: { user: { role: 'USER' } } }), TIERS.USER);
  assert.equal(tierOf({ auth: { user: { role: 'ADMIN' } } }), TIERS.ADMIN);
  assert.equal(tierOf({ auth: { user: { role: 'SUPERUSER' } } }), TIERS.USER);
  const pol = buildPolicies(loadConfig({}).rateLimits);
  for (const cls of ['api', 'generate']) {
    assert.ok(pol[cls].anonymous.capacity < pol[cls].user.capacity, cls);
    assert.ok(pol[cls].user.capacity < pol[cls].admin.capacity, cls);
  }
  assert.ok(pol.generate.anonymous.capacity < pol.api.anonymous.capacity, 'AI endpoints are stricter');
});

test('CF-01 config: safe defaults, clamping, garbage falls back', () => {
  const d = loadConfig({});
  assert.deepEqual([d.corsOrigins.length, d.trustProxyHops, d.port, d.hsts], [0, 0, 3000, false]);
  const c = loadConfig({ RATE_API_ANON_PER_MIN: '-5', RATE_GEN_ANON_PER_MIN: 'abc', RATE_AUTH_PER_MIN: '0', TRUST_PROXY_HOPS: '999', PORT: '99999999' });
  assert.equal(c.rateLimits.apiAnonymousPerMin, 1, 'negative clamps to the minimum, never disables the limit');
  assert.equal(c.rateLimits.generateAnonymousPerMin, 5, 'garbage => default');
  assert.equal(c.rateLimits.authPerMin, 1);
  assert.equal(c.trustProxyHops, 10);
  assert.equal(c.port, 65535);
  assert.equal(loadConfig({ NODE_ENV: 'production' }).hsts, true);
});

test('CF-02 CORS origins are normalised and junk (non-http, malformed, wildcard) is dropped', () => {
  assert.deepEqual(parseOrigins('https://a.example/, http://b.example:8080/path , javascript:alert(1), *, nonsense, ftp://x'),
    ['https://a.example', 'http://b.example:8080']);
  assert.deepEqual(parseOrigins(''), []);
  assert.deepEqual(parseOrigins(undefined), []);
});
