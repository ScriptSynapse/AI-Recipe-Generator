/**
 * errorHandler.js
 * ---------------------------------------------------------------------
 * Central, client-safe error responses. Nothing here ever sends stack
 * traces, filesystem paths, raw engine output or upstream error bodies to
 * the client -- that detail is logged server-side (redacted) instead.
 * Kept free of Express imports so it can be unit-tested with fake req/res.
 */

const { redact } = require('../services/cppBridge');
const { emitHttpEvent } = require('../audit/requestContext');

function errorBody(code, message) {
  return { success: false, error: { code, message } };
}

/** 404 for unknown /api routes. Does not echo the requested URL. */
function notFoundHandler(req, res) {
  res.status(404).json(errorBody('NOT_FOUND', 'API route not found.'));
}

/** Maps an EngineError (from cppBridge) to an HTTP response. */
function sendEngineError(res, err) {
  const code = (err && err.code) || 'ENGINE_UNAVAILABLE';
  const status = code === 'ENGINE_TIMEOUT' ? 504 : 503;
  if (err && err.detail) console.error(`[engine] ${code}: ${redact(err.detail)}`);
  const message = (err && err.publicMessage) || 'The recipe engine is not available.';
  return res.status(status).json(errorBody(code, message));
}

/** Express error middleware (4 args). Must be registered last. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // body-parser errors carry a machine-readable `type`.
  if (err && err.type === 'entity.parse.failed') {
    emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_JSON', status: 400 });
    return res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON.'));
  }
  if (err && err.type === 'entity.too.large') {
    emitHttpEvent(req, 'http.invalid_input', { code: 'PAYLOAD_TOO_LARGE', status: 413 });
    return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body is too large.'));
  }

  console.error(`[server] Unhandled error: ${redact((err && (err.stack || err.message)) || err, 2000)}`);
  return res.status(500).json(errorBody('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
}

module.exports = { notFoundHandler, errorHandler, sendEngineError, errorBody };
