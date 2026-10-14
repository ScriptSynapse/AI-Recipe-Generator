const express = require('express');
const { PERMISSIONS } = require('../authorization/permissions');

/**
 * /api/ai -- the AI Model Lab.
 *
 *   GET  /models    logged-in users   which models exist / are usable
 *   POST /compare   logged-in users   ask every model the same question, compare validated results
 *
 * Gate order matters: authentication/permission FIRST (so an anonymous
 * caller never consumes Lab quota or reaches the engine), then the rate
 * limit, then the handler (which validates the body).
 * Benchmark, analytics and provider status are admin-only and live under /api/admin.
 */
function createAiRouter({ controller, requirePermission, compareLimit = (req, res, next) => next(), recordCompared = (req, res, next) => next() }) {
  const router = express.Router();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  router.get('/models', requirePermission(PERMISSIONS.AI_LAB_USE), controller.listModels);
  router.post('/compare', requirePermission(PERMISSIONS.AI_LAB_USE), compareLimit, recordCompared, controller.compare);
  return router;
}

module.exports = { createAiRouter };
