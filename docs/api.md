# API Reference

All endpoints are under `/api`, speak JSON, and are same-origin by default. Successful responses are `{ "success": true, "data": ..., "message": "..." }`. Errors are `{ "success": false, "error": { "code": "...", "message": "..." } }` with fixed text: user input, keys and model output are never echoed.

Authentication is a session cookie (`session`, or `__Host-session` over HTTPS) set by login. "Permission" names the RBAC permission the server checks; the frontend only hides things.

## Auth

| Method and path | Access | Notes |
|---|---|---|
| `POST /api/auth/register` | anonymous | `{ username, password }`. Password 10-128 chars. Rate limited per IP. |
| `POST /api/auth/login` | anonymous | `{ username, password }`. Sets the cookie. 429 after repeated failures. |
| `POST /api/auth/logout` | any | Clears the cookie and the server-side session. |
| `POST /api/auth/change-password` | signed in | `{ currentPassword, newPassword }`. Ends every session of the account and sets a fresh cookie. 401 `INVALID_CREDENTIALS` for a wrong current password, 400 for a rejected new one, 429 when throttled. |
| `GET /api/auth/me` | signed in | `{ user }`. |

Requests must use `Content-Type: application/json` (otherwise 415).

## Recipes

| Method and path | Access | Notes |
|---|---|---|
| `POST /api/recipes/generate` | anonymous allowed | The preferences themselves, as a flat JSON object: `{ ingredients[], cuisine, mealType, dietaryPreference, cookingTime, difficulty, servings }`. Returns `data.recipe`, `data.matchInfo`, `data.consistency`. |
| `POST /api/recipes/regenerate` | anonymous allowed | `{ preferences, previousRecipeId?, forceAi? }`. Excludes the previous recipe. |
| `POST /api/recipes/customize` | anonymous allowed | `{ recipe, action, argument }`. |
| `POST /api/recipes/substitute` | anonymous allowed | `{ recipe, ingredient }`. |
| `POST /api/recipes/healthier` | anonymous allowed | `{ recipe }`. |
| `POST /api/recipes/servings` | anonymous allowed | `{ recipe, servings }`. |
| `POST /api/recipes/save` | `recipe:save` | Saves for the signed-in user. The recipe is scanned for markup (400 `XSS_SUSPECTED`) and rebuilt from its known fields. |
| `GET /api/recipes` | `recipe:read:own` | Your saved recipes, newest first. |
| `GET /api/recipes/:id` | `recipe:read:own` | 404 for a missing recipe and for someone else's (same body). |
| `DELETE /api/recipes/:id` | `recipe:delete:own` | Same 404 rule. |

`consistency` reports ingredients the user listed but the recipe did not use, extra ingredients, non-food substances and diet conflicts. It informs; it does not block.

## AI Model Lab

| Method and path | Access | Notes |
|---|---|---|
| `GET /api/ai/models` | `ai-lab:use` | Providers and whether each is available. |
| `POST /api/ai/compare` | `ai-lab:use`, compare rate limit | Calls every available provider in parallel. Returns per-model results, `fastest` and `best` (null when no validated reply). |

## Usage (signed in)

| Method and path | Access | Notes |
|---|---|---|
| `GET /api/usage/me` | `recipe:read:own` | Your own counts for the last 14 days. Zero when there is no history. |

## Admin

| Method and path | Permission |
|---|---|
| `GET /api/admin/health` | `admin:system-health:read` |
| `GET /api/admin/audit-log` | `admin:audit-log:read` |
| `GET /api/admin/blocked-requests` | `admin:blocked-requests:read` |
| `GET /api/admin/providers` | `admin:provider-status:read` |
| `GET /api/admin/model-analytics` | `admin:model-analytics:read` |
| `GET /api/admin/benchmark-history` | `admin:model-analytics:read`; optional `provider`, `source` (`lab`\|`benchmark`), `since`, `until` (`YYYY-MM-DD`), `limit` (1-100). Past runs, newest first, with per-model measurements. A bad filter returns 400 `INVALID_QUERY` (fixed text). |
| `POST /api/admin/benchmark` | `admin:benchmark:run`; body `{ runs: 1-3 }` |

## Security Center (admin)

| Method and path | Permission |
|---|---|
| `GET /api/security/stats?window=1h\|24h\|7d\|30d` | `admin:security-dashboard:read` |
| `GET /api/security/events` | `admin:security-dashboard:read` |

Audit filters: `type`, `severity`, `result`, `since`, `until`, `limit`, `beforeSeq`. See `security-center.md`.

## Health

`GET /api/health` is public and returns only whether the pipeline (Node, engine, data directory) responds.

## Status codes

| Code | Meaning |
|---|---|
| 400 | Bad shape, failed validation, prompt injection or XSS suspected, invalid recipe fields |
| 401 | Not signed in |
| 403 | Signed in without the permission (audited) |
| 404 | Unknown route, or a recipe that is missing or not yours |
| 415 | Auth request without a JSON content type |
| 429 | Rate limit or login throttle; `Retry-After` is set |
| 500 | Engine or storage failure; generic message only |

Rate limits and defaults are in `security.md`.
