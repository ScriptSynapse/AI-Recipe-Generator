/**
 * HTTP handlers for /api/auth/*. Thin: validate the request shape, call
 * AuthService, translate the outcome into a response and (un)set the
 * session cookie. All rules live in AuthService.
 */
const { AuthError } = require('../authentication/authService');
const { errorBody } = require('../middleware/errorHandler');
const asyncHandler = require('../middleware/asyncHandler');
const { emitHttpEvent } = require('../audit/requestContext');

function isJsonRequest(req) {
  return /^application\/json(\s*;|$)/i.test((req.headers && req.headers['content-type']) || '');
}

function createAuthController({ authService, sessionCookie, loginThrottle = null, auditGate = null }) {
  // Common guard for the two credential endpoints. Returns the parsed
  // {username, password} or sends an error response and returns null.
  function readCredentials(req, res) {
    if (!isJsonRequest(req)) {
      emitHttpEvent(req, 'http.invalid_input', { code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 });
      res.status(415).json(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
      return null;
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof body.username !== 'string' || typeof body.password !== 'string') {
      emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_REQUEST_SHAPE', status: 400 });
      res.status(400).json(errorBody('INVALID_REQUEST_SHAPE', '"username" and "password" must be provided as text.'));
      return null;
    }
    // Only these two fields are ever read: anything else in the body
    // (e.g. a "role") is ignored, so there is no mass-assignment path.
    return { username: body.username, password: body.password };
  }

  function sendAuthError(res, err) {
    return res.status(err.status).json(errorBody(err.code, err.message));
  }

  function startSession(res, result, status) {
    sessionCookie.set(res, result.token, result.ttlMs);
    return res.status(status).json({ success: true, data: { user: result.user } });
  }

  return {
    register: asyncHandler(async (req, res) => {
      const credentials = readCredentials(req, res);
      if (!credentials) return undefined;
      try {
        const result = await authService.register(credentials.username, credentials.password, { ip: req.ip, requestId: req.id });
        return startSession(res, result, 201);
      } catch (err) {
        if (err instanceof AuthError) return sendAuthError(res, err);
        throw err;
      }
    }),

    login: asyncHandler(async (req, res) => {
      const credentials = readCredentials(req, res);
      if (!credentials) return undefined;
      if (loginThrottle) {
        const gate = loginThrottle.check(req.ip, credentials.username);
        if (gate.blocked) {
          // Refused BEFORE any password check: costs no scrypt work and gives no oracle.
          const admit = auditGate ? auditGate.admit(`login:${req.ip}`) : { suppressed: 0 };
          if (admit) emitHttpEvent(req, 'ratelimit.exceeded', { className: 'login', tier: 'anonymous', retryAfterSec: gate.retryAfterSec, suppressed: admit.suppressed });
          res.setHeader('Retry-After', String(gate.retryAfterSec));
          const body = errorBody('TOO_MANY_LOGIN_ATTEMPTS', `Too many failed sign-in attempts. Please try again in ${Math.ceil(gate.retryAfterSec / 60)} minute(s).`);
          body.error.retryAfterSec = gate.retryAfterSec;
          return res.status(429).json(body);
        }
      }
      try {
        const result = await authService.login(credentials.username, credentials.password, { ip: req.ip, requestId: req.id });
        if (loginThrottle) loginThrottle.recordSuccess(req.ip, credentials.username);
        return startSession(res, result, 200);
      } catch (err) {
        if (err instanceof AuthError) {
          if (loginThrottle && err.code === 'INVALID_CREDENTIALS') loginThrottle.recordFailure(req.ip, credentials.username);
          return sendAuthError(res, err);
        }
        throw err;
      }
    }),

    logout: asyncHandler(async (req, res) => {
      const found = sessionCookie.extract(req);
      if (found) authService.logout(found.token, { ip: req.ip, requestId: req.id });
      sessionCookie.clear(res);                       // idempotent: fine with no session
      return res.status(200).json({ success: true, message: 'Logged out.' });
    }),

    // Signed-in user changes their own password. Needs the CURRENT password;
    // ends every other session and replaces this browser's cookie.
    changePassword: asyncHandler(async (req, res) => {
      if (!isJsonRequest(req)) {
        emitHttpEvent(req, 'http.invalid_input', { code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 });
        return res.status(415).json(errorBody('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
      }
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)
          || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
        emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_REQUEST_SHAPE', status: 400 });
        return res.status(400).json(errorBody('INVALID_REQUEST_SHAPE', '"currentPassword" and "newPassword" must be provided as text.'));
      }
      const { user } = req.auth;
      // Guessing the current password through this endpoint is throttled like a login.
      if (loginThrottle) {
        const gate = loginThrottle.check(req.ip, user.username);
        if (gate.blocked) {
          res.setHeader('Retry-After', String(gate.retryAfterSec));
          const out = errorBody('TOO_MANY_LOGIN_ATTEMPTS', `Too many failed attempts. Please try again in ${Math.ceil(gate.retryAfterSec / 60)} minute(s).`);
          out.error.retryAfterSec = gate.retryAfterSec;
          return res.status(429).json(out);
        }
      }
      try {
        const result = await authService.changePassword(user.id, body.currentPassword, body.newPassword, { ip: req.ip, requestId: req.id });
        if (loginThrottle) loginThrottle.recordSuccess(req.ip, user.username);
        sessionCookie.set(res, result.token, result.ttlMs);
        return res.status(200).json({ success: true, message: 'Password changed. Other devices have been signed out.' });
      } catch (err) {
        if (err instanceof AuthError) {
          if (loginThrottle && err.code === 'INVALID_CREDENTIALS') loginThrottle.recordFailure(req.ip, user.username);
          return sendAuthError(res, err);
        }
        throw err;
      }
    }),

    me: (req, res) => res.status(200).json({ success: true, data: { user: req.auth.user } }),
  };
}

module.exports = { createAuthController };
