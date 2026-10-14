/**
 * The RBAC permission matrix: the single place that says what each role
 * may do. Routes never test for a role directly; they ask for a
 * permission (middleware/authorize.js), so adding a role or moving a
 * capability is a change to this file only.
 *
 * Least privilege, deliberately:
 *  - ADMIN gets every USER permission plus the admin capabilities, but
 *    NO permission to read or delete other people's recipes. The
 *    "*_OWN" permissions mean "recipes you own"; ownership itself is
 *    checked per record in ownership.js, and a role cannot override it.
 *  - Anyone not logged in has no role and therefore no permissions.
 *    Recipe generation and customization are not gated here: they are
 *    open to anonymous callers (who get tighter rate limits in Phase N).
 *
 * The admin permissions below are the capabilities listed in the project
 * spec. Only SYSTEM_HEALTH_READ has an endpoint so far; the audit log,
 * blocked-request log, security dashboard, provider status and model
 * analytics endpoints arrive in later phases and attach to the
 * permissions defined here.
 */
const { ROLES } = require('../authentication/roles');

const PERMISSIONS = Object.freeze({
  RECIPE_SAVE: 'recipe:save',
  RECIPE_READ_OWN: 'recipe:read:own',
  RECIPE_DELETE_OWN: 'recipe:delete:own',
  AI_LAB_USE: 'ai-lab:use',                 // run model comparisons (calls every configured provider, so it costs money)

  SYSTEM_HEALTH_READ: 'admin:system-health:read',
  PROVIDER_STATUS_READ: 'admin:provider-status:read',
  SECURITY_DASHBOARD_READ: 'admin:security-dashboard:read',
  AUDIT_LOG_READ: 'admin:audit-log:read',
  BLOCKED_REQUEST_LOG_READ: 'admin:blocked-requests:read',
  MODEL_ANALYTICS_READ: 'admin:model-analytics:read',
  BENCHMARK_RUN: 'admin:benchmark:run',
});

const USER_PERMISSIONS = Object.freeze([
  PERMISSIONS.RECIPE_SAVE,
  PERMISSIONS.RECIPE_READ_OWN,
  PERMISSIONS.RECIPE_DELETE_OWN,
  PERMISSIONS.AI_LAB_USE,
]);

const ADMIN_ONLY_PERMISSIONS = Object.freeze([
  PERMISSIONS.SYSTEM_HEALTH_READ,
  PERMISSIONS.PROVIDER_STATUS_READ,
  PERMISSIONS.SECURITY_DASHBOARD_READ,
  PERMISSIONS.AUDIT_LOG_READ,
  PERMISSIONS.BLOCKED_REQUEST_LOG_READ,
  PERMISSIONS.MODEL_ANALYTICS_READ,
  PERMISSIONS.BENCHMARK_RUN,
]);

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.USER]: USER_PERMISSIONS,
  [ROLES.ADMIN]: Object.freeze([...USER_PERMISSIONS, ...ADMIN_ONLY_PERMISSIONS]),
});

const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

function isKnownPermission(permission) {
  return typeof permission === 'string' && ALL_PERMISSIONS.includes(permission);
}

module.exports = {
  PERMISSIONS, ROLE_PERMISSIONS, USER_PERMISSIONS, ADMIN_ONLY_PERMISSIONS, ALL_PERMISSIONS, isKnownPermission,
};
