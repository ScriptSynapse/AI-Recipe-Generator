# System Architecture

## Layered overview

```
 ┌─────────────────────────────────────────────────────────────────┐
 │  PRESENTATION LAYER                                              │
 │  frontend/ (HTML5 + CSS3 + vanilla JS)                            │
 │  index.html · generator.html · results.html · recipes.html       │
 └───────────────────────────────┬────────────────────────────────┘
                                  │ fetch() -> JSON over HTTP
 ┌───────────────────────────────▼────────────────────────────────┐
 │  API LAYER                                                        │
 │  backend/ (Node.js + Express)                                     │
 │  routes/recipes.js -> controllers/recipeController.js             │
 │  validateRequest.js (shape-level validation)                      │
 └───────────────────────────────┬────────────────────────────────┘
                                  │ spawn subprocess, JSON over stdin/stdout
 ┌───────────────────────────────▼────────────────────────────────┐
 │  C++ OOP CORE                                                     │
 │  cpp-core/recipe_engine (compiled binary)                         │
 │  main.cpp orchestrates:                                           │
 │    validation/Validator                                           │
 │    engine/RecipeMatcher, engine/RecipeCustomizer                  │
 │    generators/DatabaseGenerator, generators/AIGenerator            │
 │    models/Recipe (+TraditionalRecipe, AIRecipe), User, Preferences │
 │    storage/RecipeStorage                                          │
 └───────────────────────────────┬────────────────────────────────┘
                                  │ file I/O (fstream)          │ HTTPS (libcurl)
                     ┌────────────▼────────────┐   ┌─────────────▼─────────────┐
                     │  RECIPE DATA LAYER        │   │       AI SERVICE           │
                     │  data/recipes.json        │   │  api.anthropic.com/v1/     │
                     │  data/saved_recipes.json  │   │  messages (Claude models)  │
                     └───────────────────────────┘   │  falls back to local       │
                                                       │  templates if unavailable │
                                                       └────────────────────────────┘
```

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
2. Express route `POST /api/recipes/generate` runs
   `validateGeneratePayload` (shape-level checks only), then
   `recipeController.generateRecipe`.
3. The controller calls `cppBridge.runEngine('generate', { preferences })`,
   which spawns `cpp-core/recipe_engine generate <dataDir>` and writes
   the JSON payload to its stdin.
4. Inside the C++ core (`main.cpp::handleGenerate`):
   - `RecipePreferences::fromJson` parses the payload.
   - `Validator::validate` throws `ValidationException` on bad input.
   - `DatabaseGenerator::bestMatchFor` runs `RecipeMatcher`'s weighted
     scoring rubric against `data/recipes.json`.
   - If the best score clears `DATABASE_MATCH_THRESHOLD` (55/100,
     configurable in `main.cpp`), `DatabaseGenerator::generateRecipe`
     builds a `TraditionalRecipe`, scaled to the requested servings.
   - Otherwise, `AIGenerator::generateRecipe` tries the real Anthropic
     API (if `ANTHROPIC_API_KEY` is set) and falls back to a local
     template generator on any failure, producing an `AIRecipe`.
   - The resulting `Recipe` is serialized with `toJson()` and printed.
5. `cppBridge.js` parses stdout back into a JS object and the controller
   forwards it to the browser as `{ success: true, data: { recipe,
   matchInfo }, message }`.
6. `generator.js` stores the recipe (and original preferences, for
   Regenerate) in `sessionStorage` and navigates to `results.html`,
   which renders it and wires up Save / Regenerate / Make Healthier /
   Substitute / Change Servings.

## Configuration points

| Concern | Location |
|---|---|
| Database-vs-AI match threshold | `cpp-core/main.cpp` — `DATABASE_MATCH_THRESHOLD` |
| Scoring weights | `cpp-core/engine/RecipeMatcher.cpp` — `findMatches()` |
| AI model name | `cpp-core/generators/AIGenerator.cpp` — constructor |
| AI API key | `.env` — `ANTHROPIC_API_KEY` (never hardcoded, never sent to the frontend) |
| Data directory | `backend/services/cppBridge.js` — `DATA_DIR`, passed as `argv[2]` to the binary |
