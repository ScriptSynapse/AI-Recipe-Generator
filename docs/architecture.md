# System Architecture

## Layered overview

```
 Browser (frontend/: vanilla JS, textContent-only rendering, strict CSP)
   pages: index, generator, results, recipes, ai-lab, analytics, security, settings, login
        | fetch() JSON, session cookie
        v
 Express (backend/app.js)
   security headers -> request id -> CORS (closed) -> authenticate -> rate limit
   -> routes: /api/auth  /api/recipes  /api/ai  /api/usage  /api/admin  /api/security  /api/health
   -> requirePermission (RBAC) -> controllers
   side stores (JSON files in data/): users, sessions, audit log, usage, model analytics
   event bus (Observer) -> auditLogger -> SecurityAuditLog (JSONL)
        | spawn per request, JSON over stdin/stdout (services/cppBridge.js)
        v
 C++ core (cpp-core/recipe_engine)
   SecurityPipeline: InputValidator -> PromptInjectionDetector -> XSSDetector
   RecipeMatcher / DatabaseGenerator      AIGenerator -> ModelRouter -> providers
   AIOutputValidator -> RecipeBuilder -> Recipe (TraditionalRecipe | AIRecipe)
   RecipeEvaluator, IngredientConsistencyChecker, ModelComparator, RecipeStorage (+FileLock)
        |                                   |
        v                                   v HTTPS (libcurl)
   data/recipes.json, saved_recipes.json    Claude, Gemini, OpenAI, Groq, Local LLM
                                            (any unavailable one is skipped; offline fallback last)
```

Authentication, sessions, RBAC, rate limiting and auditing are enforced in Node. Input and output security checks, generation and evaluation are in C++. The engine also emits security events, which Node reads from the engine's response and publishes on the same bus. See `security.md`, `ai-architecture.md` and `api.md`.

## Why a subprocess boundary (Node <-> C++)?

The assignment requires a *meaningful* C++ OOP core, not a C++ program
that merely proxies to an AI API. Keeping the C++ core as a standalone
CLI binary (`cpp-core/recipe_engine`) that speaks JSON over stdin/stdout
has several benefits that matter for a lab project:

1. **Clean separation.** The Express layer never touches recipe-scoring
   logic, customization rules, or file storage directly — it only knows
   how to spawn a process and parse JSON. All of that logic genuinely
   lives in C++ classes.
2. **Easy to demonstrate standalone.** For a viva, the C++ binary can be
   run directly from a terminal (`echo '{...}' | ./recipe_engine generate ./data`)
   with no Node.js or browser involved, proving the OOP core works on
   its own.
3. **Language-agnostic contract.** The JSON request/response shape is
   simple enough to reimplement the frontend or backend independently
   without ever touching the C++ code.

## Request lifecycle example: POST /api/recipes/generate

1. Browser collects form input (ingredients, cuisine, meal type, diet,
   cooking time, difficulty, servings) in `generator.js` and calls
   `RecipeAPI.generate(preferences)`.
2. The request passes security headers, authentication, and the `generate` rate limit
   (anonymous callers are allowed but get the tightest limit). Usage is counted only
   after a successful response. `validateGeneratePayload` checks shape, then
   `recipeController.generateRecipe` runs.
3. The controller calls `cppBridge.runEngine('generate', { preferences })`,
   which spawns `cpp-core/recipe_engine generate <dataDir>` with a minimal,
   allow-listed environment and writes the JSON payload to its stdin.
4. Inside the C++ core (`main.cpp::handleGenerate`):
   - `RecipePreferences::fromJson` parses the payload.
   - `runInputSecurity` runs the `SecurityPipeline` (`InputValidator`,
     `PromptInjectionDetector`, `XSSDetector`). A rejection ends the request
     with a fixed-text error and a security event; no provider is called.
   - `RecipeMatcher` scores every database recipe and computes each candidate's
     **ingredient coverage** (salt, pepper and water are not counted against it).
     A candidate is eligible only with full coverage and a score of at least
     `DATABASE_MATCH_THRESHOLD` (55/100). Then `DatabaseGenerator` builds a
     `TraditionalRecipe`, scaled to the requested servings.
   - Otherwise `AIGenerator` asks the `ModelRouter` chain (Claude, Gemini, OpenAI,
     Groq, Local). Each answer goes through `AIOutputValidator` and
     `RecipeBuilder`; a bad answer counts as a failure. If the whole chain fails,
     the local template generator produces the recipe and `usedFallback` is true.
   - `IngredientConsistencyChecker` compares the final recipe with the request.
   - The response carries `recipe`, `matchInfo` and `consistency`.
5. `cppBridge.js` parses stdout back into a JS object and the controller
   forwards it to the browser as `{ success: true, data: { recipe,
   matchInfo, consistency }, message }`.
6. `generator.js` stores the recipe (and original preferences, for
   Regenerate) in `sessionStorage` and navigates to `results.html`,
   which renders it and wires up Save / Regenerate / Make Healthier /
   Substitute / Change Servings.

## Configuration points

| Concern | Location |
|---|---|
| Database-vs-AI match threshold | `cpp-core/main.cpp` — `DATABASE_MATCH_THRESHOLD` |
| Strict "ingredients only" coverage requirement | `cpp-core/main.cpp` — `INGREDIENT_COVERAGE_THRESHOLD` (100 = a database recipe must use zero ingredients the user didn't list, aside from salt/pepper/water) |
| Scoring weights | `cpp-core/engine/RecipeMatcher.cpp` — `findMatches()` |
| AI model names | `*_MODEL` env vars; defaults in each `cpp-core/ai/providers/*Provider.cpp` |
| AI API keys | `.env` — `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY` (never hardcoded, never sent to the frontend) |
| Security / rate-limit / session settings | `.env` (see `.env.example`), parsed and clamped in `backend/config/index.js` |
| Data directory | `backend/services/cppBridge.js` — `DATA_DIR`, passed as `argv[2]` to the binary |

## Failure handling

| Failure | Result |
|---|---|
| Bad input shape | 400 from Node, engine not started |
| Rejected by the security pipeline | 400 with a fixed message; event audited |
| Provider down, slow or returning bad output | next provider; finally the offline generator |
| Engine timeout or crash | generic 5xx; detail only in the server log |
| Corrupt or locked recipe file | `StorageException`, generic error to the client |
| Audit log write failure | the request is not failed by it; the error is logged |
