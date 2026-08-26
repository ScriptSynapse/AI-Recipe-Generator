/**
 * generator.js
 * ---------------------------------------------------------------------
 * Drives the recipe-generation form: ingredient chip management,
 * single-select option pills, servings stepper, client-side empty-state
 * validation, and the POST /api/recipes/generate call. On success, the
 * returned recipe + matchInfo are stashed in sessionStorage and the user
 * is routed to results.html to display them.
 */

(function () {
  const state = {
    ingredients: [],
    mealType: 'Dinner',
    cookingTime: 30,
    difficulty: 'Medium',
    servings: 2,
  };

  const ingredientInput = document.getElementById('ingredient-input');
  const addIngredientBtn = document.getElementById('add-ingredient-btn');
  const ingredientChips = document.getElementById('ingredient-chips');
  const ingredientEmptyHint = document.getElementById('ingredient-empty-hint');
  const cuisineSelect = document.getElementById('cuisine-select');
  const dietSelect = document.getElementById('diet-select');
  const servingsValue = document.getElementById('servings-value');
  const errorBanner = document.getElementById('error-banner');
  const form = document.getElementById('generator-form');
  const loadingState = document.getElementById('loading-state');
  const loadingMessage = document.getElementById('loading-message');
  const generateBtn = document.getElementById('generate-btn');

  // --- Ingredient chip management ------------------------------------
  function renderIngredientChips() {
    ingredientChips.innerHTML = '';
    state.ingredients.forEach((ingredient, index) => {
      const chip = document.createElement('span');
      chip.className = 'chip chip-ingredient';
      chip.innerHTML = `${escapeHtml(ingredient)} <button type="button" aria-label="Remove ${escapeHtml(ingredient)}">&times;</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.ingredients.splice(index, 1);
        renderIngredientChips();
      });
      ingredientChips.appendChild(chip);
    });
  }

  function addIngredientFromInput() {
    const raw = ingredientInput.value.trim();
    if (!raw) return;
    // Support comma-separated paste, e.g. "paneer, tomato, onion"
    raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((name) => {
      if (!state.ingredients.some((i) => i.toLowerCase() === name.toLowerCase())) {
        state.ingredients.push(name);
      }
    });
    ingredientInput.value = '';
    ingredientEmptyHint.classList.remove('visible');
    renderIngredientChips();
  }

  addIngredientBtn.addEventListener('click', addIngredientFromInput);
  ingredientInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addIngredientFromInput();
    }
  });

  // --- Single-select option pill groups --------------------------------
  function wireOptionGroup(groupId, stateKey, parser) {
    const group = document.getElementById(groupId);
    group.querySelectorAll('.option-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        group.querySelectorAll('.option-pill').forEach((p) => p.classList.remove('selected'));
        pill.classList.add('selected');
        state[stateKey] = parser(pill.getAttribute('data-value'));
      });
    });
  }

  wireOptionGroup('meal-type-group', 'mealType', (v) => v);
  wireOptionGroup('cooking-time-group', 'cookingTime', (v) => parseInt(v, 10));
  wireOptionGroup('difficulty-group', 'difficulty', (v) => v);

  // --- Servings stepper -------------------------------------------------
  document.getElementById('servings-minus').addEventListener('click', () => {
    state.servings = Math.max(1, state.servings - 1);
    servingsValue.textContent = state.servings;
  });
  document.getElementById('servings-plus').addEventListener('click', () => {
    state.servings = Math.min(12, state.servings + 1);
    servingsValue.textContent = state.servings;
  });

  // --- Pre-fill cuisine from a category card on the home page ----------
  const urlParams = new URLSearchParams(window.location.search);
  const prefilledCuisine = urlParams.get('cuisine');
  if (prefilledCuisine) {
    cuisineSelect.value = prefilledCuisine;
  }

  // --- Form submit --------------------------------------------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBanner.classList.remove('visible');
    ingredientEmptyHint.classList.remove('visible');

    if (state.ingredients.length === 0) {
      ingredientEmptyHint.classList.add('visible');
      ingredientInput.focus();
      return;
    }

    const preferences = {
      ingredients: state.ingredients,
      cuisine: cuisineSelect.value,
      mealType: state.mealType,
      dietaryPreference: dietSelect.value,
      cookingTime: state.cookingTime,
      difficulty: state.difficulty,
      servings: state.servings,
    };

    form.classList.add('hidden');
    loadingState.classList.add('visible');
    loadingMessage.textContent = 'Creating your recipe...';
    generateBtn.disabled = true;

    const result = await RecipeAPI.generate(preferences);

    if (!result.success) {
      form.classList.remove('hidden');
      loadingState.classList.remove('visible');
      generateBtn.disabled = false;
      errorBanner.textContent = (result.error && result.error.message) || 'Something went wrong. Please try again.';
      errorBanner.classList.add('visible');
      return;
    }

    // Stash the result + the original preferences (needed for Regenerate)
    // and hand off to the results page.
    sessionStorage.setItem('lastRecipeResult', JSON.stringify(result.data));
    sessionStorage.setItem('lastPreferences', JSON.stringify(preferences));
    window.location.href = 'results.html';
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
