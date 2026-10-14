# Security Architecture

This document describes what the code does today. Controls that are not built are listed in "Known gaps" rather than implied.

## Threat model

| Asset | Threat | Main controls |
|---|---|---|
| Model API keys | Leak through logs, errors, responses or the audit log | Keys live only in `.env` (git-ignored) and the engine's environment allow-list. Events, errors and audit records use fixed text and are scrubbed (`audit/sanitize.js`). |
| The LLM prompt | Prompt injection through the ingredient list or other free text | `PromptInjectionDetector` in the C++ input pipeline. A hit rejects the request before any provider is called. |
| The browser | Stored or reflected XSS through user text or model output | `XSSDetector` on input, `AIOutputValidator` (schema) on model output, `textContent`-only rendering in the frontend, strict CSP. |
| User accounts | Credential stuffing, brute force, session theft | scrypt hashes, per-account+IP and per-IP login throttle, hashed server-side sessions in HttpOnly SameSite=Strict cookies. |
| Other users' recipes | Reading or deleting a record you do not own | Deny-by-default RBAC plus a per-record ownership check that no role can override. |
| Provider budget | Abuse of paid AI endpoints | Per-tier token-bucket rate limits, a much lower limit on the Model Lab, and login required for it. |
| Audit trail | Tampering, unbounded growth, secrets in logs | Append-only JSONL, file mode 0600, size-based rotation, scrubbed fields. |

Out of scope: a compromised host, a malicious admin, and denial of service at network level.

## Request path

```
Browser
  -> security headers -> request id -> CORS (closed by default)
  -> authenticate (who is this? never rejects by itself)
  -> rate limit (tier: anonymous / user / admin; class: api / generate / compare / benchmark / auth)
  -> route-level requirePermission (RBAC)
  -> payload shape validation (Node)
  -> spawn C++ engine
       -> SecurityPipeline: InputValidator -> PromptInjectionDetector -> XSSDetector
       -> generation (database or AI)
       -> AIOutputValidator on any model output
       -> IngredientConsistencyChecker on the final recipe
  -> JSON response
```

## Controls

**Input pipeline (C++, Chain of Responsibility).** `SecurityPipeline` runs checks in order and stops at the first rejection. Each check returns Passed, Skipped or Rejected. Rejections become `SecurityEvent`s with fixed text only: user input is never copied into an event or an error.

**AI output validation.** `AIOutputValidator` (wrapped as a pipeline check by `AIOutputValidatorCheck`) parses model output against a closed schema: exactly the 10 requested keys, correct types, sane numeric ranges, a valid difficulty. Any extra key is rejected. Its error messages name fields, never the values the model returned. This is a structural check, not a markup scanner; markup in text fields is handled by the frontend's `textContent` rendering and the CSP. `RecipeBuilder` then validates the fields it assembles. A rejected output is reported as `AI_OUTPUT_REJECTED` and the next provider (or the offline generator) is used.

**Ingredient consistency.** `IngredientConsistencyChecker` flags non-food substances, ingredients the user did not list (staples such as salt and water are allowed) and diet conflicts. Its result is returned as `consistency` and shown on the Results page. It reports; it does not block.

**Authentication.**
- Passwords: scrypt (N=2^15, r=8, p=3 by default, parameters stored with each hash). A dummy hash is verified for unknown users so timing does not reveal which accounts exist. Length 10-128, with a common-password list and reserved usernames.
- Sessions: a random token in an HttpOnly, SameSite=Strict cookie. Only a hash of the token is stored server-side. Over HTTPS (`COOKIE_SECURE=true` or `NODE_ENV=production`) the cookie becomes `__Host-session` and `Secure`, and HSTS is sent. Absolute lifetime 8 hours (`SESSION_TTL_HOURS`); a session unused for 60 minutes also ends (`SESSION_IDLE_MINUTES`, 0 turns it off). Activity is recorded at most once a minute.
- Password change (`POST /api/auth/change-password`): needs the current password, applies the same rules as registration, ends every session of the account and issues a fresh one for the caller. Wrong current passwords count toward the login throttle. Both outcomes are audited.
- Login throttle: 5 failures per (IP + account) or 20 per IP within a 15 minute window by default.

**Authorization (RBAC).** `authorization/permissions.js` is the only place that maps roles to permissions. Routes ask for a permission, never a role. Anonymous callers have none. ADMIN has every USER permission plus the admin ones, but still cannot read or delete another user's recipes: ownership is checked per record in `ownership.js`. A denial is audited as `UNAUTHORIZED_ACCESS`.

