# Security Center (Phase P)

Admin-only dashboard (`frontend/security.html`) over the audit log. Every figure is a count of real audit records; with an empty log everything is zero.

## Endpoints (permission `admin:security-dashboard:read`, ADMIN only)

| Method | URL | Notes |
|---|---|---|
| GET | `/api/security/stats?window=1h\|24h\|7d\|30d` | default `24h`. Returns totals, counts by type/severity/result, model failures by provider, a time series and the threat level. |
| GET | `/api/security/events` | recent audit events, newest first; same filters as `/api/admin/audit-log` (`type`, `severity`, `result`, `since`, `until`, `limit`, `beforeSeq`). |

Errors: `401` not signed in, `403` not an admin (audited as `UNAUTHORIZED_ACCESS`), `400 INVALID_QUERY` for a bad window/filter (fixed text, the value is never echoed).

## Threat level (last hour only)

- **HIGH**: >= 3 high-severity events, or >= 20 blocked requests
- **ELEVATED**: >= 1 high-severity event, or >= 5 blocked requests, or >= 10 medium-severity events
- **NORMAL**: otherwise

"Blocked" = audit results `BLOCKED`, `DENIED` or `REJECTED`. The reasons that triggered the level are returned and shown.

## Limits

Stats scan at most 50,000 records (newest first). If the log is larger, `source.truncated` is true and the page says older figures may be understated. Retention is by log size, not time (see audit log docs). The page draws charts with plain DOM elements and `textContent` only.
