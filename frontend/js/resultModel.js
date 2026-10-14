/**
 * resultModel.js
 * ---------------------------------------------------------------------
 * Pure view-model for the recipe result page: what produced the recipe and
 * which pipeline stages it demonstrably went through. Built only from the
 * response fields (recipe.source / aiProvider / usedFallback, matchInfo) and
 * the measured round-trip time. A stage the response cannot prove is shown
 * as "not applicable" or omitted, never as a pass.
 */
(function (root) {
  const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

  /** 'database' | 'ai' | 'offline' | 'unknown' */
  function origin(recipe) {
    if (!recipe || typeof recipe !== 'object') return 'unknown';
    const source = str(recipe.source);
    if (!source.includes('AI')) return source ? 'database' : 'unknown';
    return recipe.usedFallback === false ? 'ai' : 'offline';
  }

  function formatDuration(ms) {
    if (!isNum(ms)) return 'not measured';
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  /** Rows for the details panel. */
  function details(recipe, elapsedMs) {
    const o = origin(recipe);
    const rows = [];
    rows.push(['Produced by', { database: 'Recipe database match', ai: 'AI model', offline: 'Offline template generator', unknown: 'Unknown' }[o]]);
    if (o === 'ai') rows.push(['AI provider', str(recipe.aiProvider) || '—']);
    if (o === 'offline') rows.push(['AI provider', 'none (no model produced this recipe)']);
    rows.push(['Generation time', formatDuration(elapsedMs)]);
    return rows;
  }

  /**
   * Pipeline stages for a FRESH generation (matchInfo present); [] otherwise.
   * status: pass | na
   */
  function pipeline(recipe, matchInfo) {
    if (!matchInfo || typeof matchInfo !== 'object') return [];
    const o = origin(recipe);
    const rows = [
      { label: 'Input validated', status: 'pass', detail: 'before any model was called' },
      { label: 'Prompt-injection and XSS scan', status: 'pass', detail: 'the request was not blocked' },
    ];
    if (o === 'database') {
      const required = isNum(matchInfo.ingredientCoverageRequired) ? Math.round(matchInfo.ingredientCoverageRequired * 100) : null;
      rows.push({ label: 'Database match', status: 'pass', detail: isNum(matchInfo.bestDatabaseScore) ? `score ${Math.round(matchInfo.bestDatabaseScore)}` : '' });
      rows.push({ label: 'Ingredient coverage', status: 'pass', detail: required === null ? 'required coverage met' : `at least ${required}% of the recipe's ingredients are yours` });
      rows.push({ label: 'AI output validation', status: 'na', detail: 'no model output involved' });
    } else if (o === 'ai') {
      rows.push({ label: 'AI generation', status: 'pass', detail: str(recipe.aiProvider) });
      rows.push({ label: 'AI output validation', status: 'pass', detail: 'structure, types and value ranges checked' });
    } else if (o === 'offline') {
      rows.push({ label: 'AI generation', status: 'na', detail: 'no model was available or its reply was rejected' });
      rows.push({ label: 'AI output validation', status: 'na', detail: 'no model output involved' });
    }
    return rows;
  }

  /**
   * The "AI SAFETY CHECK" list from the engine's ingredient-consistency report.
   * Each line is shown exactly as the engine computed it; unknown statuses are
   * never shown as a pass. Returns [] when there is no report (e.g. a saved recipe).
   */
  function safetyChecks(consistency) {
    const checks = consistency && Array.isArray(consistency.checks) ? consistency.checks : [];
    return checks
      .filter((c) => c && typeof c === 'object' && typeof c.label === 'string')
      .slice(0, 8)
      .map((c) => ({ label: str(c.label, 120), status: c.status === 'pass' ? 'pass' : 'warn', detail: str(c.detail, 120) }));
  }

  const ResultModel = { safetyChecks, origin, formatDuration, details, pipeline };
  if (typeof module !== 'undefined' && module.exports) module.exports = ResultModel; else root.ResultModel = ResultModel;
})(typeof window !== 'undefined' ? window : this);
