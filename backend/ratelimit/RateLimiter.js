/**
 * RateLimiter -- an in-memory token bucket per key.
 * ---------------------------------------------------------------------
 * Each key (e.g. "generate:u:<userId>" or "api:ip:<address>") owns a bucket
 * that holds up to `capacity` tokens and refills at `refillPerMinute`.
 * A request costs one token; with none left it is refused, along with the
 * number of seconds until one is available. A token bucket allows a short
 * burst (the whole capacity) but caps the sustained rate, and unlike a
 * fixed window it has no "double burst across the boundary" flaw.
 *
 * Memory is bounded: at most `maxKeys` buckets. When full, buckets that
 * have refilled completely (indistinguishable from new) are swept first,
 * then the least-recently-used one is dropped. So an attacker rotating
 * source addresses can't grow memory without limit.
 *
 * Limits: state is per process and lost on restart; behind several
 * instances each would count separately (a shared store such as Redis
 * would be needed). Documented in docs/security.md.
 *
 * No Express here; the clock is injectable.
 */
class RateLimiter {
  constructor({ now = () => Date.now(), maxKeys = 10000 } = {}) {
    this.now = now;
    this.maxKeys = maxKeys;
    this.buckets = new Map();      // key -> { tokens, last, capacity, ratePerMs }; Map order = LRU order
  }

  /**
   * @param {string} key
   * @param {{capacity:number, refillPerMinute:number}} policy
   * @returns {{allowed:boolean, limit:number, remaining:number, retryAfterSec:number, resetSec:number}}
   */
  consume(key, policy, cost = 1) {
    const { capacity, refillPerMinute } = policy;
    if (!(capacity >= 1) || !(refillPerMinute > 0) || !Number.isFinite(capacity) || !Number.isFinite(refillPerMinute)) {
      throw new RangeError('Invalid rate-limit policy.');
    }
    const ratePerMs = refillPerMinute / 60000;
    const t = this.now();

    let b = this.buckets.get(key);
    if (b) {
      this.buckets.delete(key);                       // re-insert below => most recently used
      const elapsed = Math.max(0, t - b.last);        // a clock that went backwards never adds tokens
      // Clamp to the CURRENT policy, so a demotion/promotion applies immediately.
      b.tokens = Math.min(capacity, b.tokens + elapsed * ratePerMs);
    } else {
      this._makeRoom(t);
      b = { tokens: capacity };
    }
    b.last = t; b.capacity = capacity; b.ratePerMs = ratePerMs;
    this.buckets.set(key, b);

    let allowed = false;
    if (b.tokens >= cost) { b.tokens -= cost; allowed = true; }

    const retryAfterSec = allowed ? 0 : Math.max(1, Math.ceil((cost - b.tokens) / ratePerMs / 1000));
    const resetSec = Math.max(0, Math.ceil((capacity - b.tokens) / ratePerMs / 1000));
    return { allowed, limit: capacity, remaining: Math.max(0, Math.floor(b.tokens)), retryAfterSec, resetSec };
  }

  _makeRoom(t) {
    if (this.buckets.size < this.maxKeys) return;
    for (const [k, b] of this.buckets) {                // sweep fully-refilled (idle) buckets
      if (b.tokens + (t - b.last) * b.ratePerMs >= b.capacity) this.buckets.delete(k);
    }
    while (this.buckets.size >= this.maxKeys) {         // still full: drop least recently used
      this.buckets.delete(this.buckets.keys().next().value);
    }
  }

  get size() { return this.buckets.size; }
}

module.exports = { RateLimiter };
