/**
 * generator.js
 * ---------------------------------------------------------------------
 * The guided generator: Ingredients -> Preferences -> AI strategy ->
 * Security scan (review) -> generation. The "standard" strategy calls
 * POST /api/recipes/generate and routes to results.html; the model
 * comparison strategies hand the same request to the AI Lab.
 *
 * All user text is added with textContent / DOM nodes, never as markup.
 * What may be generated is decided by the server; the browser-side checks
 * here only save a round trip.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const state = {
    ingredients: [],
    cuisine: 'Indian',
    mealType: 'Dinner',
    dietaryPreference: 'No Preference',
    cookingTime: 30,
    difficulty: 'Medium',
    servings: 2,
    strategy: 'standard',
  };
  let stepIndex = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const steps = Array.from(document.querySelectorAll('.wizard-step'));

  function showError(message) {
    const banner = $('error-banner');
    banner.textContent = message || '';
    if (message) banner.classList.add('visible'); else banner.classList.remove('visible');
  }

  // ---- ingredients ---------------------------------------------------------
  function renderIngredientChips() {
    const holder = $('ingredient-chips');
    holder.textContent = '';
    state.ingredients.forEach((ingredient, index) => {
      const chip = el('span', 'chip chip-ingredient');
      chip.appendChild(document.createTextNode(`${ingredient} `));
      const remove = el('button', null, '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${ingredient}`);
      remove.addEventListener('click', () => { state.ingredients.splice(index, 1); renderIngredientChips(); });
      chip.appendChild(remove);
      holder.appendChild(chip);
    });
  }

  function addIngredientFromInput() {
    const raw = $('ingredient-input').value.trim();
    if (!raw) return;
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
      const clipped = name.slice(0, WizardModel.MAX_INGREDIENT_LENGTH + 1);   // an over-long name stays visible so the review step can flag it
      if (!state.ingredients.some((i) => i.toLowerCase() === clipped.toLowerCase())) state.ingredients.push(clipped);
    });
    $('ingredient-input').value = '';
    $('ingredient-empty-hint').classList.remove('visible');
    renderIngredientChips();
  }

  $('add-ingredient-btn').addEventListener('click', addIngredientFromInput);
  $('ingredient-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addIngredientFromInput(); }
  });

  // ---- preferences -----------------------------------------------------------
  function wireOptionGroup(groupId, key, parse) {
    const group = $(groupId);
    const pills = Array.from(group.querySelectorAll('.option-pill'));
    pills.forEach((pill) => {
      pill.setAttribute('role', 'button');
      pill.setAttribute('tabindex', '0');
      const choose = () => {
        pills.forEach((p) => { p.classList.remove('selected'); p.setAttribute('aria-pressed', 'false'); });
        pill.classList.add('selected');
        pill.setAttribute('aria-pressed', 'true');
        state[key] = parse(pill.getAttribute('data-value'));
      };
      pill.addEventListener('click', choose);
      pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    });
  }
  wireOptionGroup('meal-type-group', 'mealType', (v) => v);
  wireOptionGroup('cooking-time-group', 'cookingTime', (v) => parseInt(v, 10));
  wireOptionGroup('difficulty-group', 'difficulty', (v) => v);

  $('cuisine-select').addEventListener('change', () => { state.cuisine = $('cuisine-select').value; });
  $('diet-select').addEventListener('change', () => { state.dietaryPreference = $('diet-select').value; });

  $('servings-minus').addEventListener('click', () => { state.servings = Math.max(1, state.servings - 1); $('servings-value').textContent = state.servings; });
  $('servings-plus').addEventListener('click', () => { state.servings = Math.min(12, state.servings + 1); $('servings-value').textContent = state.servings; });

  const prefilled = new URLSearchParams(window.location.search).get('cuisine');
  if (prefilled) { $('cuisine-select').value = prefilled; state.cuisine = $('cuisine-select').value || state.cuisine; }

  // ---- strategy ---------------------------------------------------------------
  function renderStrategies() {
    const list = $('strategy-list');
    list.textContent = '';
    WizardModel.STRATEGIES.forEach((s) => {
      const li = el('li');
      const label = el('label', 'strategy-option');
      const input = el('input');
      input.type = 'radio';
      input.name = 'strategy';
      input.value = s.value;
      if (s.value === state.strategy) input.checked = true;
      input.addEventListener('change', () => { state.strategy = s.value; });
      const text = el('div');
      text.appendChild(el('strong', null, s.label));
      text.appendChild(el('span', null, s.detail));
      label.appendChild(input);
      label.appendChild(text);
      li.appendChild(label);
      list.appendChild(li);
    });
  }
  renderStrategies();

  // ---- review -------------------------------------------------------------------
  function renderReview() {
    const summary = $('review-summary');
    summary.textContent = '';
    WizardModel.summary(state).concat([['Strategy', WizardModel.strategy(state.strategy).label]]).forEach(([k, v]) => {
      const li = el('li');
      li.appendChild(el('span', null, k));
      li.appendChild(el('strong', null, String(v)));
      summary.appendChild(li);
    });

    const pre = $('review-prechecks');
    pre.textContent = '';
    WizardModel.preChecks(state).forEach((c) => {
      const li = el('li', c.status === 'pass' ? 'check-pass' : 'check-warn');
      li.appendChild(el('span', 'check-mark', c.status === 'pass' ? '✓' : '!'));
      li.appendChild(el('span', null, c.label));
      if (c.detail) li.appendChild(el('span', 'check-detail', c.detail));
      pre.appendChild(li);
    });

    const server = $('review-server');
    server.textContent = '';
    WizardModel.SERVER_CHECKS.forEach((label) => {
      const li = el('li', 'check-na');
      li.appendChild(el('span', 'check-mark', '•'));
      li.appendChild(el('span', null, label));
      li.appendChild(el('span', 'check-detail', 'runs when you generate'));
      server.appendChild(li);
    });
  }

  // ---- stepper / navigation --------------------------------------------------------
  function renderStepper() {
    const stepper = $('stepper');
    stepper.textContent = '';
    WizardModel.STEPS.forEach((s, i) => {
      const li = el('li', i === stepIndex ? 'current' : (i < stepIndex ? 'done' : ''), s.label);
      if (i === stepIndex) li.setAttribute('aria-current', 'step');
      stepper.appendChild(li);
    });
  }

  function showStep(index) {
    stepIndex = Math.max(0, Math.min(WizardModel.STEPS.length - 1, index));
    steps.forEach((section, i) => {
      if (i === stepIndex) section.classList.add('active'); else section.classList.remove('active');
    });
    const last = stepIndex === WizardModel.STEPS.length - 1;
    if (stepIndex === 0) $('wizard-back').classList.add('hidden'); else $('wizard-back').classList.remove('hidden');
    if (last) { $('wizard-next').classList.add('hidden'); $('generate-btn').classList.remove('hidden'); renderReview(); }
    else { $('wizard-next').classList.remove('hidden'); $('generate-btn').classList.add('hidden'); }
    renderStepper();
    const heading = steps[stepIndex] && steps[stepIndex].querySelector && steps[stepIndex].querySelector('h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); if (heading.focus) heading.focus({ preventScroll: true }); }
  }

  $('wizard-next').addEventListener('click', () => {
    showError('');
    const problem = WizardModel.blocker(WizardModel.STEPS[stepIndex].key, state);
    if (problem) {
      $('ingredient-empty-hint').classList.add('visible');
      showError(problem);
      return;
    }
    showStep(stepIndex + 1);
  });
  $('wizard-back').addEventListener('click', () => { showError(''); showStep(stepIndex - 1); });

  // ---- submit -----------------------------------------------------------------------
  function preferencesPayload() {
    return {
      ingredients: state.ingredients.slice(),
      cuisine: state.cuisine,
      mealType: state.mealType,
      dietaryPreference: state.dietaryPreference,
      cookingTime: state.cookingTime,
      difficulty: state.difficulty,
      servings: state.servings,
    };
  }

  $('generator-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!WizardModel.canSubmit(state)) { showError('Please fix the highlighted checks before generating.'); showStep(WizardModel.STEPS.length - 1); return; }
    const preferences = preferencesPayload();

    const handoff = WizardModel.labHandoff(state.strategy, preferences);
    if (handoff) {
      sessionStorage.setItem('labPrefill', JSON.stringify(handoff));
      window.location.href = 'ai-lab.html';
      return;
    }

    $('generator-form').classList.add('hidden');
    $('loading-state').classList.add('visible');
    $('generate-btn').disabled = true;
    const started = Date.now();
    const result = await RecipeAPI.generate(preferences);

    if (!result.success) {
      $('generator-form').classList.remove('hidden');
      $('loading-state').classList.remove('visible');
      $('generate-btn').disabled = false;
      showError((result.error && result.error.message) || 'Something went wrong. Please try again.');
      return;
    }

    // Stash the result, the request (for Regenerate) and the measured
    // round-trip time, then hand off to the results page.
    sessionStorage.setItem('lastRecipeResult', JSON.stringify(result.data));
    sessionStorage.setItem('lastPreferences', JSON.stringify(preferences));
    sessionStorage.setItem('lastGenerationMs', String(Date.now() - started));
    window.location.href = 'results.html';
  });

  renderIngredientChips();
  showStep(0);
})();
