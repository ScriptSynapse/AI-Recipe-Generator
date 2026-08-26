const express = require('express');
const router = express.Router();

const controller = require('../controllers/recipeController');
const { validateGeneratePayload, validateCustomizePayload } = require('../controllers/validateRequest');

// Generation
router.post('/generate', validateGeneratePayload, controller.generateRecipe);
router.post('/regenerate', controller.regenerateRecipe);

// Customization
router.post('/customize', validateCustomizePayload, controller.customizeRecipe);
router.post('/substitute', validateCustomizePayload, controller.substituteIngredient);
router.post('/healthier', validateCustomizePayload, controller.makeHealthier);
router.post('/servings', validateCustomizePayload, controller.changeServings);

// Saved recipes
router.get('/', controller.listSavedRecipes);
router.get('/:id', controller.getSavedRecipe);
router.post('/save', controller.saveRecipe);
router.delete('/:id', controller.deleteSavedRecipe);

module.exports = router;
