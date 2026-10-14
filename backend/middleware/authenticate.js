/**
 * authenticate / requireAuth
 * ---------------------------------------------------------------------
 * authenticate identifies the caller but NEVER rejects: it sets
 * `req.auth = { user }` for a live session and `req.auth = null`
 * otherwise, so anonymous use of the app (with lower limits, Phase N)
 * keeps working. requireAuth is the gate for endpoints that need a
 * logged-in user. Enforcing WHICH roles may do what is Phase L.
 *
 * If the auth stores themselves fail (e.g. a corrupted sessions file),
 * authenticate logs the problem and treats the caller as ANONYMOUS rather
 * than failing every request. That degrades in the safe direction -- an
 * anonymous caller has strictly fewer privileges -- and keeps
 * non-authenticated features available.
 */
const { errorBody } = require('./errorHandler');
const { loggablePath } = require('../audit/requestContext');

function createAuthenticate({ authService, sessionCookie }) {
  return function authenticate(req, res, next) {
    req.auth = null;
    const found = sessionCookie.extract(req);
    if (!found) return next();

    let user = null;
    try {
      user = authService.validateSession(found.token);
    } catch (err) {
      console.error(`[auth] session validation failed; treating request as anonymous: ${err.name}: ${err.message}`);
      return next();
    }

    if (user) req.auth = { user };
    else if (found.source === 'cookie') sessionCookie.clear(res);   // stale/invalid cookie: tidy it up
    next();
  };
}

function createRequireAuth({ authService }) {
  return function requireAuth(req, res, next) {
    if (req.auth && req.auth.user) return next();
    authService.events.emit('auth.unauthenticated_access', { method: req.method, path: loggablePath(req), ip: req.ip, requestId: req.id });
    return res.status(401).json(errorBody('AUTH_REQUIRED', 'Authentication required.'));
  };
}

module.exports = { createAuthenticate, createRequireAuth };
