const express = require('express');

const { PERMISSIONS } = require('../authorization/permissions');

/**
 * /api/security router -- the Security Center's data. Every route needs
 * SECURITY_DASHBOARD_READ, which only ADMIN holds; the gate runs first.
 *   GET /stats   aggregated counts, time series and threat level
 *   GET /events  recent audit events (same filters as /api/admin/audit-log)
 */
function createSecurityRouter({ controller, auditController, requirePermission }) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/stats', requirePermission(PERMISSIONS.SECURITY_DASHBOARD_READ), controller.stats);
  router.get('/events', requirePermission(PERMISSIONS.SECURITY_DASHBOARD_READ), auditController.listAuditLog);

  return router;
}

module.exports = { createSecurityRouter };
