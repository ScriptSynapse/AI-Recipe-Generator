/**
 * wizardModel.js
 * ---------------------------------------------------------------------
 * Pure logic for the guided generator: what each step needs before the
 * user may continue, the strategy options, and the review checks. No DOM.
 *
 * The review step's "pre-check" is a CONVENIENCE run in the browser so a
 * bad request is caught before it is sent; the authoritative checks
 * (input validation, prompt-injection scan, XSS scan) always run on the
 * server, and the page says so rather than showing a pass it cannot know.
 */
(function (root) {
  const MAX_INGREDIENTS = 20;
  const MAX_INGREDIENT_LENGTH = 60;

  const STEPS = [
    { key: 'ingredients', label: 'Ingredients' },
    { key: 'preferences', label: 'Preferences' },
    { key: 'strategy', label: 'AI strategy' },
    { key: 'review', label: 'Security scan' },
  ];

  // 'standard' calls POST /api/recipes/generate. The others hand the same
  // request to the AI Lab, which runs the real multi-model comparison.
  const STRATEGIES = [
    { value: 'standard', label: 'Automatic (recommended)', detail: 'Best database match, otherwise an AI model. If a model is unavailable the next configured one is tried, then the offline generator.', lab: null },
    { value: 'compare', label: 'Compare all models', detail: 'Asks every configured model the same question and shows each result side by side in the AI Lab. Requires sign-in.', lab: 'all' },
    { value: 'fastest', label: 'Fastest model', detail: 'Compares the models and highlights the quickest valid answer in the AI Lab. Requires sign-in.', lab: 'fastest' },
    { value: 'best', label: 'Best quality', detail: 'Compares the models and highlights the highest-scoring valid answer in the AI Lab. Requires sign-in.', lab: 'best' },
  ];

  function strategy(value) {
    return STRATEGIES.find((s) => s.value === value) || STRATEGIES[0];
  }

  /** Why the user may not leave `stepKey` yet, or null if they may. */
  function blocker(stepKey, state) {
    if (stepKey === 'ingredients' && (!state || !Array.isArray(state.ingredients) || state.ingredients.length === 0)) {
      return 'Please add at least one ingredient.';
    }
    return null;
  }

  /** Browser-side checks shown on the review step. status: pass | fail. */
  function preChecks(state) {
    const items = state && Array.isArray(state.ingredients) ? state.ingredients : [];
    const longest = items.reduce((m, i) => Math.max(m, String(i).length), 0);
    return [
      { label: 'At least one ingredient', status: items.length > 0 ? 'pass' : 'fail', detail: `${items.length} added` },
      { label: `No more than ${MAX_INGREDIENTS} ingredients`, status: items.length <= MAX_INGREDIENTS ? 'pass' : 'fail', detail: '' },
      { label: `Each ingredient under ${MAX_INGREDIENT_LENGTH} characters`, status: longest <= MAX_INGREDIENT_LENGTH ? 'pass' : 'fail', detail: '' },
    ];
  }

  function canSubmit(state) {
    return preChecks(state).every((c) => c.status === 'pass');
  }

  const SERVER_CHECKS = [
    'Input validation',
    'Prompt-injection scan',
    'XSS scan',
  ];

  function summary(state) {
    const s = state || {};
    return [
      ['Ingredients', Array.isArray(s.ingredients) && s.ingredients.length ? s.ingredients.join(', ') : '—'],
      ['Cuisine', s.cuisine || '—'],
      ['Meal', s.mealType || '—'],
      ['Diet', s.dietaryPreference || '—'],
      ['Time', s.cookingTime ? `${s.cookingTime} min` : '—'],
      ['Difficulty', s.difficulty || '—'],
      ['Servings', s.servings || '—'],
    ];
  }

  /** What the AI Lab needs to pre-fill itself; null for the standard strategy. */
  function labHandoff(strategyValue, preferences) {
    const s = strategy(strategyValue);
    if (!s.lab) return null;
    return { mode: s.lab, preferences };
  }

  const WizardModel = { STEPS, STRATEGIES, SERVER_CHECKS, MAX_INGREDIENTS, MAX_INGREDIENT_LENGTH, strategy, blocker, preChecks, canSubmit, summary, labHandoff };
  if (typeof module !== 'undefined' && module.exports) module.exports = WizardModel; else root.WizardModel = WizardModel;
})(typeof window !== 'undefined' ? window : this);
