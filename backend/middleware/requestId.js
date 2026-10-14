/**
 * Gives every request a unique id, exposed as `req.id` and the
 * `X-Request-Id` response header, so an event in the audit log can be tied
 * back to one request.
 *
 * The id is ALWAYS generated here. An id supplied by the client is never
 * trusted or echoed: it would let a caller forge identifiers in the log or
 * inject text into it.
 */
const crypto = require('crypto');

module.exports = function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
