/**
 * LoginThrottle -- slows password guessing.
 * ---------------------------------------------------------------------
 * Counts FAILED logins in a rolling window, under two keys:
 *   (ip, username)  max `maxPerAccountIp`  -- stops one source hammering one account
 *   ip              max `maxPerIp`         -- stops one source spraying many accounts
 * Once a key reaches its limit, further attempts from it are refused with
 * a retry time BEFORE any password is checked (so it costs no scrypt work
 * either). A success clears that (ip, username) counter.
 *
 * Deliberately NOT keyed on the account alone: that would let anyone lock
 * a victim out of their own account by failing against it on purpose. The
 * price is that a distributed attack (many IPs) is only slowed by the
 * general per-IP limits; documented in docs/security.md.
 *
 * Usernames are hashed into the key, never stored, and the stored key set
 * is bounded.
 */
const crypto = require('crypto');

class LoginThrottle {
  constructor({ maxPerAccountIp = 5, maxPerIp = 20, windowMs = 15 * 60 * 1000, maxKeys = 20000, now = () => Date.now() } = {}) {
    Object.assign(this, { maxPerAccountIp, maxPerIp, windowMs, maxKeys, now });
    this.counters = new Map();    // key -> { count, windowStart }
  }

  _accountKey(ip, username) {
    const name = typeof username === 'string' ? username.slice(0, 64).toLowerCase() : '';
    return `a:${crypto.createHash('sha256').update(`${ip}|${name}`).digest('hex').slice(0, 24)}`;
  }

  _ipKey(ip) { return `i:${ip}`; }

  _live(key) {
    const c = this.counters.get(key);
    if (!c) return null;
    if (this.now() - c.windowStart >= this.windowMs) { this.counters.delete(key); return null; }
    return c;
  }

  /** @returns {{blocked:boolean, retryAfterSec:number}} */
  check(ip, username) {
    let retryMs = 0;
    for (const [key, max] of [[this._accountKey(ip, username), this.maxPerAccountIp], [this._ipKey(ip), this.maxPerIp]]) {
      const c = this._live(key);
      if (c && c.count >= max) retryMs = Math.max(retryMs, c.windowStart + this.windowMs - this.now());
    }
    return retryMs > 0 ? { blocked: true, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) } : { blocked: false, retryAfterSec: 0 };
  }

  recordFailure(ip, username) {
    for (const key of [this._accountKey(ip, username), this._ipKey(ip)]) {
      const c = this._live(key);
      if (c) { c.count += 1; continue; }
      if (this.counters.size >= this.maxKeys) this.counters.delete(this.counters.keys().next().value);
      this.counters.set(key, { count: 1, windowStart: this.now() });
    }
  }

  recordSuccess(ip, username) { this.counters.delete(this._accountKey(ip, username)); }
}

module.exports = { LoginThrottle };
