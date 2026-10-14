const express = require('express');

const { PERMISSIONS } = require('../authorization/permissions');

/**
 * /api/admin router. Every route here names the permission it needs; the
 * USER role has none of the admin permissions, so a regular user gets a
 * 403 and an anonymous caller a 401, decided on the server.
 *
 * Exists so far: system health, the audit log, the blocked-request log,
 * provider status, model analytics, benchmark history and the benchmark runner. The security
 * dashboard joins this router in a later phase, behind its own permission.
 */
function createAdminRouter({ controller, auditController, aiController, requirePermission, benchmarkLimit = (req, res, next) => next() }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/health', requirePermission(PERMISSIONS.SYSTEM_HEALTH_READ), controller.adminHealthCheck);
  router.get('/audit-log', requirePermission(PERMISSIONS.AUDIT_LOG_READ), auditController.listAuditLog);
  router.get('/blocked-requests', requirePermission(PERMISSIONS.BLOCKED_REQUEST_LOG_READ), auditController.listBlockedRequests);

  router.get('/providers', requirePermission(PERMISSIONS.PROVIDER_STATUS_READ), aiController.adminProviderStatus);
  router.get('/model-analytics', requirePermission(PERMISSIONS.MODEL_ANALYTICS_READ), aiController.analytics);
  router.get('/benchmark-history', requirePermission(PERMISSIONS.MODEL_ANALYTICS_READ), aiController.history);
  router.post('/benchmark', requirePermission(PERMISSIONS.BENCHMARK_RUN), benchmarkLimit, aiController.benchmark);

  return router;
}

module.exports = { createAdminRouter };
