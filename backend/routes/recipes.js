const express = require('express');

const { PERMISSIONS } = require('../authorization/permissions');
const { validateGeneratePayload, validateCustomizePayload, validateRegeneratePayload } = require('../controllers/validateRequest');

/**
 * /api/recipes router (a factory, so each app gets its own controller).
 *
 * Open to anonymous callers (at a lower rate limit): generation and customization.
 * Requires a login AND the matching permission: everything that touches
 * saved recipes. (Which records a user may see is decided per record in
 * the controller; the permission only says they may use the feature.)
 */
function createRecipeRouter({ controller, requirePermission, generateLimit = (req, res, next) => next(), recordGenerated = (req, res, next) => next() }) {
  const router = express.Router();

  // Generation
  router.post('/generate', generateLimit, recordGenerated, validateGeneratePayload, controller.generateRecipe);
  router.post('/regenerate', generateLimit, recordGenerated, validateRegeneratePayload, controller.regenerateRecipe);

  // Customization
  router.post('/customize', validateCustomizePayload, controller.customizeRecipe);
  router.post('/substitute', validateCustomizePayload, controller.substituteIngredient);
  router.post('/healthier', validateCustomizePayload, controller.makeHealthier);
  router.post('/servings', validateCustomizePayload, controller.changeServings);

  // Saved recipes (logged-in users, own recipes only)
  router.get('/', requirePermission(PERMISSIONS.RECIPE_READ_OWN), controller.listSavedRecipes);
  router.get('/:id', requirePermission(PERMISSIONS.RECIPE_READ_OWN), controller.getSavedRecipe);
  router.post('/save', requirePermission(PERMISSIONS.RECIPE_SAVE), controller.saveRecipe);
  router.delete('/:id', requirePermission(PERMISSIONS.RECIPE_DELETE_OWN), controller.deleteSavedRecipe);

  return router;
}

module.exports = { createRecipeRouter };
