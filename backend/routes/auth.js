const express = require('express');

/**
 * /api/auth router. Built by a factory (not a module-level singleton) so
 * each app instance -- including each test's -- gets its own controller
 * and stores.
 */
function createAuthRouter({ controller, requireAuth, authLimit = (req, res, next) => next() }) {
  const router = express.Router();

  // Responses here carry identity/session data: never cache them.
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', authLimit, controller.register);
  router.post('/login', authLimit, controller.login);
  router.post('/logout', controller.logout);
  router.post('/change-password', authLimit, requireAuth, controller.changePassword);
  router.get('/me', requireAuth, controller.me);

  return router;
}

module.exports = { createAuthRouter };
