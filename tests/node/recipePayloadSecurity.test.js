// Phase T: markup in recipes the browser sends back (save / customize) is refused and audited, and a saved
// recipe is rebuilt from known fields only. Runs the REAL engine; skipped, not failed, if it isn't built.
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

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-sec-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'data', 'recipes.json'), path.join(dir, 'recipes.json'));
  fs.writeFileSync(path.join(dir, 'saved_recipes.json'), '[]');
  return { bridge: createBridge({ enginePath: probe.enginePath, dataDir: dir, timeoutMs: 30000 }), dir };
}
const GOOD = {
  name: 'Dal', cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'Vegan', cookingTime: 30, difficulty: 'Easy', servings: 2,
  ingredients: [{ name: 'lentils', quantity: 1, unit: 'cup' }], instructions: ['Boil the lentils.'], source: 'Traditional Database Recipe',
};
const stored = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'saved_recipes.json'), 'utf8'));

test('RPS-01 save: markup in ANY string field (known or unknown) is blocked, audited as XSS_ATTEMPT, and nothing is stored', { skip }, async (t) => {
  const { bridge, dir } = setup(t);
  const attacks = [
    { ...GOOD, name: '<script>alert(1)</script>' },
    { ...GOOD, instructions: ['ok', '<img src=x onerror=alert(1)>'] },
    { ...GOOD, ingredients: [{ name: 'javascript:alert(1)', quantity: 1, unit: 'g' }] },
    { ...GOOD, unexpectedField: { deep: ['<iframe src=//evil></iframe>'] } },
    { ...GOOD, 'weird<script>key': 'x' },
    { ...GOOD, name: '&lt;script&gt;alert(1)&lt;/script&gt;' },           // entity-encoded
  ];
  for (const recipe of attacks) {
    const res = await bridge.runEngine('save', { recipe });
    assert.equal(res.success, false, JSON.stringify(recipe).slice(0, 60));
    assert.equal(res.error.code, 'XSS_SUSPECTED');
    assert.equal(statusForErrorCode(res.error.code), 400);
    const ev = res.securityEvents[0];
    assert.deepEqual([ev.type, ev.severity, ev.result, ev.action], ['XSS_ATTEMPT', 'HIGH', 'BLOCKED', 'save']);
    assert.doesNotMatch(JSON.stringify(res), /alert\(1\)|evil/);          // the offending text is never echoed
  }
  assert.deepEqual(stored(dir), []);
});

test('RPS-02 save: a clean recipe is stored REBUILT -- unknown/forged fields dropped, ownerId kept, id generated when absent', { skip }, async (t) => {
  const { bridge, dir } = setup(t);
  const res = await bridge.runEngine('save', { recipe: { ...GOOD, ownerId: 'u1', evil: { x: 1 }, savedAt: '1999-01-01T00:00:00Z', isAdminRecipe: true } });
  assert.equal(res.success, true);
  const rec = stored(dir)[0];
  assert.equal(rec.ownerId, 'u1');
  assert.equal(rec.evil, undefined);
  assert.equal(rec.isAdminRecipe, undefined);
  assert.notEqual(rec.savedAt, '1999-01-01T00:00:00Z');                  // the server stamps savedAt
  assert.match(rec.id, /^saved-/);                                        // no placeholder id
  assert.equal(rec.name, 'Dal');
  // a non-text ownerId is not carried over
  const res2 = await bridge.runEngine('save', { recipe: { ...GOOD, ownerId: { $ne: 1 } } });
  assert.equal(res2.success, true);
  assert.equal(stored(dir)[1].ownerId, undefined);
});

test('RPS-03 save: invalid shapes are 400-class errors, never a crash -- no name, wrong types, over-nesting, bad diet', { skip }, async (t) => {
  const { bridge, dir } = setup(t);
  const nested = (n) => { const o = {}; let c = o; for (let i = 0; i < n; i += 1) { c.a = {}; c = c.a; } return o; };
  const bad = [
    { ingredients: [], instructions: [] },
    { ...GOOD, ingredients: 'lentils' },
    { ...GOOD, ingredients: [{ name: 5, quantity: 'x', unit: [] }] },
    { ...GOOD, dietaryPreference: 'Carnivore' },
    { ...GOOD, z: nested(20) },
    [], 'string', 42, null,
  ];
  for (const recipe of bad) {
    const res = await bridge.runEngine('save', { recipe });
    assert.equal(res.success, false, JSON.stringify(recipe).slice(0, 60));
    assert.equal(statusForErrorCode(res.error.code), 400, `${res.error.code} must be a client error`);
  }
  assert.deepEqual(stored(dir), []);
});

test('RPS-04 customize: markup in the recipe or in the argument is blocked and audited; normal customization still works', { skip }, async (t) => {
  const { bridge } = setup(t);
  const blocked = await bridge.runEngine('customize', { recipe: GOOD, action: 'substitute', argument: '<img src=x onerror=alert(1)>' });
  assert.equal(blocked.error.code, 'XSS_SUSPECTED');
  assert.equal(blocked.securityEvents[0].action, 'customize');
  const blocked2 = await bridge.runEngine('customize', { recipe: { ...GOOD, name: '<script>x</script>' }, action: 'healthier', argument: '' });
  assert.equal(blocked2.error.code, 'XSS_SUSPECTED');
  const ok = await bridge.runEngine('customize', { recipe: GOOD, action: 'servings', argument: '4' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.recipe.servings, 4);
  assert.equal(ok.securityEvents, undefined);                            // a clean request emits no security event
});

test('RPS-05 text that merely MENTIONS markup words in plain language is not a false positive', { skip }, async (t) => {
  const { bridge } = setup(t);
  const res = await bridge.runEngine('save', { recipe: { ...GOOD, name: "Grandma's script-free dal", instructions: ['Cook until the lentils are < soft & tender > about 20 minutes.'] } });
  assert.equal(res.success, true, JSON.stringify(res.error));
});
