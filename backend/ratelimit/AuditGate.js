/**
 * AuditGate -- "tell me at most once per interval per key".
 * Used so a client that is being refused thousands of times produces a
 * handful of audit records (each carrying how many were suppressed), not
 * thousands. Bounded memory; injectable clock.
 */
class AuditGate {
  constructor({ intervalMs = 30000, maxKeys = 5000, now = () => Date.now() } = {}) {
    Object.assign(this, { intervalMs, maxKeys, now });
    this.seen = new Map();   // key -> { at, suppressed }
  }

  /** @returns {null | {suppressed:number}} null => stay quiet; otherwise emit now. */
  admit(key) {
    const t = this.now();
    const entry = this.seen.get(key);
    if (entry && t - entry.at < this.intervalMs) { entry.suppressed += 1; return null; }
    if (this.seen.size >= this.maxKeys) {
      for (const [k, v] of this.seen) if (t - v.at >= this.intervalMs) this.seen.delete(k);
      if (this.seen.size >= this.maxKeys) this.seen.delete(this.seen.keys().next().value);
    }
    const suppressed = entry ? entry.suppressed : 0;
    this.seen.set(key, { at: t, suppressed: 0 });
    return { suppressed };
  }
}

module.exports = { AuditGate };
