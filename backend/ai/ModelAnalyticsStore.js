/**
 * ModelAnalyticsStore -- what the AI Model Lab has actually measured.
 * ---------------------------------------------------------------------
 * Every comparison/benchmark the engine performs is condensed to one row
 * per model (status, measured latency, evaluator score) and appended here.
 * The summary is computed ONLY from those rows -- nothing is estimated or
 * seeded, so with no runs recorded the summary is simply empty.
 *
 * Bounded (MAX_ROWS / MAX_COMPARISONS, oldest dropped) so a busy lab can't
 * grow the file without limit. The offline baseline is recorded for
 * reference but excluded from the per-model summary (it is not a model).
 * Stored values are whitelisted and type-checked, because they come from
 * the engine's JSON: whatever it returns, only these fields are kept.
 */
const crypto = require('crypto');
const { JsonFileStore } = require('../storage/JsonFileStore');

const MAX_ROWS = 2000;
const MAX_COMPARISONS = 500;
const STATUSES = new Set(['SUCCESS', 'FAILED', 'SKIPPED', 'REJECTED', 'BASELINE']);

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);

class ModelAnalyticsStore {
  constructor({ filePath, now = () => Date.now(), idFactory = () => crypto.randomUUID() }) {
    this.store = new JsonFileStore(filePath, () => ({ rows: [], comparisons: [] }));
    this.now = now;
    this.idFactory = idFactory;
  }

  /** Records one comparison report (the engine's `comparison` object). Returns the comparison id, or null if unusable. */
  record(comparison, { source = 'lab' } = {}) {
    if (!comparison || typeof comparison !== 'object' || !Array.isArray(comparison.models)) return null;
    const id = this.idFactory();
    const at = new Date(this.now()).toISOString();
    const rows = [];
    for (const m of comparison.models.slice(0, 50)) {
      if (!m || typeof m !== 'object' || !STATUSES.has(m.status)) continue;
      const provider = text(m.provider, 40);
      if (!provider) continue;
      rows.push({
        comparisonId: id, at, provider, model: text(m.model, 80), status: m.status,
        durationMs: num(m.durationMs, 0, 3_600_000),
        score: m.evaluation ? num(m.evaluation.overallScore, 0, 100) : null,
      });
    }
    if (rows.length === 0) return null;
    this.store.update((data) => {
      data.rows.push(...rows);
      if (data.rows.length > MAX_ROWS) data.rows.splice(0, data.rows.length - MAX_ROWS);
      data.comparisons.push({
        id, at, source: text(source, 20), mode: text(comparison.mode, 20),
        best: text(comparison.best, 40) || null, fastest: text(comparison.fastest, 40) || null,
      });
      if (data.comparisons.length > MAX_COMPARISONS) data.comparisons.splice(0, data.comparisons.length - MAX_COMPARISONS);
    });
    return id;
  }

  /**
   * Past comparison/benchmark runs, newest first, each with its per-model rows.
   * filters: { provider, source, sinceMs, untilMs, limit } -- all optional.
   * `models` is empty for a run whose rows have aged out of the (smaller) row
   * log; that is reported as it is, never reconstructed.
   */
  history({ provider, source, sinceMs, untilMs, limit = 50 } = {}) {
    const { rows, comparisons } = this.store.read();
    const byRun = new Map();
    for (const r of rows) {
      if (!byRun.has(r.comparisonId)) byRun.set(r.comparisonId, []);
      byRun.get(r.comparisonId).push({
        provider: r.provider, model: r.model, status: r.status, durationMs: r.durationMs, score: r.score,
      });
    }
    const wanted = typeof provider === 'string' ? provider.toLowerCase() : null;
    const out = [];
    for (let i = comparisons.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const c = comparisons[i];
      const at = Date.parse(c.at);
      if (source && c.source !== source) continue;
      if (typeof sinceMs === 'number' && at < sinceMs) continue;
      if (typeof untilMs === 'number' && at > untilMs) continue;
      const models = byRun.get(c.id) || [];
      if (wanted && !models.some((m) => m.provider.toLowerCase() === wanted)) continue;
      out.push({ id: c.id, at: c.at, source: c.source, mode: c.mode, best: c.best, fastest: c.fastest, models });
    }
    return out;
  }

  summary() {
    const { rows, comparisons } = this.store.read();
    const byProvider = new Map();
    for (const r of rows) {
      if (r.status === 'BASELINE') continue;
      let p = byProvider.get(r.provider);
      if (!p) {
        p = { provider: r.provider, model: r.model, attempts: 0, successes: 0, failures: 0, rejected: 0, skipped: 0, latency: [], scores: [], bestWins: 0, fastestWins: 0 };
        byProvider.set(r.provider, p);
      }
      p.model = r.model || p.model;
      if (r.status === 'SKIPPED') { p.skipped += 1; continue; }     // never called: not an attempt
      p.attempts += 1;
      if (r.status === 'SUCCESS') {
        p.successes += 1;
        if (r.durationMs !== null) p.latency.push(r.durationMs);
        if (r.score !== null) p.scores.push(r.score);
      } else if (r.status === 'REJECTED') p.rejected += 1;
      else p.failures += 1;
    }
    for (const c of comparisons) {
      if (c.best && byProvider.has(c.best)) byProvider.get(c.best).bestWins += 1;
      if (c.fastest && byProvider.has(c.fastest)) byProvider.get(c.fastest).fastestWins += 1;
    }
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const models = [...byProvider.values()].map((p) => ({
      provider: p.provider, model: p.model, attempts: p.attempts, successes: p.successes, failures: p.failures,
      rejected: p.rejected, skipped: p.skipped,
      successRate: p.attempts ? Math.round((p.successes / p.attempts) * 100) : null,
      avgLatencyMs: avg(p.latency), avgScore: avg(p.scores), bestWins: p.bestWins, fastestWins: p.fastestWins,
    })).sort((a, b) => a.provider.localeCompare(b.provider));
    return { comparisons: comparisons.length, models };
  }
}

module.exports = { ModelAnalyticsStore, MAX_ROWS, MAX_COMPARISONS };
