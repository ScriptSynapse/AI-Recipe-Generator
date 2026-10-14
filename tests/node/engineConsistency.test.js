// Phase R: the engine's ingredient-consistency report and RecipeBuilder validation, through the REAL
// compiled engine (no Express needed). Skipped, not failed, if the engine isn't built.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { probeEngine } = require('../helpers/engineProbe');
const probe = probeEngine();
const skip = probe.skipReason;
const { createBridge } = require('../../backend/services/cppBridge');
const { statusForErrorCode } = require('../../backend/controllers/recipeController');

function bridge(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-cons-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'data', 'recipes.json'), path.join(dir, 'recipes.json'));
  fs.writeFileSync(path.join(dir, 'saved_recipes.json'), '[]');
  return createBridge({ enginePath: probe.enginePath, dataDir: dir, timeoutMs: 30000 });
}

const PREFS = { ingredients: ['paneer', 'tomato', 'onion'], cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'Vegetarian', cookingTime: 30, difficulty: 'Medium', servings: 2 };
const RECIPE = {
  id: 'r1', name: 'Test dish', cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'Vegetarian', cookingTime: 30, difficulty: 'Medium', servings: 2,
  ingredients: [{ name: 'paneer', quantity: 200, unit: 'g' }, { name: 'tomato', quantity: 2, unit: '' }],
  instructions: ['Heat the oil in a pan.', 'Add everything and cook for ten minutes.'], source: 'Traditional Database Recipe',
};

test('EC-01 generate returns a consistency report whose checks mirror the spec\'s AI SAFETY CHECK list', { skip }, async (t) => {
  const res = await bridge(t).runEngine('generate', { preferences: PREFS });
  assert.equal(res.success, true);
  const c = res.data.consistency;
  assert.ok(c, 'consistency present');
  assert.equal(c.checks.length, 4);
  assert.deepEqual(c.checks.map((x) => x.label.replace(/^\d+ /, '')).slice(0, 2), ['Required ingredients respected', 'Dietary preference respected']);
  for (const check of c.checks) assert.ok(['pass', 'warn'].includes(check.status));
  assert.equal(typeof c.requiredRespected, 'boolean');
  assert.ok(Array.isArray(c.missingRequired) && Array.isArray(c.additional));
});

test('EC-02 the report is computed from the recipe actually returned, not asserted', { skip }, async (t) => {
  const res = await bridge(t).runEngine('generate', { preferences: { ...PREFS, ingredients: ['zzzunknownfood', 'qqqmystery'] } });
  assert.equal(res.success, true);
  const c = res.data.consistency;
  const used = res.data.recipe.ingredients.map((i) => i.name.toLowerCase());
  const wanted = ['zzzunknownfood', 'qqqmystery'];
  const isUsed = (w) => used.some((u) => u.includes(w) || w.includes(u));
  // Both directions: everything listed missing really is unused, and everything unused is listed.
  for (const w of wanted) assert.equal(c.missingRequired.includes(w), !isUsed(w), w);
  assert.equal(c.requiredRespected, c.missingRequired.length === 0);
  assert.equal(c.checks[0].status, c.requiredRespected ? 'pass' : 'warn');
});

test('EC-03 customize accepts a valid recipe and rejects invalid ones with specific, value-free codes', { skip }, async (t) => {
  const b = bridge(t);
  const ok = await b.runEngine('customize', { recipe: RECIPE, action: 'servings', argument: '4' });
  assert.equal(ok.success, true, JSON.stringify(ok));
  const cases = [
    [{ ...RECIPE, name: '' }, 'RECIPE_NAME'],
    [{ ...RECIPE, ingredients: [] }, 'RECIPE_INGREDIENTS'],
    [{ ...RECIPE, instructions: [] }, 'RECIPE_INSTRUCTIONS'],
    [{ ...RECIPE, cookingTime: 0 }, 'RECIPE_TIME'],
    [{ ...RECIPE, servings: 99 }, 'RECIPE_SERVINGS'],
    [{ ...RECIPE, difficulty: 'Impossible' }, 'RECIPE_DIFFICULTY'],
    [{ ...RECIPE, dietaryPreference: 'Carnivore' }, 'RECIPE_DIET'],
    [{ ...RECIPE, dietaryPreference: '<script>x</script>' }, 'XSS_SUSPECTED'],   // markup is stopped by the payload scan, before the builder
  ];
  for (const [recipe, code] of cases) {
    const res = await b.runEngine('customize', { recipe, action: 'healthier' });
    assert.equal(res.success, false, code);
    assert.equal(res.error.code, code);
    assert.equal(JSON.stringify(res).includes('<script>'), false, 'the supplied value is never echoed');   // (the detector's fixed wording may say "script tag")
  }
});

test('EC-04 every RecipeBuilder error code is an HTTP 400, never a 500', () => {
  for (const code of ['RECIPE_NAME', 'RECIPE_INGREDIENTS', 'RECIPE_INSTRUCTIONS', 'RECIPE_TIME', 'RECIPE_SERVINGS', 'RECIPE_DIFFICULTY', 'RECIPE_DIET', 'RECIPE_CUISINE', 'RECIPE_MEAL_TYPE', 'RECIPE_PROVIDER']) {
    assert.equal(statusForErrorCode(code), 400, code);
  }
  assert.equal(statusForErrorCode('STORAGE_ERROR'), 500);
  assert.equal(statusForErrorCode('NOT_FOUND'), 404);
});

test('EC-05 engine: 20 concurrent saves from separate processes all succeed (FileLock EEXIST race)', { skip }, async (t) => {
  const b = bridge(t);
  for (let round = 0; round < 3; round += 1) {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => b.runEngine('save', { recipe: { ...RECIPE, id: undefined, name: `R${round}-${i}` } })));
    const failed = results.filter((r) => !r.success);
    assert.equal(failed.length, 0, JSON.stringify(failed[0]));
  }
  assert.equal((await b.runEngine('list')).data.recipes.length, 60);
});