| Permission | USER | ADMIN |
|---|---|---|
| `recipe:save`, `recipe:read:own`, `recipe:delete:own` | yes | yes |
| `ai-lab:use` | yes | yes |
| `admin:system-health:read`, `admin:provider-status:read`, `admin:security-dashboard:read`, `admin:audit-log:read`, `admin:blocked-requests:read`, `admin:model-analytics:read`, `admin:benchmark:run` | no | yes |

**Rate limiting.** Token buckets, burst equal to the per-minute rate. Defaults (per minute):

| Class | Anonymous | User | Admin |
|---|---|---|---|
| api | 60 | 120 | 300 |
| generate | 5 | 15 | 60 |
| compare (Model Lab) | login required | 3 | 10 |
| benchmark | n/a | n/a | 2 |
| auth | 10 per IP | | |

A refused request returns 429 and is audited as `RATE_LIMIT`. `X-Forwarded-For` is trusted only when `TRUST_PROXY_HOPS` says how many proxies sit in front.

**HTTP hardening.** CSP (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP and CORP same-origin. CORS sends no headers unless origins are listed in `CORS_ORIGINS`; listed origins are matched exactly and never reflected. JSON body limit 200 KB by default. Request, header and keep-alive timeouts are configurable.

**Audit log.** Event types: `PROMPT_INJECTION`, `XSS_ATTEMPT`, `RATE_LIMIT`, `INVALID_INPUT`, `AI_OUTPUT_REJECTED`, `AUTH_FAILURE`, `UNAUTHORIZED_ACCESS`, `MODEL_FAILURE`, `SECURITY_SCAN`, `AUTH_SUCCESS`, `PRIVILEGE_CHANGE`. Severities INFO/LOW/MEDIUM/HIGH; results SUCCESS/FAILURE/BLOCKED/DENIED/REJECTED. Events come from both the Node event bus and the C++ engine (relayed by `engineEvents.js`). Only admins can read it. See also `security-center.md` for the dashboard and threat level.

**Recipes sent back by the browser (save, customize).** Every string anywhere in the payload (known fields, unknown fields, even object keys) is scanned by `XSSDetector`; a hit is refused with `XSS_SUSPECTED` and audited as a HIGH `XSS_ATTEMPT` with pattern categories only. Payload nesting is limited. A saved recipe is then rebuilt through `RecipeBuilder` from its known fields, so unknown or forged extra fields are dropped; the only extra field kept is `ownerId`, which the server stamps from the session.

**Storage.** Saved recipes are written to a temp file and renamed, under an atomic directory lock (`FileLock`, RAII), with size and shape limits on each record. Record ids are restricted to `[A-Za-z0-9._-]`.

## Final review (Phase T)

Reviewed by reading the code and by probing the real engine; the Express HTTP layer could not be run in the review environment.

| Area | Result |
|---|---|
| Secrets | No keys in the repo (pattern scan). `.env` and runtime state files are git-ignored. The engine receives only an allow-list of environment variables. Errors and events use fixed text. |
| Auth | scrypt, hashed sessions, new token on login, throttle before hashing, dummy hash for unknown users. **Found and fixed:** reserved-username registration returned faster than other registrations (a timing oracle); no idle timeout; no password change. |
| Authorization | Deny-by-default RBAC; ownership checked per record; non-owner and missing share one 404 body. No finding. |
| Input and output | **Found and fixed:** save and customize payloads were not scanned for markup, and save stored the browser's raw JSON (forged or extra fields were persisted). Now scanned and rebuilt (see above). Over-nested payloads were not bounded; now refused. |
| Frontend | No `innerHTML`/`outerHTML` assignment anywhere (enforced by a test that sweeps every script). Strict CSP. |
| Disclosure | Request ids are generated server-side; access logs omit query strings; 404s do not echo the URL. No finding. |

Test coverage for the fixes: `recipePayloadSecurity.test.js` (real engine), `sessionSecurity.test.js`, and the settings tests in `redesignFrontend.test.js`.

Operational note: `data/saved_recipes.json` is tracked in git as an empty list. Once users save recipes it holds their data, so untrack it (`git rm --cached data/saved_recipes.json`) before committing a running instance.

## Known gaps

- The "Output validated" badge and the model name on a saved recipe come from the stored record. A signed-in user can save a recipe claiming any provider through the API, so these labels describe the record, not a cryptographic proof. Only that user's own recipes are affected.
- Rate limits, the login throttle and the audit gate are in-memory and per process; they reset on restart and are not shared across instances.
- The C++ `RateLimitChecker`, `IngredientSafetyChecker`, `AlertManager` and `SecurityDashboard` observers named in the original spec are not built. Rate limiting is done in Node; consistency is checked by the evaluator and `IngredientConsistencyChecker`.
- Not tested with real provider keys; the Express HTTP-level security tests need `npm install` and have not run in the sandbox this was developed in.
