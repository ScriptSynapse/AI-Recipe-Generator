// Route-table checks for the AI Lab (no Express needed): who may call what, and in what order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWithFakeExpress, tag, describeRoutes } = require('../helpers/fakeExpress');
const { PERMISSIONS, ROLE_PERMISSIONS, USER_PERMISSIONS, ADMIN_ONLY_PERMISSIONS } = require('../../backend/authorization/permissions');
const { AuthorizationService } = require('../../backend/authorization/authorizationService');

const [{ createAiRouter }, { createAdminRouter }] = loadWithFakeExpress(['routes/ai.js', 'routes/admin.js']);
const requirePermission = (p) => tag('perm', p);
const noop = () => {};
const controller = new Proxy({}, { get: () => noop });

test('LW-01 /api/ai routes: permission gate FIRST, then the Lab rate limit, then the handler', () => {
  const router = createAiRouter({ controller, requirePermission, compareLimit: tag('limit', 'compare'), recordCompared: tag('usage', 'compare') });
  const table = describeRoutes(router);
  assert.deepEqual(table, [
    ['GET /models', [`perm:${PERMISSIONS.AI_LAB_USE}`, 'handler']],
    ['POST /compare', [`perm:${PERMISSIONS.AI_LAB_USE}`, 'limit:compare', 'usage:compare', 'handler']],
  ]);
});

test('LW-02 admin Lab routes each need their own admin permission; benchmark is rate limited after the gate', () => {
  const router = createAdminRouter({ controller, auditController: controller, aiController: controller, requirePermission, benchmarkLimit: tag('limit', 'benchmark') });
  const table = Object.fromEntries(describeRoutes(router));
  assert.deepEqual(table['GET /providers'], [`perm:${PERMISSIONS.PROVIDER_STATUS_READ}`, 'handler']);
  assert.deepEqual(table['GET /model-analytics'], [`perm:${PERMISSIONS.MODEL_ANALYTICS_READ}`, 'handler']);
  assert.deepEqual(table['POST /benchmark'], [`perm:${PERMISSIONS.BENCHMARK_RUN}`, 'limit:benchmark', 'handler']);
});

test('LW-03 EVERY route on both routers is behind a permission gate', () => {
  const ai = createAiRouter({ controller, requirePermission });
  const admin = createAdminRouter({ controller, auditController: controller, aiController: controller, requirePermission });
  for (const [name, chain] of [...describeRoutes(ai), ...describeRoutes(admin)]) {
    assert.ok(chain[0].startsWith('perm:'), `${name} has no permission gate first`);
  }
});

test('LW-04 RBAC: users may use the Lab; only admins may benchmark, read analytics or provider status', () => {
  const authz = new AuthorizationService();
  const user = { role: 'USER' }; const admin = { role: 'ADMIN' };
  assert.equal(authz.can(user, PERMISSIONS.AI_LAB_USE), true);
  for (const p of [PERMISSIONS.BENCHMARK_RUN, PERMISSIONS.MODEL_ANALYTICS_READ, PERMISSIONS.PROVIDER_STATUS_READ]) {
    assert.equal(authz.can(user, p), false, p);
    assert.equal(authz.can(admin, p), true, p);
  }
  assert.equal(authz.can(null, PERMISSIONS.AI_LAB_USE), false, 'anonymous has no Lab access');
  assert.ok(USER_PERMISSIONS.includes(PERMISSIONS.AI_LAB_USE) && !ADMIN_ONLY_PERMISSIONS.includes(PERMISSIONS.AI_LAB_USE));
  assert.ok(ROLE_PERMISSIONS.ADMIN.includes(PERMISSIONS.AI_LAB_USE));
});

test('LW-05 loading routes with the fake express does not leak into the module cache', () => {
  const key = require.resolve('../../backend/routes/ai.js');
  assert.equal(key in require.cache, false);
});
