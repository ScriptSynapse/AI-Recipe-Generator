/**
 * validateRequest.js
 * ---------------------------------------------------------------------
 * Lightweight API-layer validation. This intentionally duplicates a
 * *subset* of the checks the C++ Validator class performs (shape/type
 * only) so obviously malformed requests never reach the process-spawn
 * boundary. The C++ core remains the single source of truth for the
 * full business-rule validation (ranges, allowed enums, etc.) per the
 * spec: "The API should also validate requests before passing them
 * into the C++ core."
 */

const { emitHttpEvent } = require('../audit/requestContext');

// One place that both reports a malformed request to the audit trail and answers it.
function reject(req, res, message) {
  emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_REQUEST_SHAPE', status: 400 });
  return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST_SHAPE', message } });
}

function validateGeneratePayload(req, res, next) {
  const body = req.body || {};
  if (!Array.isArray(body.ingredients)) {
    return reject(req, res, '"ingredients" must be an array of strings.');
  }
  if (body.servings !== undefined && typeof body.servings !== 'number') {
    return reject(req, res, '"servings" must be a number.');
  }
  if (body.cookingTime !== undefined && typeof body.cookingTime !== 'number') {
    return reject(req, res, '"cookingTime" must be a number.');
  }
  next();
}

function validateCustomizePayload(req, res, next) {
  const body = req.body || {};
  if (!body.recipe || typeof body.recipe !== 'object') {
    return reject(req, res, '"recipe" object is required.');
  }
  next();
}

function validateRegeneratePayload(req, res, next) {
  const body = req.body || {};
  if (!body.preferences || typeof body.preferences !== 'object' || Array.isArray(body.preferences)
      || !Array.isArray(body.preferences.ingredients)) {
    return reject(req, res, '"preferences" object with an "ingredients" array is required.');
  }
  if (body.previousRecipeId !== undefined && typeof body.previousRecipeId !== 'string') {
    return reject(req, res, '"previousRecipeId" must be a string.');
  }
  next();
}

module.exports = { validateGeneratePayload, validateCustomizePayload, validateRegeneratePayload };
