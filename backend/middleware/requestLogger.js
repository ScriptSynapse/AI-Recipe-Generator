/**
 * One structured (JSON) access-log line per API request, written when the
 * response finishes: method, path WITHOUT query string (queries can carry
 * secrets), status, duration, request id, user id. Never bodies, headers
 * or cookies. Output goes through an injectable sink so tests can capture it.
 */
const { loggablePath } = require('../audit/requestContext');

function createRequestLogger({ sink = (line) => console.log(line), now = () => Date.now() } = {}) {
  return function requestLogger(req, res, next) {
    const start = now();
    res.on('finish', () => {
      try {
        sink(JSON.stringify({
          t: new Date(start).toISOString(), level: 'info', msg: 'request',
          requestId: req.id, method: req.method, path: loggablePath(req), status: res.statusCode,
          ms: now() - start, userId: req.auth && req.auth.user ? req.auth.user.id : null,
        }));
      } catch { /* logging must never break a response */ }
    });
    next();
  };
}

module.exports = { createRequestLogger };
