const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBridge, EngineError, buildChildEnv, redact } = require('../../backend/services/cppBridge');

const isWin = process.platform === 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Writes an executable node script standing in for recipe_engine.
function fakeEngine(name, body) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

test('buildChildEnv forwards only allow-listed, non-empty variables', () => {
  const env = buildChildEnv({
    PATH: '/bin', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: '', DATABASE_PASSWORD: 'secret', JWT_SECRET: 's',
  });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
  assert.equal('OPENAI_API_KEY' in env, false, 'empty values are not forwarded');
  assert.equal('DATABASE_PASSWORD' in env, false);
  assert.equal('JWT_SECRET' in env, false);
});

test('redact masks API-key-shaped strings and truncates long text', () => {
  const fakeKey = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz'].join('-'); // built at runtime: no key-shaped literal in source
  const out = redact(`failed with key ${fakeKey} and x-api-key: abc123`);
  assert.equal(out.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.equal(out.includes('abc123'), false);
  assert.match(out, /REDACTED/);
  assert.ok(redact('x'.repeat(5000)).length < 600);
});

test('round-trips JSON through a child process', { skip: isWin }, async () => {
  const engine = fakeEngine('echo.js',
    `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify({success:true,argv:process.argv.slice(2,3),got:JSON.parse(d)})));`);
  const { runEngine } = createBridge({ enginePath: engine, dataDir: tmp });
  const res = await runEngine('health', { a: 1 });
  assert.equal(res.success, true);
  assert.deepEqual(res.argv, ['health']);
  assert.deepEqual(res.got, { a: 1 });
});

test('child does not receive non-allow-listed secrets', { skip: isWin }, async () => {
  const engine = fakeEngine('env.js', `console.log(JSON.stringify({success:true,env:process.env}));`);
  const { runEngine } = createBridge({
    enginePath: engine, dataDir: tmp,
    env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'kept', JWT_SECRET: 'leak-me', DB_PASSWORD: 'leak-me-too' },
  });
  const res = await runEngine('health');
  assert.equal(res.env.ANTHROPIC_API_KEY, 'kept');
  assert.equal(res.env.JWT_SECRET, undefined);
  assert.equal(res.env.DB_PASSWORD, undefined);
});

test('hung engine is killed and reported as ENGINE_TIMEOUT', { skip: isWin }, async () => {
  const engine = fakeEngine('hang.js', `setInterval(()=>{},1000);`);
  const { runEngine } = createBridge({ enginePath: engine, dataDir: tmp, timeoutMs: 300 });
  const started = Date.now();
  await assert.rejects(runEngine('generate', {}), (err) => {
    assert.ok(err instanceof EngineError);
    assert.equal(err.code, 'ENGINE_TIMEOUT');
    return true;
  });
  assert.ok(Date.now() - started < 3000, 'must not wait far beyond the timeout');
});

test('unreadable output -> ENGINE_BAD_RESPONSE without leaking raw output', { skip: isWin }, async () => {
  const engine = fakeEngine('garbage.js', `console.log('SECRET-INTERNAL /home/user/app/path not json');`);
  const { runEngine } = createBridge({ enginePath: engine, dataDir: tmp });
  await assert.rejects(runEngine('list'), (err) => {
    assert.equal(err.code, 'ENGINE_BAD_RESPONSE');
    assert.equal(err.publicMessage.includes('SECRET-INTERNAL'), false);
    assert.equal(err.message.includes('/home/user'), false);
    return true;
  });
});

test('missing binary -> ENGINE_UNAVAILABLE with no filesystem path in the public message', async () => {
  const missing = path.join(tmp, 'does-not-exist', 'recipe_engine');
  const { runEngine } = createBridge({ enginePath: missing, dataDir: tmp });
  await assert.rejects(runEngine('health'), (err) => {
    assert.equal(err.code, 'ENGINE_UNAVAILABLE');
    assert.equal(err.publicMessage.includes(tmp), false);
    assert.equal(err.message.includes(tmp), false);
    assert.ok(err.detail.includes('recipe_engine'), 'detail (server log only) keeps the path');
    return true;
  });
});

test('oversized output is cut off', { skip: isWin }, async () => {
  const engine = fakeEngine('big.js', `process.stdout.write('x'.repeat(200000));`);
  const { runEngine } = createBridge({ enginePath: engine, dataDir: tmp, maxOutputBytes: 1000 });
  await assert.rejects(runEngine('list'), (err) => err.code === 'ENGINE_ERROR');
});

// ---- Integration against the REAL compiled engine (skipped if not built) ----
const { probeEngine } = require('../helpers/engineProbe');
const engineProbe = probeEngine();
const realEngine = engineProbe.enginePath;
const engineSkip = engineProbe.skipReason;

function realBridge() {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'data-'));
  fs.copyFileSync(path.join(__dirname, '..', '..', 'data', 'recipes.json'), path.join(dataDir, 'recipes.json'));
  fs.writeFileSync(path.join(dataDir, 'saved_recipes.json'), '[]');
  return createBridge({ enginePath: realEngine, dataDir, timeoutMs: 20000 });
}

test('real engine: health', { skip: engineSkip }, async () => {
  const res = await realBridge().runEngine('health');
  assert.equal(res.success, true);
});

test('real engine: malformed customize data gives a generic 400-style error, not library text', { skip: engineSkip }, async () => {
  const res = await realBridge().runEngine('customize', { recipe: { ingredients: 'notanarray' }, action: 'healthier' });
  assert.equal(res.success, false);
  assert.equal(res.error.code, 'INVALID_ARGUMENT');
  assert.equal(/json\.exception|type_error/i.test(res.error.message), false);
});

// Saved recipes are rebuilt through RecipeBuilder, so test recipes must be complete ones.
const fullRecipe = (extra = {}) => ({
  name: 'Safe', cuisine: 'Indian', mealType: 'Dinner', dietaryPreference: 'No Preference', cookingTime: 30, difficulty: 'Easy', servings: 2,
  ingredients: [{ name: 'rice', quantity: 1, unit: 'cup' }], instructions: ['Cook the rice.'], source: 'Traditional Database Recipe', ...extra,
});

test('real engine: save validates, assigns safe ids, and never echoes paths', { skip: engineSkip }, async () => {
  const bridge = realBridge();
  const bad = await bridge.runEngine('save', { recipe: { cuisine: 'no name' } });
  assert.equal(bad.success, false);
  assert.equal(bad.error.code, 'INVALID_ARGUMENT');

  const ok = await bridge.runEngine('save', { recipe: fullRecipe({ id: '../../evil' }) });
  assert.equal(ok.success, true);
  assert.match(ok.data.recipe.id, /^saved-[0-9]+-[0-9a-f]{8}$/);

  const listed = await bridge.runEngine('list');
  assert.equal(listed.data.recipes.length, 1);
});

test('real engine: concurrent saves from separate processes lose nothing', { skip: engineSkip }, async () => {
  const bridge = realBridge();
  const N = 12;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => bridge.runEngine('save', { recipe: fullRecipe({ name: `Concurrent ${i}` }) })));
  assert.ok(results.every((r) => r.success), JSON.stringify(results.find((r) => !r.success)));
  const listed = await bridge.runEngine('list');
  assert.equal(listed.data.recipes.length, N);
  assert.equal(new Set(listed.data.recipes.map((r) => r.id)).size, N);
});
