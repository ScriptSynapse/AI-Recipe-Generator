const express = require('express');

const { PERMISSIONS } = require('../authorization/permissions');

/** /api/usage -- the signed-in user's own activity counters (never anyone else's). */
function createUsageRouter({ usageStore, requirePermission }) {
  const router = express.Router();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.get('/me', requirePermission(PERMISSIONS.RECIPE_READ_OWN), (req, res) => {
    res.status(200).json({ success: true, data: usageStore.summary(req.auth.user.id, 14) });
  });
  return router;
}

module.exports = { createUsageRouter };
