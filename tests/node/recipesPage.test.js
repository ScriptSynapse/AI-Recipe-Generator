// My Recipes page: pure model + the page script on the strict fake DOM (throws on innerHTML).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const RecipesModel = require('../../frontend/js/recipesModel');
const AuthHelpers = require('../../frontend/js/authHelpers');
const { FakeElement, createDocument, flush, runFrontendScript } = require('../helpers/fakeDom');

const R = [
  { id: 'a', name: 'Paneer Tikka', cuisine: 'Indian', dietaryPreference: 'Vegetarian', difficulty: 'Easy', cookingTime: 30, savedAt: '2026-01-03T10:00:00Z', source: 'Database Recipe' },
  { id: 'b', name: 'Pasta Bake', cuisine: 'Italian', dietaryPreference: 'No Preference', difficulty: 'Medium', cookingTime: 40, savedAt: '2026-02-01T10:00:00Z', source: 'AI Generated Recipe', aiProvider: 'gemini', usedFallback: false },
  { id: 'c', name: 'Dal', cuisine: 'indian', dietaryPreference: 'Vegan', difficulty: 'Easy', cookingTime: 25, savedAt: '2026-01-20T10:00:00Z', source: 'AI Generated Recipe', aiProvider: 'offline', usedFallback: true },
];

test('RP-01 modelLabel/isModelValidated use only the record: provider, offline fallback, database', () => {
  assert.equal(RecipesModel.modelLabel(R[1]), 'gemini');
  assert.equal(RecipesModel.modelLabel(R[2]), 'Offline generator');
  assert.equal(RecipesModel.modelLabel(R[0]), 'Recipe database');
  assert.equal(RecipesModel.isModelValidated(R[1]), true);
  assert.equal(RecipesModel.isModelValidated(R[2]), false);   // template fallback: no model answered
  assert.equal(RecipesModel.isModelValidated(R[0]), false);
  assert.equal(RecipesModel.isModelValidated(null), false);
  assert.equal(RecipesModel.modelLabel(null), '');
});

test('RP-02 apply: search, filters (case-insensitive), sort, and the input is not mutated', () => {
  const copy = JSON.stringify(R);
  assert.deepEqual(RecipesModel.apply(R, {}).map((r) => r.id), ['b', 'c', 'a']);               // newest first
  assert.deepEqual(RecipesModel.apply(R, { sort: 'oldest' }).map((r) => r.id), ['a', 'c', 'b']);
  assert.deepEqual(RecipesModel.apply(R, { cuisine: 'Indian' }).map((r) => r.id), ['c', 'a']); // matches 'indian' too
  assert.deepEqual(RecipesModel.apply(R, { query: ' TIKKA ' }).map((r) => r.id), ['a']);
  assert.deepEqual(RecipesModel.apply(R, { query: 'italian' }).map((r) => r.id), ['b']);       // cuisine is searched too
  assert.deepEqual(RecipesModel.apply(R, { diet: 'vegan', difficulty: 'easy' }).map((r) => r.id), ['c']);
  assert.deepEqual(RecipesModel.apply(R, { query: 'zzz' }), []);
  assert.deepEqual(RecipesModel.apply(null, {}), []);
  assert.deepEqual(RecipesModel.apply([null, 5, R[0]], {}).map((r) => r.id), ['a']);
  assert.equal(JSON.stringify(R), copy);
});

test('RP-03 facet: distinct (case-insensitive), sorted, blanks and non-strings ignored', () => {
  assert.deepEqual(RecipesModel.facet(R, 'cuisine'), ['Indian', 'Italian']);
  assert.deepEqual(RecipesModel.facet([{ cuisine: '' }, { cuisine: 5 }, {}], 'cuisine'), []);
});

// ---- page script ------------------------------------------------------------------------
function boot({ recipes, listResult, removeResult }) {
  const ids = ['loading-state', 'error-state', 'empty-state', 'recipes-grid', 'recipes-toolbar', 'no-match-state', 'recipes-count',
    'error-message', 'retry-btn', 'filter-query', 'filter-cuisine', 'filter-diet', 'filter-difficulty', 'filter-sort', 'filter-reset'];
  const document = createDocument(ids);
  document.body = new FakeElement('body');
  document.activeElement = null;
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
  document.getElementById('filter-sort').value = 'newest';
  const toasts = [];
  const confirmAnswers = [];
  const Components = {
    el: (tag, o = {}, kids = []) => { const n = document.createElement(tag); if (o.class) n.className = o.class; if (o.text != null) n.textContent = o.text; Object.entries(o.attrs || {}).forEach(([k, v]) => n.setAttribute(k, v)); kids.forEach((k) => k && n.appendChild(k)); return n; },
    toast: (m, k) => toasts.push([m, k]),
    confirm: async () => (confirmAnswers.length ? confirmAnswers.shift() : false),
  };
  const removed = [];
  const RecipeAPI = {
    list: async () => listResult || { success: true, data: { recipes } },
    remove: async (id) => { removed.push(id); return removeResult || { success: true }; },
  };
  const window = { location: { href: '' } };
  const sessionStorage = { setItem() {}, removeItem() {} };
  runFrontendScript('recipes.js', { document, Components, RecipesModel, RecipeAPI, AuthHelpers, window, sessionStorage });
  const $ = (id) => document.getElementById(id);
  return { $, toasts, confirmAnswers, removed, window };
}
const names = (grid) => grid.children.map((c) => c.children[0].textContent);

