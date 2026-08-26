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

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatQuantity(qty) {
    const n = Number(qty);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  }

  // --- Rendering ----------------------------------------------------------
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
    ingredientList.innerHTML = '';
    (recipe.ingredients || []).forEach((ing) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(ing.name)}</span><span class="ingredient-qty">${formatQuantity(ing.quantity)} ${escapeHtml(ing.unit || '')}</span>`;
      ingredientList.appendChild(li);
    });

    const stepList = document.getElementById('step-list');
    stepList.innerHTML = '';
    (recipe.instructions || []).forEach((step) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(step)}</span>`;
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
    subsList.innerHTML = '';
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
    sessionStorage.setItem('lastRecipeResult', JSON.stringify({ recipe }));
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
    if (result.success) {
      showToast('Recipe saved successfully.', false);
    } else {
      showToast((result.error && result.error.message) || 'Could not save this recipe.', true);
    }
  });

  // --- Action: Regenerate ---------------------------------------------
  document.getElementById('action-regenerate').addEventListener('click', async () => {
    if (!currentPreferences) {
      showToast('Original preferences not found — please generate a new recipe.', true);
      return;
    }
    setLoading(true, 'Cooking up something different...');
    const result = await RecipeAPI.regenerate(currentPreferences, currentRecipe.id, false);
    if (result.success) {
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
