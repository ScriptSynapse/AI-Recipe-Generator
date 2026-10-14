/**
 * labModel.js
 * ---------------------------------------------------------------------
 * Pure functions that turn the API's comparison data into plain view
 * models for the AI Lab page. No DOM access (so it is unit-testable in
 * Node, same UMD pattern as sanitize.js and authHelpers.js); the page
 * script renders these with textContent only.
 *
 * Nothing is computed here that the server did not measure: scores,
 * latency and winners are passed through, and a missing number is shown as
 * "not measured", never as zero.
 */
(function (root) {
  const MAX_INGREDIENTS = 20;
  const MAX_INGREDIENT_LENGTH = 60;

  const STATUS_LABELS = {
    SUCCESS: 'Valid recipe',
    FAILED: 'Call failed',
    SKIPPED: 'Not configured',
    REJECTED: 'Rejected by output validation',
    BASELINE: 'Offline baseline',
  };

  const SCORE_LABELS = [
    ['overallScore', 'Overall'], ['ingredientScore', 'Ingredients'], ['dietScore', 'Diet'],
    ['instructionScore', 'Instructions'], ['nutritionScore', 'Nutrition'], ['safetyScore', 'Safety'],
  ];

  /** "paneer, Tomato ,, paneer" -> ["paneer", "Tomato"] (trimmed, de-duplicated, bounded). */
  function parseIngredients(text) {
    const seen = new Set();
    const out = [];
    for (const part of String(text || '').split(/[,\n]/)) {
      const item = part.trim().slice(0, MAX_INGREDIENT_LENGTH);
      const key = item.toLowerCase();
      if (!item || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= MAX_INGREDIENTS) break;
    }
    return out;
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  function formatLatency(ms, status) {
    if (status === 'SKIPPED') return 'not called';
    return isNum(ms) ? `${Math.round(ms)} ms` : 'not measured';
  }

  function describeIngredient(ing) {
    if (!ing || typeof ing !== 'object') return '';
    const qty = isNum(ing.quantity) && ing.quantity > 0 ? `${Math.round(ing.quantity * 100) / 100} ` : '';
    const unit = typeof ing.unit === 'string' && ing.unit ? `${ing.unit} ` : '';
    return `${qty}${unit}${typeof ing.name === 'string' ? ing.name : ''}`.trim();
  }

  /** One model's card. */
  function describeModel(model, comparison) {
    const status = Object.prototype.hasOwnProperty.call(STATUS_LABELS, model.status) ? model.status : 'FAILED';
    const badges = [];
    if (comparison && comparison.best === model.provider) badges.push('Best quality');
    if (comparison && comparison.fastest === model.provider) badges.push('Fastest');
    if (comparison && comparison.recommended === model.provider) badges.push('Recommended');

    const evaluation = model.evaluation && typeof model.evaluation === 'object' ? model.evaluation : null;
    const scores = evaluation
      ? SCORE_LABELS.filter(([key]) => isNum(evaluation[key])).map(([key, label]) => ({ label, value: Math.max(0, Math.min(100, evaluation[key])) }))
      : [];

    const recipe = model.recipe && typeof model.recipe === 'object' ? model.recipe : null;
    return {
      provider: String(model.provider || 'unknown'),
      model: String(model.model || ''),
      status,
      statusLabel: STATUS_LABELS[status],
      isBaseline: status === 'BASELINE',
      badges,
      latency: formatLatency(model.durationMs, status),
      scores,
      warnings: evaluation && Array.isArray(evaluation.warnings) ? evaluation.warnings.filter((w) => typeof w === 'string') : [],
      error: typeof model.error === 'string' ? model.error : '',
      recipe: recipe ? {
        name: typeof recipe.name === 'string' ? recipe.name : 'Untitled recipe',
        ingredients: (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).map(describeIngredient).filter(Boolean),
        instructions: (Array.isArray(recipe.instructions) ? recipe.instructions : []).filter((s) => typeof s === 'string'),
      } : null,
    };
  }

  /** A one-line honest summary of what the comparison found. */
  function summarize(comparison) {
    const models = Array.isArray(comparison && comparison.models) ? comparison.models : [];
    const real = models.filter((m) => m.status !== 'BASELINE');
    const valid = real.filter((m) => m.status === 'SUCCESS');
    const configured = real.filter((m) => m.status !== 'SKIPPED');
    let headline;
    if (real.length === 0) headline = 'No models were asked.';
    else if (configured.length === 0) headline = 'No AI models are configured, so only the offline baseline ran. Add an API key to compare real models.';
    else if (valid.length === 0) headline = 'No model returned a valid recipe this time.';
    else headline = `${valid.length} of ${configured.length} model${configured.length === 1 ? '' : 's'} returned a valid recipe.`;
    return { headline, hasWinner: Boolean(comparison && (comparison.best || comparison.fastest)) };
  }

  /** Lifetime table rows from /api/admin/model-analytics. */
  function analyticsRows(summary) {
    const models = Array.isArray(summary && summary.models) ? summary.models : [];
    const dash = (v, suffix = '') => (isNum(v) ? `${v}${suffix}` : '—');
    return models.map((m) => ({
      provider: String(m.provider), model: String(m.model || ''),
      attempts: dash(m.attempts), successRate: dash(m.successRate, '%'),
      avgLatency: dash(m.avgLatencyMs, ' ms'), avgScore: dash(m.avgScore),
      wins: `${isNum(m.bestWins) ? m.bestWins : 0} best / ${isNum(m.fastestWins) ? m.fastestWins : 0} fastest`,
    }));
  }

  /** Rows for the benchmark-history table (from /api/admin/benchmark-history). Missing numbers are "—". */
  function historyRows(history) {
    const runs = Array.isArray(history && history.runs) ? history.runs : [];
    const dash = (v, suffix = '') => (isNum(v) ? `${v}${suffix}` : '—');
    return runs.map((r) => {
      const models = Array.isArray(r.models) ? r.models : [];
      const called = models.filter((m) => m.status !== 'SKIPPED' && m.status !== 'BASELINE');
      return {
        id: String(r.id), at: String(r.at || ''), source: r.source === 'benchmark' ? 'Benchmark' : 'Lab comparison',
        summary: models.length === 0 ? 'Per-model data no longer stored'
          : `${called.filter((m) => m.status === 'SUCCESS').length} of ${called.length} models valid`,
        best: r.best ? String(r.best) : '—', fastest: r.fastest ? String(r.fastest) : '—',
        models: models.map((m) => ({
          provider: String(m.provider), status: m.status, latency: dash(m.durationMs, ' ms'), score: dash(m.score),
        })),
      };
    });
  }

  /**
   * Side-by-side difference between two runs, per provider that was really
   * called (valid reply) in BOTH. delta = b - a; null when either side has
   * no measurement, so nothing is guessed.
   */
  function compareRuns(a, b) {
    const valid = (run) => new Map((run && Array.isArray(run.models) ? run.models : [])
      .filter((m) => m.status === 'SUCCESS').map((m) => [m.provider, m]));
    const ma = valid(a); const mb = valid(b);
    const diff = (x, y) => (isNum(x) && isNum(y) ? Math.round((y - x) * 10) / 10 : null);
    const rows = [...ma.keys()].filter((p) => mb.has(p)).sort().map((provider) => ({
      provider,
      latencyA: ma.get(provider).durationMs, latencyB: mb.get(provider).durationMs,
      latencyDelta: diff(ma.get(provider).durationMs, mb.get(provider).durationMs),
      scoreA: ma.get(provider).score, scoreB: mb.get(provider).score,
      scoreDelta: diff(ma.get(provider).score, mb.get(provider).score),
    }));
    return { rows, onlyInA: [...ma.keys()].filter((p) => !mb.has(p)).sort(), onlyInB: [...mb.keys()].filter((p) => !ma.has(p)).sort() };
  }

  const LAB_CUISINES = ['Indian', 'Italian', 'Chinese', 'Mexican', 'American', 'Mediterranean', 'Japanese', 'Thai', 'Other'];
  const LAB_DIETS = ['No Preference', 'Vegetarian', 'Vegan', 'Gluten Free', 'Dairy Free', 'High Protein', 'Low Carb'];
  const LAB_TIMES = [15, 30, 45, 60];
  const LAB_MODES = ['all', 'fastest', 'best'];

  /**
   * Turns the generator's hand-off (raw sessionStorage text) into values safe
   * to put in the Lab form. Anything unrecognised is dropped, never trusted:
   * returns null when there is nothing usable.
   */
  function prefillFrom(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return null; }
    if (!data || typeof data !== 'object' || !data.preferences || typeof data.preferences !== 'object') return null;
    const p = data.preferences;
    const ingredients = Array.isArray(p.ingredients) ? parseIngredients(p.ingredients.filter((i) => typeof i === 'string').join(',')) : [];
    if (ingredients.length === 0) return null;
    const time = LAB_TIMES.includes(p.cookingTime) ? p.cookingTime : (typeof p.cookingTime === 'number' && p.cookingTime > 60 ? 60 : 30);
    return {
      ingredients: ingredients.join(', '),
      cuisine: LAB_CUISINES.includes(p.cuisine) ? p.cuisine : 'Indian',
      diet: LAB_DIETS.includes(p.dietaryPreference) ? p.dietaryPreference : 'No Preference',
      time,
      mode: LAB_MODES.includes(data.mode) ? data.mode : 'all',
    };
  }

  const LabModel = { prefillFrom, parseIngredients, describeModel, summarize, analyticsRows, historyRows, compareRuns, STATUS_LABELS, MAX_INGREDIENTS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LabModel;      // Node (tests)
  } else {
    root.LabModel = LabModel;       // browser global
  }
})(typeof window !== 'undefined' ? window : this);
