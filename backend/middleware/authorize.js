/**
 * requirePermission(permission) -- the route-level gate for RBAC.
 *
 *   not logged in                         -> 401 AUTH_REQUIRED
 *   logged in, role lacks the permission  -> 403 FORBIDDEN
 *   allowed                               -> next()
 *
 * Both denials emit an event (Observer pattern) for Phase M's audit log.
 * An unknown permission name throws when the route is DEFINED, so a typo
 * fails at startup rather than silently denying (or admitting) requests.
 *
 * This runs on the server for every request; nothing the browser sends
 * (including any role it claims) is consulted.
 */
const { isKnownPermission } = require('../authorization/permissions');
const { errorBody } = require('./errorHandler');
const { loggablePath } = require('../audit/requestContext');

function createRequirePermission({ authorizationService, events }) {
  return function requirePermission(permission) {
    if (!isKnownPermission(permission)) {
      throw new RangeError(`requirePermission called with an unknown permission: ${String(permission)}`);
    }

    return function permissionGate(req, res, next) {
      const user = req.auth && req.auth.user;

      if (!user) {
        events.emit('auth.unauthenticated_access', { method: req.method, path: loggablePath(req), ip: req.ip, requestId: req.id });
        return res.status(401).json(errorBody('AUTH_REQUIRED', 'Authentication required.'));
      }

      if (!authorizationService.can(user, permission)) {
        events.emit('authz.denied', {
          userId: user.id, role: user.role, permission, method: req.method, path: loggablePath(req), ip: req.ip, requestId: req.id,
        });
        return res.status(403).json(errorBody('FORBIDDEN', 'You do not have permission to perform this action.'));
      }

      return next();
    };
  };
}

module.exports = { createRequirePermission };
