/**
 * recipeController.js
 * ---------------------------------------------------------------------
 * Thin controller layer: validates the shape of incoming requests just
 * enough to call the C++ core safely, delegates all real business logic
 * to cppBridge.runEngine(), and maps the C++ core's response envelope
 * onto HTTP status codes.
 */

const { runEngine } = require('../services/cppBridge');

// Maps a C++-core error `code` to an HTTP status code.
function statusForErrorCode(code) {
  const clientErrorCodes = [
    'EMPTY_INGREDIENTS', 'BLANK_INGREDIENT', 'INVALID_CUISINE', 'INVALID_MEAL_TYPE',
    'INVALID_DIET', 'INVALID_COOKING_TIME', 'INVALID_DIFFICULTY', 'INVALID_SERVINGS',
    'INVALID_ARGUMENT', 'MISSING_COMMAND', 'INVALID_JSON'
  ];
  if (code === 'NOT_FOUND') return 404;
  if (clientErrorCodes.includes(code)) return 400;
  return 500; // STORAGE_ERROR, INTERNAL_ERROR, UNKNOWN_COMMAND, etc.
}

async function forwardToEngine(res, command, payload) {
  try {
    const result = await runEngine(command, payload);
    if (result.success) {
      return res.status(200).json(result);
    }
    const status = statusForErrorCode(result.error && result.error.code);
    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'ENGINE_UNAVAILABLE', message: err.message },
    });
  }
}

exports.generateRecipe = (req, res) => {
  return forwardToEngine(res, 'generate', { preferences: req.body });
};

exports.regenerateRecipe = (req, res) => {
  const { preferences, previousRecipeId, forceAi } = req.body;
  return forwardToEngine(res, 'regenerate', { preferences, previousRecipeId, forceAi });
};

exports.customizeRecipe = (req, res) => {
  const { recipe, action, argument } = req.body;
  return forwardToEngine(res, 'customize', { recipe, action, argument });
};

exports.substituteIngredient = (req, res) => {
  const { recipe, ingredient } = req.body;
  return forwardToEngine(res, 'customize', { recipe, action: 'substitute', argument: ingredient });
};

exports.makeHealthier = (req, res) => {
  const { recipe } = req.body;
  return forwardToEngine(res, 'customize', { recipe, action: 'healthier', argument: '' });
};

exports.changeServings = (req, res) => {
  const { recipe, servings } = req.body;
  return forwardToEngine(res, 'customize', { recipe, action: 'servings', argument: String(servings) });
};

exports.saveRecipe = (req, res) => {
  return forwardToEngine(res, 'save', { recipe: req.body.recipe });
};

exports.listSavedRecipes = (req, res) => {
  return forwardToEngine(res, 'list', {});
};

exports.getSavedRecipe = (req, res) => {
  return forwardToEngine(res, 'get', { id: req.params.id });
};

exports.deleteSavedRecipe = (req, res) => {
  return forwardToEngine(res, 'delete', { id: req.params.id });
};

exports.healthCheck = async (req, res) => {
  try {
    const result = await runEngine('health', {});
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'ENGINE_UNAVAILABLE', message: err.message },
    });
  }
};
