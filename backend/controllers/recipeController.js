/**
 * recipeController.js
 * ---------------------------------------------------------------------
 * Thin controller layer: validates the shape of incoming requests just
 * enough to call the C++ core safely, delegates all real business logic
 * to the engine (`runEngine`), and maps the C++ core's response envelope
 * onto HTTP status codes.
 *
 * Built by a factory so the engine is injected: production passes the
 * real cppBridge; tests pass an in-memory fake.
 *
 * Audit (Phase M): the engine adds a `securityEvents` array to its
 * response when something security-relevant happened. EVERY engine call
 * goes through callEngine(), which records those events (with this
 * request's id, user and IP) and removes them, so clients never see them.
 *
 * Authorization (Phase L):
 *  - generate / regenerate / customize / substitute / healthier /
 *    servings stay open to anonymous callers.
 *  - save / list / get / delete require a logged-in user (enforced by
 *    requirePermission in routes/recipes.js BEFORE these handlers run)
 *    and are scoped to that user's own recipes here. The C++ engine knows
 *    nothing about users, so ownership is recorded in each saved record
 *    and checked on every access (authorization/ownership.js).
 *  - A recipe that exists but belongs to someone else is reported with
 *    the exact same 404 as one that does not exist, so ids cannot be
 *    probed to discover other users' recipes.
 */
const { sendEngineError } = require('../middleware/errorHandler');
const { stampOwner, isOwner, toClientRecipe } = require('../authorization/ownership');
const { consumeEngineEvents } = require('../audit/engineEvents');

// Maps a C++-core error `code` to an HTTP status code.
function statusForErrorCode(code) {
  const clientErrorCodes = [
    'EMPTY_INGREDIENTS', 'BLANK_INGREDIENT', 'INVALID_CUISINE', 'INVALID_MEAL_TYPE',
    'INVALID_DIET', 'INVALID_COOKING_TIME', 'INVALID_DIFFICULTY', 'INVALID_SERVINGS',
    'INVALID_ARGUMENT', 'MISSING_COMMAND', 'INVALID_JSON', 'INVALID_REQUEST_SHAPE',
    'PROMPT_INJECTION_SUSPECTED', 'XSS_SUSPECTED', 'INVALID_MODE', 'INVALID_PROVIDER', 'INVALID_RECIPE_SHAPE',
    // RecipeBuilder rejected a recipe sent back by the client (customize)
    'RECIPE_NAME', 'RECIPE_INGREDIENTS', 'RECIPE_INSTRUCTIONS', 'RECIPE_TIME', 'RECIPE_SERVINGS',
    'RECIPE_DIFFICULTY', 'RECIPE_DIET', 'RECIPE_CUISINE', 'RECIPE_MEAL_TYPE', 'RECIPE_PROVIDER',
  ];
  if (code === 'NOT_FOUND') return 404;
  if (clientErrorCodes.includes(code)) return 400;
  return 500; // STORAGE_ERROR, INTERNAL_ERROR, UNKNOWN_COMMAND, etc.
}

// Identical to the engine's own not-found envelope, used both for a
// genuinely missing recipe and for one owned by somebody else.
const NOT_FOUND_BODY = Object.freeze({
  success: false,
  error: Object.freeze({ code: 'NOT_FOUND', message: 'No saved recipe with that id.' }),
});

