/**
 * results.js
 * ---------------------------------------------------------------------
 * Renders the recipe stashed in sessionStorage (by generator.js, or by
 * a previous action on this same page) and wires up every result-page
 * action: Save, Regenerate, Make Healthier, Substitute Ingredient,
 * Change Servings.
 */

(function () {
  let currentRecipe = null;
  let currentPreferences = null;
  let currentMatchInfo = null;      // present only for a fresh generation; drives the pipeline panel
  let currentConsistency = null;     // the engine's ingredient-consistency report (fresh generations only)
  let currentElapsedMs = null;

  const els = {
    loading: document.getElementById('loading-state'),
    loadingMessage: document.getElementById('loading-message'),
    empty: document.getElementById('empty-state'),
    layout: document.getElementById('result-layout'),
    toast: document.getElementById('toast'),
  };

  function showToast(message, isError) {
    els.toast.textContent = message;
    els.toast.classList.add('visible');
    if (!isError) {
      els.toast.style.background = '#EEF3EA';
      els.toast.style.borderColor = 'var(--color-basil-light)';
      els.toast.style.color = 'var(--color-basil)';
    } else {
      els.toast.style.background = '';
      els.toast.style.borderColor = '';
      els.toast.style.color = '';
    }
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => els.toast.classList.remove('visible'), 4000);
  }

  function setLoading(isLoading, message) {
    if (isLoading) {
      els.loadingMessage.textContent = message || 'Loading your recipe...';
      els.loading.classList.add('visible');
      els.layout.classList.add('hidden');
    } else {
      els.loading.classList.remove('visible');
      els.layout.classList.remove('hidden');
    }
  }

  function formatQuantity(qty) {
    const n = Number(qty);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  }

  // --- Rendering ----------------------------------------------------------
  function renderProvenance(recipe) {
    const meta = document.getElementById('meta-list');
    meta.textContent = '';
    ResultModel.details(recipe, currentElapsedMs).forEach(([k, v]) => {
      const li = document.createElement('li');
      const key = document.createElement('span'); key.textContent = k;
      const val = document.createElement('strong'); val.textContent = v;
      li.appendChild(key); li.appendChild(val);
      meta.appendChild(li);
    });

    const panel = document.getElementById('pipeline-panel');
    const list = document.getElementById('pipeline-list');
    list.textContent = '';
    const rows = ResultModel.pipeline(recipe, currentMatchInfo);
    rows.forEach((r) => {
      const li = document.createElement('li');
      li.className = r.status === 'pass' ? 'check-pass' : 'check-na';
      const mark = document.createElement('span'); mark.className = 'check-mark'; mark.textContent = r.status === 'pass' ? '\u2713' : '\u2013';
      const label = document.createElement('span'); label.textContent = r.label;
      li.appendChild(mark); li.appendChild(label);
      if (r.detail) { const d = document.createElement('span'); d.className = 'check-detail'; d.textContent = r.detail; li.appendChild(d); }
      list.appendChild(li);
    });
    if (rows.length) panel.classList.remove('hidden'); else panel.classList.add('hidden');

    const safety = document.getElementById('safety-list');
    safety.textContent = '';
    const checks = ResultModel.safetyChecks(currentConsistency);
    checks.forEach((c) => {
      const li = document.createElement('li');
      li.className = c.status === 'pass' ? 'check-pass' : 'check-warn';
      const mark = document.createElement('span'); mark.className = 'check-mark'; mark.textContent = c.status === 'pass' ? '\u2713' : '\u26A0';
      const label = document.createElement('span'); label.textContent = c.label;
      li.appendChild(mark); li.appendChild(label);
      if (c.detail) { const d = document.createElement('span'); d.className = 'check-detail'; d.textContent = c.detail; li.appendChild(d); }
      safety.appendChild(li);
    });
    const safetyPanel = document.getElementById('safety-panel');
    if (checks.length) safetyPanel.classList.remove('hidden'); else safetyPanel.classList.add('hidden');
  }

  function renderRecipe(recipe) {
    currentRecipe = recipe;

    document.getElementById('recipe-name').textContent = recipe.name;
    document.getElementById('badge-cuisine').textContent = recipe.cuisine;
    document.getElementById('badge-diet').textContent = recipe.dietaryPreference;

    const sourceBadge = document.getElementById('badge-source');
    sourceBadge.textContent = recipe.source;
    sourceBadge.className = recipe.source && recipe.source.includes('AI') ? 'chip chip-ai' : 'chip chip-source';

    document.getElementById('stat-time').textContent = `${recipe.cookingTime} min`;
    document.getElementById('stat-difficulty').textContent = recipe.difficulty;
    document.getElementById('stat-servings').textContent = recipe.servings;
    document.getElementById('stat-calories').textContent = recipe.nutrition ? Math.round(recipe.nutrition.calories) : '—';

    const ingredientList = document.getElementById('ingredient-list');
    ingredientList.textContent = '';
    (recipe.ingredients || []).forEach((ing) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = ing.name;
      const qty = document.createElement('span');
      qty.className = 'ingredient-qty';
      qty.textContent = `${formatQuantity(ing.quantity)} ${ing.unit || ''}`;
      li.appendChild(name);
      li.appendChild(qty);
      ingredientList.appendChild(li);
    });

    const stepList = document.getElementById('step-list');
    stepList.textContent = '';
    (recipe.instructions || []).forEach((step) => {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = step;
      li.appendChild(text);
      stepList.appendChild(li);
    });

    const n = recipe.nutrition || {};
    document.getElementById('n-calories').textContent = Math.round(n.calories || 0);
    document.getElementById('n-protein').textContent = `${Math.round(n.proteinGrams || 0)}g`;
    document.getElementById('n-carbs').textContent = `${Math.round(n.carbsGrams || 0)}g`;
    document.getElementById('n-fat').textContent = `${Math.round(n.fatGrams || 0)}g`;
    document.getElementById('estimated-note').textContent = n.estimated
      ? 'Nutrition values are estimated.'
      : '';

    const subsBlock = document.getElementById('substitution-block');
    const subsList = document.getElementById('substitution-list');
    subsList.textContent = '';
    if (recipe.substitutionNotes && recipe.substitutionNotes.length > 0) {
      recipe.substitutionNotes.forEach((note) => {
        const li = document.createElement('li');
        li.textContent = note;
        subsList.appendChild(li);
      });
      subsBlock.classList.remove('hidden');
    } else {
      subsBlock.classList.add('hidden');
    }

    // Persist the (possibly updated) recipe so a page refresh doesn't lose it.
    renderProvenance(recipe);
    sessionStorage.setItem('lastRecipeResult', JSON.stringify({ recipe, matchInfo: currentMatchInfo, consistency: currentConsistency }));
  }

  // --- Initial load ---------------------------------------------------
  function init() {
    const stored = sessionStorage.getItem('lastRecipeResult');
    const storedPrefs = sessionStorage.getItem('lastPreferences');

    if (!stored) {
      els.empty.classList.remove('hidden');
      els.loading.classList.remove('visible');
      return;
    }

    try {
      const data = JSON.parse(stored);
      currentPreferences = storedPrefs ? JSON.parse(storedPrefs) : null;
      currentMatchInfo = data.matchInfo || null;
      currentConsistency = data.consistency || null;
      const ms = Number(sessionStorage.getItem('lastGenerationMs'));
      currentElapsedMs = Number.isFinite(ms) && ms > 0 && currentMatchInfo ? ms : null;
      renderRecipe(data.recipe);
      setLoading(false);
    } catch (e) {
      els.empty.classList.remove('hidden');
      els.loading.classList.remove('visible');
    }
  }

  // --- Action: Save ------------------------------------------------------
  document.getElementById('action-save').addEventListener('click', async () => {
    const btn = document.getElementById('action-save');
    btn.disabled = true;
    const result = await RecipeAPI.save(currentRecipe);
    btn.disabled = false;
    if (AuthHelpers.isAuthRequired(result)) {
      // The recipe stays in sessionStorage, so this page re-renders it after sign-in.
      window.location.href = AuthHelpers.loginUrlFor('results.html');
      return;
    }
    if (result.success) {
      showToast('Recipe saved successfully.', false);
    } else {
      showToast((result.error && result.error.message) || 'Could not save this recipe.', true);
    }
  });

  // --- Action: Compare with another model -----------------------------
  // Hands the ORIGINAL request to the AI Lab (it fills the form; it never runs
  // a comparison by itself, because a comparison calls every configured model).
  document.getElementById('action-compare').addEventListener('click', () => {
    if (!currentPreferences) {
      showToast('Original preferences not found — please generate a new recipe.', true);
      return;
    }
    sessionStorage.setItem('labPrefill', JSON.stringify({ mode: 'all', preferences: currentPreferences }));
    window.location.href = 'ai-lab.html';
  });

  // --- Action: Regenerate ---------------------------------------------
  document.getElementById('action-regenerate').addEventListener('click', async () => {
    if (!currentPreferences) {
      showToast('Original preferences not found — please generate a new recipe.', true);
      return;
    }
    setLoading(true, 'Cooking up something different...');
    const started = Date.now();
    const result = await RecipeAPI.regenerate(currentPreferences, currentRecipe.id, false);
    if (result.success) {
      currentMatchInfo = result.data.matchInfo || null;
      currentConsistency = result.data.consistency || null;
      currentElapsedMs = Date.now() - started;
      renderRecipe(result.data.recipe);
      setLoading(false);
      showToast('Here is a new recipe.', false);
    } else {
      setLoading(false);
      showToast((result.error && result.error.message) || 'Could not regenerate a recipe.', true);
    }
  });

  // --- Action: Make Healthier -----------------------------------------
  document.getElementById('action-healthier').addEventListener('click', async () => {
    setLoading(true, 'Making this healthier...');
    const result = await RecipeAPI.makeHealthier(currentRecipe);
    if (result.success) {
      renderRecipe(result.data.recipe);
      setLoading(false);
      showToast('Recipe updated with healthier swaps.', false);
    } else {
      setLoading(false);
      showToast((result.error && result.error.message) || 'Could not update this recipe.', true);
    }
  });

  // --- Action: Substitute Ingredient (modal) ---------------------------
  const subModal = document.getElementById('substitute-modal');
  document.getElementById('action-substitute').addEventListener('click', () => {
    document.getElementById('substitute-input').value = '';
    subModal.classList.add('visible');
  });
  document.getElementById('substitute-cancel').addEventListener('click', () => {
    subModal.classList.remove('visible');
  });
  document.getElementById('substitute-confirm').addEventListener('click', async () => {
    const ingredient = document.getElementById('substitute-input').value.trim();
    if (!ingredient) return;
    subModal.classList.remove('visible');
    setLoading(true, 'Finding a substitute...');
    const result = await RecipeAPI.substitute(currentRecipe, ingredient);
    if (result.success) {
      renderRecipe(result.data.recipe);
      setLoading(false);
      showToast('Substitution suggested — see the notes below.', false);
    } else {
      setLoading(false);
      showToast((result.error && result.error.message) || 'Could not suggest a substitute.', true);
    }
  });

  // --- Action: Change Servings (modal) ---------------------------------
  const servingsModal = document.getElementById('servings-modal');
  let modalServings = 2;
  document.getElementById('action-servings').addEventListener('click', () => {
    modalServings = currentRecipe.servings;
    document.getElementById('modal-servings-value').textContent = modalServings;
    servingsModal.classList.add('visible');
  });
  document.getElementById('modal-servings-minus').addEventListener('click', () => {
    modalServings = Math.max(1, modalServings - 1);
    document.getElementById('modal-servings-value').textContent = modalServings;
  });
  document.getElementById('modal-servings-plus').addEventListener('click', () => {
    modalServings = Math.min(12, modalServings + 1);
    document.getElementById('modal-servings-value').textContent = modalServings;
  });
  document.getElementById('servings-cancel').addEventListener('click', () => {
    servingsModal.classList.remove('visible');
  });
  document.getElementById('servings-confirm').addEventListener('click', async () => {
    servingsModal.classList.remove('visible');
    setLoading(true, 'Scaling your recipe...');
    const result = await RecipeAPI.changeServings(currentRecipe, modalServings);
    if (result.success) {
      renderRecipe(result.data.recipe);
      setLoading(false);
      showToast(`Recipe scaled to ${modalServings} servings.`, false);
    } else {
      setLoading(false);
      showToast((result.error && result.error.message) || 'Could not change servings.', true);
    }
  });

  init();
})();
