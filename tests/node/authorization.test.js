const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMISSIONS, ROLE_PERMISSIONS, USER_PERMISSIONS, ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, isKnownPermission,
} = require('../../backend/authorization/permissions');
const { AuthorizationService } = require('../../backend/authorization/authorizationService');
const { stampOwner, isOwner, toClientRecipe } = require('../../backend/authorization/ownership');
const { createRequirePermission } = require('../../backend/middleware/authorize');
const { ROLES } = require('../../backend/authentication/roles');

const authz = new AuthorizationService();
const user = { id: 'u-1', username: 'alice_01', role: ROLES.USER };
const admin = { id: 'a-1', username: 'ops_admin', role: ROLES.ADMIN };

// ---- the permission matrix ---------------------------------------------------

test('matrix: USER has exactly the recipe permissions plus the AI Lab, and none of the admin ones', () => {
  assert.deepEqual([...ROLE_PERMISSIONS[ROLES.USER]].sort(),
    [PERMISSIONS.RECIPE_SAVE, PERMISSIONS.RECIPE_READ_OWN, PERMISSIONS.RECIPE_DELETE_OWN, PERMISSIONS.AI_LAB_USE].sort());
  for (const p of ADMIN_ONLY_PERMISSIONS) assert.equal(authz.can(user, p), false, `USER must not have ${p}`);
});

test('matrix: ADMIN has every permission (all USER ones plus the admin capabilities)', () => {
  for (const p of ALL_PERMISSIONS) assert.equal(authz.can(admin, p), true, `ADMIN should have ${p}`);
  assert.equal(ADMIN_ONLY_PERMISSIONS.length, 7, 'the six admin capabilities from the spec, plus running benchmarks');
});

test('matrix: every defined permission is granted to at least one role (no dead permissions)', () => {
  for (const p of ALL_PERMISSIONS) {
    assert.ok(Object.values(ROLE_PERMISSIONS).some((granted) => granted.includes(p)), `${p} is granted to no role`);
  }
});

test('least privilege: no role holds a permission to read or delete OTHER users\' recipes', () => {
  for (const p of ALL_PERMISSIONS) {
    assert.equal(/any|other|all/i.test(p), false, `${p} looks like a cross-user permission`);
  }
  assert.equal(authz.can(admin, PERMISSIONS.RECIPE_READ_OWN), true);   // "own" still means own, even for admins
});

test('the matrix cannot be modified at runtime', () => {
  assert.ok(Object.isFrozen(PERMISSIONS));
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS));
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS[ROLES.USER]));
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS[ROLES.ADMIN]));
  assert.ok(Object.isFrozen(USER_PERMISSIONS) && Object.isFrozen(ADMIN_ONLY_PERMISSIONS));
});

// ---- AuthorizationService ------------------------------------------------------

test('can(): deny by default for missing users, missing roles and unknown roles', () => {
  const p = PERMISSIONS.RECIPE_SAVE;
  for (const bad of [null, undefined, {}, { role: undefined }, { role: 42 }, { role: 'SUPERUSER' }, { role: '' }, { role: 'user' }]) {
    assert.equal(authz.can(bad, p), false, JSON.stringify(bad));
  }
});

test('can(): a role named after an Object.prototype member never resolves to anything', () => {
  for (const role of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(authz.can({ role }, PERMISSIONS.RECIPE_SAVE), false, role);
    assert.deepEqual(authz.permissionsFor(role), []);
  }
});

test('can(): asking about a permission that does not exist is a loud programming error, not a quiet "no"', () => {
  for (const bad of ['recipe:sav', '', undefined, null, 42, {}, 'admin:everything']) {
    assert.throws(() => authz.can(admin, bad), RangeError, String(bad));
  }
  assert.equal(isKnownPermission('recipe:save'), true);
  assert.equal(isKnownPermission('toString'), false);
});

test('permissionsFor() returns a copy: callers cannot alter the matrix through it', () => {
  const copy = authz.permissionsFor(ROLES.USER);
  copy.push(PERMISSIONS.AUDIT_LOG_READ);
  assert.equal(authz.can(user, PERMISSIONS.AUDIT_LOG_READ), false);
  assert.deepEqual(authz.permissionsFor('nope'), []);
});

// ---- ownership -------------------------------------------------------------------

test('stampOwner: the owner is always the session user, overriding any client-supplied ownerId', () => {
  const stamped = stampOwner({ name: 'Dal', ownerId: 'someone-else', id: 'x' }, user);
  assert.equal(stamped.ownerId, 'u-1');
  assert.equal(stamped.name, 'Dal');
});

