/**
 * What the audit log needs to know about the request an event belongs to.
 * Kept in one place so every producer (auth, authorization, validation,
 * engine events) describes a request the same way.
 */

/** The request path without its query string (which can carry secrets), length-bounded. */
function loggablePath(req) {
  return String(req.originalUrl || req.url || '').split('?')[0].slice(0, 200);
}

function requestContext(req) {
  return {
    requestId: req.id,
    ip: req.ip,
    method: req.method,
    path: loggablePath(req),
    userId: req.auth && req.auth.user ? req.auth.user.id : null,
  };
}

/** Publishes an event on the app's shared event bus, if there is one. Never throws. */
function emitHttpEvent(req, name, payload = {}) {
  const bus = req && req.app && req.app.locals && req.app.locals.events;
  if (!bus) return;
  bus.emit(name, { ...requestContext(req), ...payload });
}

module.exports = { loggablePath, requestContext, emitHttpEvent };
