/**
 * AuthorizationService -- answers "may this user do this?".
 *
 * Deny by default: a missing user, a missing/unknown role, or a role with
 * no entry in the matrix is simply "no". The one thing that THROWS is
 * asking about a permission that doesn't exist -- that is a programming
 * error (a typo would otherwise silently lock everyone out, or worse,
 * be mistaken for "nobody has it"), so it is surfaced loudly.
 */
const { ROLE_PERMISSIONS, isKnownPermission } = require('./permissions');

class AuthorizationService {
  /** @param {{role?: string}|null|undefined} user the authenticated user (req.auth.user), if any */
  can(user, permission) {
    if (!isKnownPermission(permission)) {
      throw new RangeError('Unknown permission.');
    }
    if (!user || typeof user.role !== 'string') return false;
    // hasOwnProperty: a role of "__proto__" or "constructor" must not
    // resolve to something inherited from Object.prototype.
    if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, user.role)) return false;
    return ROLE_PERMISSIONS[user.role].includes(permission);
  }

  permissionsFor(role) {
    if (typeof role !== 'string' || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return [];
    return [...ROLE_PERMISSIONS[role]];
  }
}

module.exports = { AuthorizationService };