test('stampOwner: does not mutate its input, and passes non-objects through for the engine to reject', () => {
  const input = { name: 'Dal' };
  stampOwner(input, user);
  assert.deepEqual(input, { name: 'Dal' });
  for (const odd of ['text', 42, null, undefined, ['a'], true]) assert.equal(stampOwner(odd, user), odd);
});

test('isOwner: true only for a matching string ownerId', () => {
  assert.equal(isOwner({ ownerId: 'u-1' }, user), true);
  assert.equal(isOwner({ ownerId: 'u-2' }, user), false);
  assert.equal(isOwner({ name: 'legacy record, no owner' }, user), false);
  assert.equal(isOwner({ ownerId: 'u-1' }, null), false);
  assert.equal(isOwner({ ownerId: 'u-1' }, {}), false);
  assert.equal(isOwner(null, user), false);
  assert.equal(isOwner(undefined, user), false);
  assert.equal(isOwner('u-1', user), false);
  // type confusion must not produce a match
  assert.equal(isOwner({ ownerId: 1 }, { id: 1 }), false);
  assert.equal(isOwner({ ownerId: ['u-1'] }, { id: 'u-1' }), false);
  assert.equal(isOwner({ ownerId: { toString: () => 'u-1' } }, { id: 'u-1' }), false);
  assert.equal(isOwner({ ownerId: undefined }, { id: undefined }), false);
});

test('toClientRecipe: strips the internal ownerId without mutating the record', () => {
  const record = { id: 'r1', name: 'Dal', ownerId: 'u-1' };
  assert.deepEqual(toClientRecipe(record), { id: 'r1', name: 'Dal' });
  assert.equal(record.ownerId, 'u-1');
  assert.equal(toClientRecipe(null), null);
  assert.equal(toClientRecipe('x'), 'x');
});

// ---- requirePermission middleware (fake req/res) ----------------------------------

function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
function gateSetup() {
  const events = []; 
  const emitter = { emit: (name, payload) => events.push({ name, payload }) };
  const requirePermission = createRequirePermission({ authorizationService: authz, events: emitter });
  return { events, requirePermission };
}

test('requirePermission: anonymous -> 401 AUTH_REQUIRED and an event; handler never runs', () => {
  const { events, requirePermission } = gateSetup();
  const res = fakeRes(); let nextCalled = false;
  requirePermission(PERMISSIONS.RECIPE_SAVE)({ auth: null, method: 'POST', originalUrl: '/api/recipes/save', ip: '1.2.3.4' }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  assert.equal(nextCalled, false);
  assert.equal(events[0].name, 'auth.unauthenticated_access');
});

test('requirePermission: logged in without the permission -> 403 FORBIDDEN and an audit event', () => {
  const { events, requirePermission } = gateSetup();
  const res = fakeRes(); let nextCalled = false;
  requirePermission(PERMISSIONS.AUDIT_LOG_READ)(
    { id: 'req-7', auth: { user }, method: 'GET', originalUrl: '/api/admin/audit?secret=1', ip: '1.2.3.4' }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body.error, { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
  assert.equal(nextCalled, false);
  assert.deepEqual(events[0], { name: 'authz.denied', payload: {
    userId: 'u-1', role: 'USER', permission: PERMISSIONS.AUDIT_LOG_READ, method: 'GET', path: '/api/admin/audit', ip: '1.2.3.4',
    requestId: 'req-7',
  } });
  assert.equal(JSON.stringify(events).includes('secret=1'), false, 'the query string is never logged');
});

test('requirePermission: allowed -> next() with no response and no event', () => {
  const { events, requirePermission } = gateSetup();
  const res = fakeRes(); let nextCalled = false;
  requirePermission(PERMISSIONS.RECIPE_SAVE)({ auth: { user }, method: 'POST', originalUrl: '/x' }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(events.length, 0);
});

test('requirePermission: a typo in the permission name fails when the route is DEFINED', () => {
  const { requirePermission } = gateSetup();
  assert.throws(() => requirePermission('recipe:sav'), RangeError);
  assert.throws(() => requirePermission(undefined), RangeError);
});

test('requirePermission: very long paths are truncated in the event (bounded log size)', () => {
  const { events, requirePermission } = gateSetup();
  requirePermission(PERMISSIONS.AUDIT_LOG_READ)({ auth: { user }, method: 'GET', originalUrl: '/' + 'a'.repeat(5000) }, fakeRes(), () => {});
  assert.ok(events[0].payload.path.length <= 200);
});
