/**
 * recipes.js
 * ---------------------------------------------------------------------
 * "My Recipes": loads the signed-in user's saved recipes (GET /api/recipes),
 * filters/sorts them in the browser (RecipesModel), and supports View and
 * Delete. All text is set with textContent.
 */
(function () {
  const { el, toast } = Components;
  const $ = (id) => document.getElementById(id);
  const loadingState = $('loading-state');
  const errorState = $('error-state');
  const emptyState = $('empty-state');
  const grid = $('recipes-grid');
  const toolbar = $('recipes-toolbar');
  const noMatch = $('no-match-state');
  const countEl = $('recipes-count');
  let allRecipes = [];

  function showOnly(...visible) {
    [loadingState, errorState, emptyState, grid, toolbar, noMatch].forEach((e) => e.classList.add('hidden'));
    visible.forEach((e) => e.classList.remove('hidden'));
  }

  function formatDate(iso) {
    const t = Date.parse(iso);
    if (!iso || Number.isNaN(t)) return '';
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  const chip = (text, cls) => el('span', { class: `chip ${cls || 'chip-source'}`, text });

  function renderCard(recipe) {
    const model = RecipesModel.modelLabel(recipe);
    const chips = [];
    if (recipe.cuisine) chips.push(chip(recipe.cuisine));
    if (recipe.cookingTime) chips.push(chip(`${recipe.cookingTime} min`));
    if (recipe.difficulty) chips.push(chip(recipe.difficulty));
    chips.push(chip(model, 'chip-source'));
    if (RecipesModel.isModelValidated(recipe)) chips.push(chip('Output validated', 'chip-diet'));

    const viewBtn = el('button', { class: 'btn btn-ghost view-btn', text: 'View', attrs: { type: 'button' } });
    const deleteBtn = el('button', {
      class: 'btn btn-ghost btn-danger delete-btn', text: 'Delete', attrs: { type: 'button', 'aria-label': `Delete ${recipe.name}` },
    });
    const date = formatDate(recipe.savedAt);
    const card = el('div', { class: 'card card-hover recipe-card' }, [
      el('h3', { text: recipe.name }),
      el('div', { class: 'recipe-meta' }, chips),
      date ? el('span', { class: 'saved-date', text: `Saved ${date}` }) : null,
      el('div', { class: 'recipe-card-actions' }, [viewBtn, deleteBtn]),
    ]);

    viewBtn.addEventListener('click', () => {
      sessionStorage.setItem('lastRecipeResult', JSON.stringify({ recipe }));
      // A saved recipe has no original preferences, so Regenerate will ask for a fresh request.
      sessionStorage.removeItem('lastPreferences');
      window.location.href = 'results.html';
    });

    deleteBtn.addEventListener('click', async () => {
      const yes = await Components.confirm({
        title: 'Delete this recipe?', message: `"${recipe.name}" will be removed. This cannot be undone.`,
        confirmLabel: 'Delete', danger: true,
      });
      if (!yes) return;
      const result = await RecipeAPI.remove(recipe.id);
      if (AuthHelpers.isAuthRequired(result)) { window.location.href = AuthHelpers.loginUrlFor('recipes.html'); return; }
      if (result.success) { toast('Recipe deleted.', 'success'); loadRecipes(); }
      else toast((result.error && result.error.message) || 'Could not delete this recipe.', 'error');
    });
    return card;
  }

  function currentFilters() {
    return {
      query: $('filter-query').value, cuisine: $('filter-cuisine').value, diet: $('filter-diet').value,
      difficulty: $('filter-difficulty').value, sort: $('filter-sort').value,
    };
  }

  function render() {
    const shown = RecipesModel.apply(allRecipes, currentFilters());
    countEl.textContent = shown.length === allRecipes.length
      ? `${allRecipes.length} saved recipe${allRecipes.length === 1 ? '' : 's'}`
      : `Showing ${shown.length} of ${allRecipes.length}`;
    grid.textContent = '';
    if (shown.length === 0) { showOnly(toolbar, noMatch); return; }
    shown.forEach((r) => grid.appendChild(renderCard(r)));
    showOnly(toolbar, grid);
  }

  function fillMenu(select, values) {
    const keep = select.value;
    select.textContent = '';
    const any = document.createElement('option');
    any.value = ''; any.textContent = 'All';
    select.appendChild(any);
    values.forEach((v) => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      select.appendChild(o);
    });
    if (values.includes(keep)) select.value = keep;
  }

  async function loadRecipes() {
    showOnly(loadingState);
    const result = await RecipeAPI.list();
    if (AuthHelpers.isAuthRequired(result)) { window.location.href = AuthHelpers.loginUrlFor('recipes.html'); return; }
    if (!result.success) {
      $('error-message').textContent = (result.error && result.error.message) || 'Something went wrong. Please try again.';
      showOnly(errorState);
      return;
    }
    allRecipes = result.data.recipes || [];
    if (allRecipes.length === 0) { showOnly(emptyState); return; }
    fillMenu($('filter-cuisine'), RecipesModel.facet(allRecipes, 'cuisine'));
    fillMenu($('filter-diet'), RecipesModel.facet(allRecipes, 'dietaryPreference'));
    fillMenu($('filter-difficulty'), RecipesModel.facet(allRecipes, 'difficulty'));
    render();
  }

  ['filter-query'].forEach((id) => $(id).addEventListener('input', render));
  ['filter-cuisine', 'filter-diet', 'filter-difficulty', 'filter-sort'].forEach((id) => $(id).addEventListener('change', render));
  $('filter-reset').addEventListener('click', () => {
    $('filter-query').value = ''; ['filter-cuisine', 'filter-diet', 'filter-difficulty'].forEach((id) => { $(id).value = ''; });
    $('filter-sort').value = 'newest';
    render();
  });
  $('retry-btn').addEventListener('click', loadRecipes);

  loadRecipes();
})();
