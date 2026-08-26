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

function validateGeneratePayload(req, res, next) {
  const body = req.body || {};
  if (!Array.isArray(body.ingredients)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST_SHAPE', message: '"ingredients" must be an array of strings.' },
    });
  }
  if (body.servings !== undefined && typeof body.servings !== 'number') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST_SHAPE', message: '"servings" must be a number.' },
    });
  }
  if (body.cookingTime !== undefined && typeof body.cookingTime !== 'number') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST_SHAPE', message: '"cookingTime" must be a number.' },
    });
  }
  next();
}

function validateCustomizePayload(req, res, next) {
  const body = req.body || {};
  if (!body.recipe || typeof body.recipe !== 'object') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST_SHAPE', message: '"recipe" object is required.' },
    });
  }
  next();
}

module.exports = { validateGeneratePayload, validateCustomizePayload };
