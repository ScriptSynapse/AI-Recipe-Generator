# RecipeAI Sentinel — Secure Multi-LLM Recipe Intelligence Platform

**An OOP Laboratory Project** — a full-stack recipe generation platform
with a genuine C++ object-oriented core, a Node.js/Express REST API,
and a vanilla HTML/CSS/JS frontend. It started as the AI Recipe
Generator and was upgraded, not rewritten, with:

- **Multi-LLM generation**: Claude, Gemini, OpenAI, Groq and a local model behind one interface, with automatic failover and an offline fallback.
- **AI Model Lab**: send one request to every available model in parallel and compare real latency and evaluator scores.
- **Security pipeline**: input validation, prompt-injection and XSS detection before any model is called; strict schema validation of every model answer.
- **Accounts and RBAC**: scrypt passwords, server-side sessions in HttpOnly cookies, deny-by-default permissions, per-user recipes.
- **Rate limiting, audit log and Security Center**: every figure is computed from real recorded events; with no data it shows zeros.

Docs: [architecture](docs/architecture.md) · [class diagram](docs/class-diagram.md) · [flowcharts](docs/flowchart.md) · [security](docs/security.md) · [AI architecture](docs/ai-architecture.md) · [design patterns](docs/design-patterns.md) · [API](docs/api.md) · [testing](docs/testing.md) · [Security Center](docs/security-center.md)

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Problem Statement](#2-problem-statement)
3. [Objectives](#3-objectives)
4. [Existing System](#4-existing-system)
5. [Proposed System](#5-proposed-system)
6. [Functional Requirements](#6-functional-requirements)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [System Architecture](#8-system-architecture)
9. [Data Flow](#9-data-flow)
10. [Class Diagram](#10-class-diagram)
11. [OOP Concepts Used](#11-oop-concepts-used)
12. [Algorithms](#12-algorithms)
13. [Project Structure](#13-project-structure)
14. [Setup Instructions](#14-setup-instructions)
15. [Environment Variables](#15-environment-variables)
16. [How to Run the Frontend](#16-how-to-run-the-frontend)
17. [How to Run the Backend](#17-how-to-run-the-backend)
18. [How to Compile the C++ Core](#18-how-to-compile-the-c-core)
19. [How AI Integration Works](#19-how-ai-integration-works)
20. [Testing](#20-testing)
21. [Future Scope](#21-future-scope)

---

## 1. Abstract

AI Recipe Generator is a web application that turns a list of
ingredients a person has on hand, together with their cuisine, meal
type, dietary, time, and difficulty preferences, into a complete recipe.
It first attempts to find the best match in a local recipe database
using a weighted scoring algorithm; when no database recipe is a good
enough fit, it hands the request to an AI recipe generator instead. The
system also supports post-generation customization (ingredient
substitution, "make healthier", serving-size scaling), recipe
regeneration, and a personal saved-recipes collection. The project is
built specifically to demonstrate meaningful, non-decorative use of C++
object-oriented programming concepts inside a real, working, end-to-end
application rather than as an isolated classroom exercise.

## 2. Problem Statement

Home cooks frequently have a handful of ingredients on hand but no clear
idea what to cook with them, and generic recipe search engines require
already knowing a dish name rather than starting from "what do I have?".
Separately, most academic OOP lab projects either (a) implement OOP
concepts in isolation with no real application around them, or (b) build
a working application that barely uses OOP concepts at all (e.g. a thin
wrapper directly calling an AI API). This project addresses both: a
genuinely useful ingredient-first recipe tool, built around a C++ core
where inheritance, polymorphism, abstraction, and encapsulation are load
bearing, not decorative.

## 3. Objectives

- Accept ingredients and structured preferences from a user.
- Validate all input rigorously before it reaches business logic.
- Score existing database recipes against the user's request using a
  transparent, weighted rubric.
- Fall back to AI-based recipe generation when no database recipe is a
  good match — without ever crashing if the AI provider is unavailable.
- Allow the user to customize a generated recipe (substitutions,
  healthier variant, serving-size scaling) without starting over.
- Allow recipes to be saved, listed, and deleted.
- Demonstrate every required OOP concept with a genuine purpose inside
  the pipeline described above.

## 4. Existing System

Most "recipe finder" tools fall into one of two categories:

- **Static recipe databases / search engines** (e.g. searchable recipe
  websites) that require the user to already know roughly what dish
  they want, and offer no ingredient-driven discovery or personalization
  of dietary constraints, time budgets, or serving sizes.
- **Thin AI wrappers** that send a prompt straight to a hosted LLM and
  display whatever comes back, with no matching against real recipes,
  no scoring, no offline fallback, and no meaningful software
  architecture behind the API call.

Neither approach combines ingredient-first matching, a transparent
scoring rubric, and resilient AI fallback in one system.

## 5. Proposed System

This project proposes a three-tier system:

1. A **presentation layer** (vanilla JS frontend) that collects
   structured preferences and renders results with clear loading,
   success, error, empty, and validation states.
2. An **API layer** (Express) that exposes a clean REST contract and
   performs shape-level validation before ever touching business logic.
3. A **C++ OOP core** that owns all real business logic: input
   validation, ingredient/cuisine/diet/time/difficulty-weighted
   matching against a local database, AI-based generation with a
   guaranteed offline fallback, and customization/storage operations —
   all built from a deliberately designed class hierarchy.

## 6. Functional Requirements

- FR1: Accept ingredients, cuisine, meal type, dietary preference,
  cooking time, difficulty, and servings as input.
- FR2: Validate all input server-side (in C++) regardless of what the
  frontend already checked.
- FR3: Search the local recipe database and compute a match score per
  candidate recipe.
- FR4: Serve the best-matching database recipe when its score clears a
  configurable threshold.
- FR5: Otherwise, generate a new recipe via an AI provider, or a local
  fallback generator if no AI provider is configured or reachable.
- FR6: Allow substituting a named ingredient with a suggested
  replacement.
- FR7: Allow converting a recipe to a "healthier" variant.
- FR8: Allow rescaling a recipe to a new number of servings.
- FR9: Allow regenerating a recipe from the same preferences, excluding
  the previously shown recipe.
- FR10: Allow saving a recipe, listing saved recipes, and deleting a
  saved recipe.
- FR11: Return consistent JSON success/error envelopes from every API
  endpoint.

## 7. Non-Functional Requirements

- **Reliability**: the system must never crash or return an empty
  response solely because an AI provider is unreachable.
- **Usability**: every user-facing action must have loading, success,
  error, and (where relevant) empty/validation states.
- **Maintainability**: business logic lives in modular, single-purpose
  C++ classes; the API and frontend layers stay thin.
- **Portability**: the stack (Node.js + g++/libcurl + static HTML/CSS/JS)
  runs on any standard Linux development machine used for lab
  demonstrations.
- **Security**: no API keys are hardcoded or exposed to the frontend;
  secrets are read from environment variables server-side only.

## 8. System Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full layered
diagram and request-lifecycle walkthrough. In short:

```
Browser --(fetch/JSON, session cookie)--> Express API --(spawn + stdin/stdout JSON)--> C++ recipe_engine
   headers, auth, rate limit, RBAC, audit              |
                                          +------------+-------------+
                                          |                          |
                                data/*.json (fstream)     LLM providers (libcurl):
                                                          Claude, Gemini, OpenAI, Groq, Local
```

## 9. Data Flow

See [`docs/flowchart.md`](docs/flowchart.md) for the full pipeline
flowchart (generation decision tree, customization dispatch, and
validation-error flow).

## 10. Class Diagram

See [`docs/class-diagram.md`](docs/class-diagram.md) for the complete
class hierarchy (Recipe/TraditionalRecipe/AIRecipe,
RecipeGenerator/DatabaseGenerator/AIGenerator, and all supporting
classes) with ASCII diagrams.

## 11. OOP Concepts Used

| Concept | Where |
|---|---|
| **Classes & Objects** | Every file under `cpp-core/models`, `generators`, `engine`, `storage`, `validation` |
| **Encapsulation** | `Recipe`'s fields are `protected`, accessed only via getters/setters that enforce invariants (e.g. `setServings` clamps to 1-12) |
| **Constructors/Destructors** | Every class has explicit constructors; `Recipe` declares a `virtual ~Recipe()` because it's used polymorphically |
| **Inheritance** | `TraditionalRecipe` / `AIRecipe` extend `Recipe`; `DatabaseGenerator` / `AIGenerator` extend `RecipeGenerator` |
| **Polymorphism** | `Recipe::generateInstructions()` and `getSourceLabel()` are called through base pointers/references without knowing the concrete subtype (`RecipeCustomizer`, `main.cpp`) |
| **Abstract Classes** | `Recipe` (2 pure virtual functions) and `RecipeGenerator` (1 pure virtual function) can never be instantiated directly |
| **Virtual Functions** | `Recipe::displayRecipe()` is virtual with a default body (non-pure); `generateInstructions()`/`getSourceLabel()`/`toJson()` are overridden per subclass |
| **Function Overloading** | `RecipeCustomizer::changeServingSize(Recipe&, int)` vs. `changeServingSize(Recipe&, double)` |
| **STL** | `std::vector`, `std::map`, `std::unique_ptr`, `std::string`, algorithms (`std::sort`, `std::transform`, `std::any_of`) throughout |
| **File Handling** | `RecipeStorage` uses `std::ifstream`/`std::ofstream` to persist `data/saved_recipes.json` |
| **Exception Handling** | Custom `ValidationException` / `StorageException` (deriving from `std::runtime_error`), caught centrally in `main.cpp` |
| **Design patterns** | Strategy, Template Method, Factory, Adapter, Composite (`ModelRouter`), Chain of Responsibility (`SecurityPipeline`), Observer (security events), Builder (`RecipeBuilder`), RAII (`FileLock`). See [`docs/design-patterns.md`](docs/design-patterns.md) |
| **Concurrency** | `AIOrchestrator` / `ModelComparator` call providers with `std::async`; checked with ThreadSanitizer |
| **Input Validation** | `Validator` class checks every field of `RecipePreferences` and throws a specific, coded exception per rule |

Every one of these has a load-bearing role in the pipeline described in
section 9 — none are included purely to check a box (see
`docs/class-diagram.md` for exactly how each is exercised).

## 12. Algorithms

### Recipe matching (weighted score)

```
score = ingredientMatch * 0.50
      + cuisineMatch    * 0.20
      + dietMatch       * 0.15
      + cookingTime     * 0.10
      + difficulty      * 0.05
```

- `ingredientMatch`: percentage of the user's requested ingredients
  found (case-insensitive substring match) in the candidate recipe.
- `cuisineMatch`: 100 for an exact cuisine match, 60 if the user chose
  "Other", 0 otherwise.
- `dietMatch`: 100 if the user has no preference or an exact diet
  match, 90 if a vegan recipe satisfies a vegetarian request, 0
  otherwise — and a 0 diet score **hard-excludes** the recipe entirely
  (a recipe that fails the user's dietary requirement is never an
  acceptable "close match", regardless of its other scores).
- `cookingTime`: 100 if the recipe fits within the user's time budget,
  decaying linearly the more it overshoots.
- `difficulty`: 100 for an exact difficulty match, 50 if one level
  off (e.g. Easy vs. Medium), 0 otherwise.

A recipe is served directly from the database only if its score is
`>= 55` (`DATABASE_MATCH_THRESHOLD` in `main.cpp`) **and** it has full
ingredient coverage (see below); otherwise the request falls through
to `AIGenerator`.

### Strict "ingredients only" constraint

The app is built to only produce recipes the user can actually make
from what they listed — it never silently assumes they also have
extra vegetables, proteins, oil, or butter on hand.

- **Ingredient coverage** (`RecipeMatcher::computeIngredientCoverage`)
  is the reverse of `ingredientMatch` above: instead of "how many of
  the user's ingredients does this recipe use", it asks "how many of
  *this recipe's* ingredients did the user actually list". Salt,
  pepper, and water are treated as near-universal staples and don't
  count against coverage; everything else must be present in the
  user's list.
- A database recipe is only eligible to be served as-is if its
  coverage is 100% (`INGREDIENT_COVERAGE_THRESHOLD` in `main.cpp`) —
  i.e. it doesn't call for anything the user didn't mention. A recipe
  that uses lots of the user's ingredients but also needs a few they
  never listed is *not* served, even if its weighted score above the
  threshold would otherwise qualify it.
- When no database recipe clears both the score and coverage bars, the
  request falls to `AIGenerator`, which is explicitly instructed (both
  in the real-provider prompt and in the offline fallback templates)
  to use only the exact ingredients supplied, again with salt/pepper/
  water as the only allowed exceptions.

### AI generation with fallback

```
for provider in [Claude, Gemini, OpenAI, Groq, Local]:
    skip if it has no key / is unavailable
    try generate(prompt)
        validate the answer against the closed schema (AIOutputValidator)
        build the recipe (RecipeBuilder)  -> AIRecipe, aiProvider = this provider
    on ANY failure (network, non-2xx, malformed or invalid output): next provider
if every provider failed:
    local templates build the recipe (no network), usedFallback = true
```

### Serving-size scaling

Every ingredient quantity and nutrition value is multiplied by
`newServings / oldServings`, rounded to 2 decimal places.

## 13. Project Structure

```
AI-Recipe-Generator/
├── frontend/            HTML5 + CSS3 + vanilla JS (9 pages)
├── backend/             Node.js + Express REST API
│   ├── app.js, server.js
│   ├── authentication/, authorization/   login, sessions, RBAC
│   ├── audit/, ratelimit/, usage/, ai/   audit log, limits, usage and model analytics
│   ├── middleware/, routes/, controllers/
│   └── services/        cppBridge.js (spawns the C++ binary)
├── cpp-core/            The C++ OOP core
│   ├── models/           Recipe, TraditionalRecipe, AIRecipe, User, RecipePreferences
│   ├── generators/       RecipeGenerator, DatabaseGenerator, AIGenerator, RecipeTemplateEngine
│   ├── engine/           RecipeMatcher, RecipeCustomizer
│   ├── ai/               LLMProvider, providers/, ModelRouter, AIOrchestrator, ModelComparator
│   ├── security/         SecurityPipeline, checks/, events/
│   ├── evaluation/       RecipeEvaluator, IngredientConsistencyChecker
│   ├── storage/          RecipeStorage, FileLock
│   ├── validation/       Validator
│   ├── json.hpp          nlohmann/json single-header library
│   └── main.cpp          CLI entry point / orchestrator
├── data/                 recipes.json (seed DB), saved_recipes.json
├── scripts/              build-cpp.js (cross-platform C++ build wrapper)
├── tests/                C++ unit tests + run_tests.sh
├── docs/                 architecture, class-diagram, flowchart, security, ai-architecture, design-patterns, api, testing
├── .env.example
├── package.json
└── README.md
```

## 14. Setup Instructions

Prerequisites: Node.js 18+, a C++17 compiler (g++), and `libcurl`
development headers. `npm run build:cpp` runs a small cross-platform
Node script (`scripts/build-cpp.js`) that compiles the C++ core and
names the output binary correctly for your OS (`recipe_engine` on
Linux/macOS, `recipe_engine.exe` on Windows) — the same script works
everywhere, so the steps below are identical across platforms except
for how you install the compiler and libcurl.

### Linux (Debian/Ubuntu)

```bash
# 1. Install Node dependencies
npm install

# 2. Install a C++ compiler and libcurl dev headers
sudo apt-get update && sudo apt-get install -y g++ libcurl4-openssl-dev

# 3. Compile the C++ core
npm run build:cpp

# 4. (Optional) configure an AI API key
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=... if you have one
# leaving it blank is fine -- the app uses the offline fallback generator

# 5. Start the server (serves the frontend AND the API)
npm start
# -> AI Recipe Generator backend running at http://localhost:3000
```

### macOS

```bash
# 1. Install Node dependencies
npm install

# 2. Install Xcode command line tools (gives you g++/clang++) and curl headers
xcode-select --install
brew install curl   # only if you don't already have curl dev headers

# 3. Compile the C++ core
npm run build:cpp

# 4. (Optional) configure an AI API key
cp .env.example .env

# 5. Start the server
npm start
```

### Windows (via MSYS2 / MinGW-w64)

Windows doesn't have `apt-get`, so you need a C++ toolchain + libcurl
from somewhere else. The simplest path is MSYS2:

```powershell
# One-time setup:
# 1. Install MSYS2 from https://www.msys2.org (run the installer)
# 2. Open the "MSYS2 MinGW64" terminal (NOT the plain MSYS2 terminal)
#    and run:
pacman -Syu
# (it may ask you to close and reopen the terminal -- do that, then
#  run "pacman -Syu" again until it says there's nothing to do)
pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-curl

# 3. Add C:\msys64\mingw64\bin to your Windows PATH, so g++ and node
#    both work from the same terminal (System Properties -> Environment
#    Variables), OR just always use the "MSYS2 MinGW64" terminal for
#    this project.
# 4. Install Node.js for Windows normally from https://nodejs.org
```

Then, from a terminal that has both `node` and `g++` on its PATH (the
MSYS2 MinGW64 terminal, or PowerShell/cmd if you added MinGW64 to your
system PATH), in the project folder:

```powershell
npm install
npm run build:cpp
dir cpp-core
REM confirm recipe_engine.exe now appears in that listing

copy .env.example .env
REM edit .env in Notepad and set ANTHROPIC_API_KEY=... if you have one

npm start
REM -> AI Recipe Generator backend running at http://localhost:3000
```

If `npm run build:cpp` fails with a `curl.h` not found error, you're
most likely running it from the wrong MSYS2 terminal (it must be
**MSYS2 MinGW64**, not "MSYS2 MSYS" or "MSYS2 UCRT64") or the
`mingw-w64-x86_64-curl` package didn't finish installing — rerun the
`pacman -S` command above.

## 15. Environment Variables

See [`.env.example`](.env.example) for every variable with comments. All are optional; unparseable or out-of-range values fall back to safe defaults.

| Group | Variables |
|---|---|
| Server | `PORT`, `ENGINE_TIMEOUT_MS`, `JSON_BODY_LIMIT`, `REQUEST_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS`, `KEEPALIVE_TIMEOUT_MS` |
| LLM providers | `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, `GOOGLE_API_KEY`/`GOOGLE_MODEL`, `OPENAI_API_KEY`/`OPENAI_MODEL`, `GROQ_API_KEY`/`GROQ_MODEL`, `LOCAL_LLM_URL`/`LOCAL_LLM_MODEL` |
| Sessions | `SESSION_TTL_HOURS` (default 8), `SESSION_IDLE_MINUTES` (default 60, 0 = off), `COOKIE_SECURE` |
| Rate limits | `RATE_API_*`, `RATE_GEN_*`, `RATE_COMPARE_*`, `RATE_BENCHMARK_PER_MIN`, `RATE_AUTH_PER_MIN`, `LOGIN_MAX_FAILURES`, `LOGIN_MAX_FAILURES_PER_IP`, `LOGIN_LOCK_MINUTES` |
| Network | `CORS_ORIGINS` (empty = same-origin only), `TRUST_PROXY_HOPS` (0 = none) |

With no provider key at all, the app still works using the database and the offline template generator. Keys are read server-side only; only an allow-list of variables is passed to the C++ engine, and keys never reach the frontend, logs, events or responses.

To create the first administrator: `npm run create-admin -- <username>` (password from `ADMIN_PASSWORD`, a hidden prompt, or stdin). Use `--promote` to promote an existing account.

## 16. How to Run the Frontend

The frontend is plain static HTML/CSS/JS and is served automatically by
the Express server from the `frontend/` directory — there is no
separate frontend build step. Once `npm start` is running, visit
`http://localhost:3000`.

## 17. How to Run the Backend

```bash
npm start
# or, equivalently:
node backend/server.js
```

This starts Express on `PORT` (default 3000), mounts the recipe API at
`/api/recipes`, exposes `/api/health`, and serves the frontend as static
files.

## 18. How to Compile the C++ Core

```bash
npm run build:cpp
```

This runs `scripts/build-cpp.js`, a small cross-platform wrapper that
invokes g++ with the correct output filename for your OS:
`cpp-core/recipe_engine` on Linux/macOS, `cpp-core/recipe_engine.exe`
on Windows. `backend/services/cppBridge.js` looks for that same
platform-correct name at runtime. Under the hood it runs:

```bash
g++ -std=c++17 -O2 -Wall cpp-core/main.cpp \
  cpp-core/models/Recipe.cpp cpp-core/models/TraditionalRecipe.cpp \
  cpp-core/models/AIRecipe.cpp cpp-core/models/User.cpp \
  cpp-core/models/RecipePreferences.cpp \
  cpp-core/validation/Validator.cpp \
  cpp-core/engine/RecipeMatcher.cpp cpp-core/engine/RecipeCustomizer.cpp \
  cpp-core/generators/DatabaseGenerator.cpp cpp-core/generators/AIGenerator.cpp \
  cpp-core/storage/RecipeStorage.cpp \
  -lcurl -o cpp-core/recipe_engine[.exe]
```

You can also run the compiled binary directly, without Node.js at all,
which is useful for demonstrating the OOP core standalone in a viva:

```bash
# Linux/macOS
echo '{"preferences":{"ingredients":["paneer","tomato"],"cuisine":"Indian","mealType":"Dinner","dietaryPreference":"Vegetarian","cookingTime":30,"difficulty":"Medium","servings":2}}' \
  | ./cpp-core/recipe_engine generate ./data

# Windows (PowerShell)
'{"preferences":{"ingredients":["paneer","tomato"],"cuisine":"Indian","mealType":"Dinner","dietaryPreference":"Vegetarian","cookingTime":30,"difficulty":"Medium","servings":2}}' | .\cpp-core\recipe_engine.exe generate .\data
```

## 19. How AI Integration Works

Full detail is in [`docs/ai-architecture.md`](docs/ai-architecture.md). In short:

1. The request passes the C++ `SecurityPipeline` (input validation, prompt-injection and XSS detection). A rejection stops here; no model is called.
2. If a database recipe matches well enough (score and full ingredient coverage), it is used and no model is called.
3. Otherwise `AIGenerator` asks a `ModelRouter`, which tries Claude, Gemini, OpenAI, Groq, then Local, skipping any without a key.
4. Every answer is checked against a closed schema (`AIOutputValidator`) and assembled by `RecipeBuilder`. An invalid answer counts as a failure and the next provider is tried.
5. If every provider fails, the local template generator builds the recipe and the response is marked `usedFallback`.
6. `IngredientConsistencyChecker` compares the final recipe with the request and returns a `consistency` report that the Results page shows as a safety panel.

The AI Model Lab (`/api/ai/compare`) calls every available provider in parallel and shows real latency and evaluator scores per model. Providers without a key are shown as skipped, never scored.

## 20. Testing

See [`docs/testing.md`](docs/testing.md) for the test case table,
coverage matrix and known limits.

```bash
npm run test:cpp     # C++ suites (needs libcurl dev headers)
npm run test:node    # Node suites; HTTP-level tests need `npm install` (Express)
bash tests/run_tsan.sh   # ThreadSanitizer run of the concurrent-provider code
```

## 21. Future Scope

Not built yet (from the project spec):
- A `StorageRepository` abstraction (storage is a JSON file today).
- C++ `AlertManager` and `SecurityDashboard` observers, and a C++ `RateLimitChecker` (rate limiting is in Node).
- Rate limits and the login throttle that survive restarts and work across several instances (they are in-memory per process now).
- Single-model and multi-model strategy selection through the generate API.

Ideas: a larger recipe database, shopping lists, caching of repeated AI requests, multi-language recipes.

## Limitations of this repository's testing

Express-dependent HTTP tests, real provider calls and the real libcurl path have not been exercised in the environment this was built in; see `docs/testing.md`.

## Landing page and visual polish

- `frontend/landing.html` is the public front door (served at `/` by `backend/app.js`). Styles are in `css/landing.css`, behaviour in `js/landing.js`.
- Animations: a staged hero load, an illustration of the request path (one request validated, one blocked), count-up facts, and scroll reveals. All are switched off under `prefers-reduced-motion`; the illustration then shows its final state.
- `css/polish.css` is linked on every page: page-in, focus rings, skip link, button press, card hover, modal pop-in.
- Placeholders (each is labelled on the page): replace by dropping files at `frontend/assets/screens/generator.png`, `ai-lab.png`, `security.png` and `frontend/assets/demo.mp4`. The placeholder swaps itself for the file when it loads. Edit the bracketed team, guide, institution and source lines in `landing.html`.
- The numbers in the facts row are checked against the code by `tests/node/landing.test.js`.

The placeholder frames show illustrations from `frontend/assets/art/` (drawn as SVG in code, not screenshots), each captioned as an illustration. Real files at the paths above replace them automatically.

## Hosting

See `DEPLOY.md` (Render, with `Dockerfile` and `render.yaml`).
