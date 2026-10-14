/**
 * Read access to the audit log (admin only -- routes/admin.js guards each
 * route with its permission before these handlers run).
 *
 * Query parameters are validated strictly: Express's default query parser
 * can hand over arrays and nested objects (`?type[a]=1`), so anything that
 * is not a plain string (or, for `type`, a list of strings) is a 400, as
 * is any value the audit log itself refuses. Error text is fixed -- it
 * never echoes the supplied value.
 */
const { errorBody } = require('../middleware/errorHandler');

const asString = (value, name) => {
  if (typeof value !== 'string') throw new RangeError(`${name} must be a single value.`);
  return value;
};

const asInteger = (value, name) => {
  const text = asString(value, name);
  if (!/^\d{1,9}$/.test(text)) throw new RangeError(`${name} must be a positive integer.`);
  return Number(text);
};

function parseFilters(query) {
  const filters = {};
  if (query.type !== undefined) {
    const raw = [].concat(query.type);
    filters.type = raw.flatMap((entry) => asString(entry, 'type').split(',')).filter(Boolean);
  }
  if (query.severity !== undefined) filters.severity = asString(query.severity, 'severity');
  if (query.result !== undefined) filters.result = asString(query.result, 'result');
  if (query.userId !== undefined) filters.userId = asString(query.userId, 'userId');
  if (query.since !== undefined) filters.since = asString(query.since, 'since');
  if (query.until !== undefined) filters.until = asString(query.until, 'until');
  if (query.limit !== undefined) filters.limit = asInteger(query.limit, 'limit');
  if (query.beforeSeq !== undefined) filters.beforeSeq = asInteger(query.beforeSeq, 'beforeSeq');
  return filters;
}

function createAuditController({ auditLog }) {
  const handler = (blockedOnly) => (req, res, next) => {
    let result;
    try {
      const filters = parseFilters(req.query || {});
      if (blockedOnly) filters.blockedOnly = true;
      result = auditLog.query(filters);
    } catch (err) {
      if (err instanceof RangeError) return res.status(400).json(errorBody('INVALID_QUERY', err.message));
      return next(err);
    }
    return res.status(200).json({ success: true, data: result });
  };

  return {
    listAuditLog: handler(false),
    listBlockedRequests: handler(true),
  };
}

module.exports = { createAuditController, parseFilters };
