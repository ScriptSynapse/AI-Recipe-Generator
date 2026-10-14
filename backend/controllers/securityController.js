/**
 * Security Center endpoints (admin only -- routes/security.js guards each
 * with SECURITY_DASHBOARD_READ before these run). Read-only: the stats are
 * computed from the audit log on request, never stored separately.
 */
const { errorBody } = require('../middleware/errorHandler');
const { SecurityStats, DEFAULT_WINDOW } = require('../audit/SecurityStats');

function createSecurityController({ auditLog, now }) {
  const stats = new SecurityStats({ auditLog, now });

  return {
    stats(req, res, next) {
      const raw = req.query && req.query.window;
      if (raw !== undefined && typeof raw !== 'string') {
        return res.status(400).json(errorBody('INVALID_QUERY', 'window must be a single value.'));
      }
      try {
        return res.status(200).json({ success: true, data: stats.compute(raw === undefined ? DEFAULT_WINDOW : raw) });
      } catch (err) {
        if (err instanceof RangeError) return res.status(400).json(errorBody('INVALID_QUERY', 'window must be one of 1h, 24h, 7d, 30d.'));
        return next(err);
      }
    },
  };
}

module.exports = { createSecurityController };