function createRecipeController({ runEngine }) {
  // The single doorway to the engine: records its security events, strips them.
  async function callEngine(req, command, payload) {
    return consumeEngineEvents(await runEngine(command, payload), req);
  }

  async function forwardToEngine(req, res, command, payload) {
    try {
      const result = await callEngine(req, command, payload);
      if (result.success) {
        return res.status(200).json(result);
      }
      const status = statusForErrorCode(result.error && result.error.code);
      return res.status(status).json(result);
    } catch (err) {
      return sendEngineError(res, err);
    }
  }

  // Looks a saved recipe up and applies the ownership rule. Resolves to
  // { record } for the owner, { notFound: true } for a missing recipe OR
  // someone else's, or { failure } if the engine itself returned an error.
  async function findOwnedRecipe(req, id, user) {
    const result = await callEngine(req, 'get', { id });
    if (!result.success) {
      return result.error && result.error.code === 'NOT_FOUND' ? { notFound: true } : { failure: result };
    }
    const record = result.data && result.data.recipe;
    return isOwner(record, user) ? { record } : { notFound: true };
  }

  return {
    // --- Open to anonymous callers ---------------------------------------
    generateRecipe: (req, res) => forwardToEngine(req, res, 'generate', { preferences: req.body }),

    regenerateRecipe: (req, res) => {
      const { preferences, previousRecipeId, forceAi } = req.body;
      return forwardToEngine(req, res, 'regenerate', { preferences, previousRecipeId, forceAi });
    },

    customizeRecipe: (req, res) => {
      const { recipe, action, argument } = req.body;
      return forwardToEngine(req, res, 'customize', { recipe, action, argument });
    },

    substituteIngredient: (req, res) => {
      const { recipe, ingredient } = req.body;
      return forwardToEngine(req, res, 'customize', { recipe, action: 'substitute', argument: ingredient });
    },

    makeHealthier: (req, res) => {
      const { recipe } = req.body;
      return forwardToEngine(req, res, 'customize', { recipe, action: 'healthier', argument: '' });
    },

    changeServings: (req, res) => {
      const { recipe, servings } = req.body;
      return forwardToEngine(req, res, 'customize', { recipe, action: 'servings', argument: String(servings) });
    },

    // --- Logged-in users, own recipes only --------------------------------
    saveRecipe: async (req, res) => {
      try {
        // The owner is the authenticated user, never anything the client sent.
        const result = await callEngine(req, 'save', { recipe: stampOwner(req.body.recipe, req.auth.user) });
        if (!result.success) {
          return res.status(statusForErrorCode(result.error && result.error.code)).json(result);
        }
        return res.status(200).json({
          ...result, data: { ...result.data, recipe: toClientRecipe(result.data.recipe) },
        });
      } catch (err) {
        return sendEngineError(res, err);
      }
    },

    listSavedRecipes: async (req, res) => {
      try {
        const result = await callEngine(req, 'list', {});
        if (!result.success) {
          return res.status(statusForErrorCode(result.error && result.error.code)).json(result);
        }
        const mine = (result.data.recipes || []).filter((r) => isOwner(r, req.auth.user)).map(toClientRecipe);
        return res.status(200).json({ ...result, data: { ...result.data, recipes: mine } });
      } catch (err) {
        return sendEngineError(res, err);
      }
    },

    getSavedRecipe: async (req, res) => {
      try {
        const found = await findOwnedRecipe(req, req.params.id, req.auth.user);
        if (found.failure) return res.status(statusForErrorCode(found.failure.error && found.failure.error.code)).json(found.failure);
        if (found.notFound) return res.status(404).json(NOT_FOUND_BODY);
        return res.status(200).json({ success: true, data: { recipe: toClientRecipe(found.record) }, message: 'Recipe retrieved.' });
      } catch (err) {
        return sendEngineError(res, err);
      }
    },

    deleteSavedRecipe: async (req, res) => {
      try {
        const found = await findOwnedRecipe(req, req.params.id, req.auth.user);
        if (found.failure) return res.status(statusForErrorCode(found.failure.error && found.failure.error.code)).json(found.failure);
        if (found.notFound) return res.status(404).json(NOT_FOUND_BODY);
        // Ownership never changes after a recipe is saved, so nothing can
        // invalidate the check above between here and the delete.
        return forwardToEngine(req, res, 'delete', { id: req.params.id });
      } catch (err) {
        return sendEngineError(res, err);
      }
    },

    // --- Health ------------------------------------------------------------
    // Public: only whether the pipeline answers. It deliberately omits
    // which AI providers are configured, the model name and the database
    // size -- that is reconnaissance information.
    healthCheck: async (req, res) => {
      try {
        const result = await callEngine(req, 'health', {});
        if (!result.success) return res.status(statusForErrorCode(result.error && result.error.code)).json(result);
        return res.status(200).json({ success: true, data: { status: result.data && result.data.status }, message: result.message });
      } catch (err) {
        return sendEngineError(res, err);
      }
    },

    // Admin only (routes/admin.js): the full engine health report.
    adminHealthCheck: async (req, res) => {
      try {
        const result = await callEngine(req, 'health', {});
        return res.status(200).json(result);
      } catch (err) {
        return sendEngineError(res, err);
      }
    },
  };
}

module.exports = { createRecipeController, statusForErrorCode, NOT_FOUND_BODY };
