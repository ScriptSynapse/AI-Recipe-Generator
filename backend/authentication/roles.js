/**
 * The two roles in the system. Defined here because a user's role is part
 * of their identity (stored on the account, returned by /api/auth/me);
 * what each role is ALLOWED to do is enforced in Phase L's authorization
 * layer, which imports these.
 */
const ROLES = Object.freeze({ USER: 'USER', ADMIN: 'ADMIN' });

function isValidRole(role) {
  return role === ROLES.USER || role === ROLES.ADMIN;
}

module.exports = { ROLES, isValidRole };