test('RP-04 loads, shows newest first, count text, filter menus built from the data', async () => {
  const p = boot({ recipes: R });
  await flush(); await flush();
  assert.deepEqual(names(p.$('recipes-grid')), ['Pasta Bake', 'Dal', 'Paneer Tikka']);
  assert.equal(p.$('recipes-count').textContent, '3 saved recipes');
  assert.equal(p.$('recipes-grid').classes.has('hidden'), false);
  assert.equal(p.$('recipes-toolbar').classes.has('hidden'), false);
  assert.deepEqual(p.$('filter-cuisine').children.map((o) => o.value), ['', 'Indian', 'Italian']);
});

test('RP-05 filtering narrows the grid; no match shows the message; Reset restores', async () => {
  const p = boot({ recipes: R });
  await flush(); await flush();
  p.$('filter-query').value = 'dal';
  await p.$('filter-query').dispatch('input');
  assert.deepEqual(names(p.$('recipes-grid')), ['Dal']);
  assert.equal(p.$('recipes-count').textContent, 'Showing 1 of 3');
  p.$('filter-query').value = 'zzz';
  await p.$('filter-query').dispatch('input');
  assert.equal(p.$('no-match-state').classes.has('hidden'), false);
  assert.equal(p.$('recipes-grid').classes.has('hidden'), true);
  await p.$('filter-reset').dispatch('click');
  assert.equal(p.$('recipes-grid').children.length, 3);
});

test('RP-06 hostile recipe names stay inert text (the fake DOM throws on innerHTML)', async () => {
  const evil = { id: 'x', name: '<img src=x onerror=alert(1)>', cuisine: '"><script>', difficulty: 'Easy', savedAt: '2026-03-01T00:00:00Z', source: 'Database Recipe' };
  const p = boot({ recipes: [evil] });
  await flush(); await flush();
  assert.equal(p.$('recipes-grid').children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
});

test('RP-07 delete: cancelling the dialog deletes nothing; confirming deletes, toasts and reloads', async () => {
  const p = boot({ recipes: R });
  await flush(); await flush();
  const del = () => p.$('recipes-grid').children[0].querySelector('.delete-btn');
  await del().dispatch('click');
  assert.deepEqual(p.removed, []);
  p.confirmAnswers.push(true);
  await del().dispatch('click');
  assert.deepEqual(p.removed, ['b']);
  assert.deepEqual(p.toasts[0], ['Recipe deleted.', 'success']);
});

test('RP-08 delete failure toasts the server message; auth-required redirects to login; load errors show the error state', async () => {
  const p = boot({ recipes: R, removeResult: { success: false, error: { message: 'Nope.' } } });
  await flush(); await flush();
  p.confirmAnswers.push(true);
  await p.$('recipes-grid').children[0].querySelector('.delete-btn').dispatch('click');
  assert.deepEqual(p.toasts[0], ['Nope.', 'error']);

  const out = boot({ recipes: [], listResult: { success: false, status: 401, error: { code: 'AUTH_REQUIRED' } } });
  await flush(); await flush();
  assert.match(out.window.location.href, /login\.html/);

  const bad = boot({ recipes: [], listResult: { success: false, error: { message: 'Boom' } } });
  await flush(); await flush();
  assert.equal(bad.$('error-state').classes.has('hidden'), false);
  assert.equal(bad.$('error-message').textContent, 'Boom');

  const empty = boot({ recipes: [] });
  await flush(); await flush();
  assert.equal(empty.$('empty-state').classes.has('hidden'), false);
});

test('RP-09 page wiring: recipes.html loads components + model before the script; no innerHTML/confirm/alert in the script', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'recipes.html'), 'utf8');
  const order = ['js/components.js', 'js/recipesModel.js', 'js/recipes.js'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order[0] < order[2] && order[1] < order[2]);
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'recipes.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML|(?<![.\w])confirm\(|(?<![.\w])alert\(/);
});
