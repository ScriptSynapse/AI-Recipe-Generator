/**
 * Express 4 does not catch a rejected promise from an async handler; the
 * request would hang. This forwards the rejection to the central error
 * handler instead.
 */
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
