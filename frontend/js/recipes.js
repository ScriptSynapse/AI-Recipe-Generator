/**
 * recipes.js
 * ---------------------------------------------------------------------
 * Drives the "My Recipes" dashboard: loads saved recipes via
 * GET /api/recipes, renders them as cards with loading/empty/error
 * states, and supports View (jumps to results.html) and Delete.
 */

(function () {
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const emptyState = document.getElementById('empty-state');
  const grid = document.getElementById('recipes-grid');
  const errorMessage = document.getElementById('error-message');

  function showOnly(el) {
    [loadingState, errorState, emptyState, grid].forEach((e) => e.classList.add('hidden'));
    el.classList.remove('hidden');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function renderCard(recipe) {
    const card = document.createElement('div');
    card.className = 'card card-hover recipe-card';

    const sourceLabel = recipe.source && recipe.source.includes('AI') ? 'chip chip-ai' : 'chip chip-source';

    card.innerHTML = `
      <h3>${escapeHtml(recipe.name)}</h3>
      <div class="recipe-meta">
        <span class="chip chip-source">${escapeHtml(recipe.cuisine || '')}</span>
        <span class="chip chip-source">${escapeHtml(String(recipe.cookingTime || ''))} min</span>
        <span class="chip chip-source">${escapeHtml(recipe.difficulty || '')}</span>
        <span class="${sourceLabel}">${escapeHtml(recipe.source || '')}</span>
      </div>
      <span class="saved-date">Saved ${escapeHtml(formatDate(recipe.savedAt))}</span>
      <div class="recipe-card-actions">
        <button class="btn btn-ghost view-btn">View</button>
        <button class="btn btn-ghost btn-danger delete-btn">Delete</button>
      </div>
    `;

    card.querySelector('.view-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.setItem('lastRecipeResult', JSON.stringify({ recipe }));
      // No original preferences for a previously-saved recipe -- Regenerate
      // will prompt the user to generate a fresh one instead.
      sessionStorage.removeItem('lastPreferences');
      window.location.href = 'results.html';
    });

    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${recipe.name}"? This cannot be undone.`)) return;
      const result = await RecipeAPI.remove(recipe.id);
      if (result.success) {
        loadRecipes();
      } else {
        alert((result.error && result.error.message) || 'Could not delete this recipe.');
      }
    });

    return card;
  }

  async function loadRecipes() {
    showOnly(loadingState);
    const result = await RecipeAPI.list();

    if (!result.success) {
      errorMessage.textContent = (result.error && result.error.message) || 'Something went wrong. Please try again.';
      showOnly(errorState);
      return;
    }

    const recipes = result.data.recipes || [];
    if (recipes.length === 0) {
      showOnly(emptyState);
      return;
    }

    grid.innerHTML = '';
    recipes.forEach((recipe) => grid.appendChild(renderCard(recipe)));
    showOnly(grid);
  }

  document.getElementById('retry-btn').addEventListener('click', loadRecipes);

  loadRecipes();
})();
