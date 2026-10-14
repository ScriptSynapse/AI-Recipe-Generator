/**
 * UsageStore -- how much each signed-in user has actually used the app.
 * ---------------------------------------------------------------------
 * Per user, per UTC day: `generated` (recipes successfully returned by
 * generate/regenerate) and `aiRequests` (requests that really reached an
 * AI model: an AI-sourced recipe, or each model a Lab comparison called).
 * Counters only ever go up from a successful response, so the dashboard
 * shows measured activity, never estimates. Anonymous callers are not
 * counted (there is nobody to show it to).
 *
 * Bounded: at most MAX_DAYS days kept per user (oldest dropped).
 */
const { JsonFileStore } = require('../storage/JsonFileStore');

const MAX_DAYS = 90;
const KINDS = Object.freeze(['generated', 'aiRequests']);
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

class UsageStore {
  constructor({ filePath, now = () => Date.now() }) {
    this.store = new JsonFileStore(filePath, () => ({ users: {} }));
    this.now = now;
  }

  /** Adds `amount` (a small non-negative integer) to a counter. Ignores bad input. */
  record(userId, kind, amount = 1) {
    if (typeof userId !== 'string' || userId === '' || userId.length > 64) return false;
    if (!KINDS.includes(kind)) return false;
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) return false;

    const data = this.store.read();
    const users = data.users && typeof data.users === 'object' ? data.users : {};
    const mine = Object.prototype.hasOwnProperty.call(users, userId) ? users[userId] : {};
    const day = dayKey(this.now());
    const entry = mine[day] || { generated: 0, aiRequests: 0 };
    entry[kind] += amount;
    mine[day] = entry;

    const days = Object.keys(mine).sort();
    for (const old of days.slice(0, Math.max(0, days.length - MAX_DAYS))) delete mine[old];
    users[userId] = mine;
    this.store.write({ users });
    return true;
  }

  /** Totals plus one entry per UTC day for the last `days` days (zeros included), oldest first. */
  summary(userId, days = 14) {
    const span = Math.min(MAX_DAYS, Math.max(1, Math.floor(days)));
    const data = this.store.read();
    const users = data.users && typeof data.users === 'object' ? data.users : {};
    const mine = Object.prototype.hasOwnProperty.call(users, userId) ? users[userId] : {};
    const totals = { generated: 0, aiRequests: 0 };
    for (const entry of Object.values(mine)) {
      totals.generated += entry.generated || 0;
      totals.aiRequests += entry.aiRequests || 0;
    }
    const series = [];
    const end = this.now();
    for (let i = span - 1; i >= 0; i -= 1) {
      const date = dayKey(end - i * 24 * 60 * 60 * 1000);
      const entry = mine[date] || {};
      series.push({ date, generated: entry.generated || 0, aiRequests: entry.aiRequests || 0 });
    }
    return { totals, series };
  }
}

/**
 * Express middleware: after a SUCCESSFUL JSON response, counts what the
 * response shows really happened. `extract(body)` returns { generated, aiRequests }.
 * Never affects the response: a failure to record is swallowed.
 */
function recordUsage(store, extract) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const user = req.auth && req.auth.user;
        if (user && res.statusCode >= 200 && res.statusCode < 300 && body && body.success === true) {
          const counts = extract(body) || {};
          if (counts.generated) store.record(user.id, 'generated', counts.generated);
          if (counts.aiRequests) store.record(user.id, 'aiRequests', counts.aiRequests);
        }
      } catch { /* usage counting must never break a response */ }
      return originalJson(body);
    };
    next();
  };
}

const fromRecipeResponse = (body) => {
  const recipe = body && body.data && body.data.recipe;
  if (!recipe) return null;
  const usedModel = typeof recipe.source === 'string' && recipe.source.includes('AI') && recipe.usedFallback === false;
  return { generated: 1, aiRequests: usedModel ? 1 : 0 };
};

const fromComparisonResponse = (body) => {
  const models = body && body.data && body.data.comparison && body.data.comparison.models;
  if (!Array.isArray(models)) return null;
  const called = models.filter((m) => m && (m.status === 'SUCCESS' || m.status === 'FAILED' || m.status === 'REJECTED')).length;
  return { aiRequests: Math.min(called, 100) };
};

module.exports = { UsageStore, recordUsage, fromRecipeResponse, fromComparisonResponse, MAX_DAYS };
