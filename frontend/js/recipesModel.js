/**
 * recipesModel.js
 * ---------------------------------------------------------------------
 * Pure view-model helpers for the My Recipes page (no DOM, UMD like the
 * other *Model.js files so Node can unit-test it). Everything is derived
 * from fields the saved record really has; nothing is invented.
 */
(function (root) {
  const OFFLINE = 'Offline generator';

  const lower = (v) => String(v == null ? '' : v).toLowerCase();

  /** Where the recipe came from, from the record's own fields. */
  function modelLabel(recipe) {
    if (!recipe) return '';
    if (recipe.usedFallback === true) return OFFLINE;
    if (typeof recipe.aiProvider === 'string' && recipe.aiProvider.trim()) return recipe.aiProvider.trim();
    if (typeof recipe.source === 'string' && /AI/i.test(recipe.source)) return 'AI';
    return 'Recipe database';
  }

  /**
   * True only when a real model answered. Every model answer must pass the
   * server's output validation before it can become a recipe at all, so
   * this is a statement about the pipeline, not a score.
   */
  function isModelValidated(recipe) {
    return Boolean(recipe) && recipe.usedFallback !== true
      && typeof recipe.aiProvider === 'string' && recipe.aiProvider.trim() !== '';
  }

  /** Distinct, sorted, non-empty values of one field (for the filter menus). */
  function facet(recipes, field) {
    const seen = new Map();
    (recipes || []).forEach((r) => {
      const v = r && typeof r[field] === 'string' ? r[field].trim() : '';
      if (v && !seen.has(lower(v))) seen.set(lower(v), v);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }

  const time = (r) => { const t = Date.parse(r && r.savedAt); return Number.isNaN(t) ? 0 : t; };

  /**
   * filters: { query, cuisine, diet, difficulty, sort }  ('' / undefined = no filter)
   * sort: 'newest' (default) | 'oldest'. Never mutates the input.
   */
  function apply(recipes, filters) {
    const f = filters || {};
    const q = lower(f.query).trim();
    const out = (recipes || []).filter((r) => {
      if (!r || typeof r !== 'object') return false;
      if (f.cuisine && lower(r.cuisine) !== lower(f.cuisine)) return false;
      if (f.diet && lower(r.dietaryPreference) !== lower(f.diet)) return false;
      if (f.difficulty && lower(r.difficulty) !== lower(f.difficulty)) return false;
      if (q && !(lower(r.name).includes(q) || lower(r.cuisine).includes(q))) return false;
      return true;
    });
    // Array.prototype.sort is stable, so equal timestamps keep the server's order.
    out.sort((a, b) => (f.sort === 'oldest' ? time(a) - time(b) : time(b) - time(a)));
    return out;
  }

  const api = { modelLabel, isModelValidated, facet, apply, OFFLINE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecipesModel = api;
}(typeof self !== 'undefined' ? self : this));
