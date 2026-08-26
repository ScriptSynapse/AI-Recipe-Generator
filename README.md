# AI Recipe Generator

**An OOP Laboratory Project** — a full-stack recipe generation platform
with a genuine C++ object-oriented core, a Node.js/Express REST API,
and a vanilla HTML/CSS/JS frontend.

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
Browser --(fetch/JSON)--> Express API --(spawn + stdin/stdout JSON)--> C++ recipe_engine
                                                                          |
                                                          +---------------+---------------+
                                                          |                               |
                                                data/*.json (fstream)         api.anthropic.com (libcurl)
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

A recipe is served directly from the database if its score is `>= 55`
(`DATABASE_MATCH_THRESHOLD` in `main.cpp`); otherwise the request falls
through to `AIGenerator`.

### AI generation with fallback

```
if ANTHROPIC_API_KEY is set:
    try callRealProvider() -> builds a structured prompt from
        RecipePreferences, POSTs to api.anthropic.com/v1/messages
        via libcurl, parses the structured JSON reply into an AIRecipe
    on ANY failure (network, non-2xx, malformed JSON): fall through
callFallbackProvider() -> builds a complete, plausible recipe from
    local templates (no network dependency), tagged usedFallback=true
```

### Serving-size scaling

Every ingredient quantity and nutrition value is multiplied by
`newServings / oldServings`, rounded to 2 decimal places.

## 13. Project Structure

```
AI-Recipe-Generator/
├── frontend/            HTML5 + CSS3 + vanilla JS (4 pages)
├── backend/             Node.js + Express REST API
│   ├── server.js
│   ├── routes/recipes.js
│   ├── controllers/     recipeController.js, validateRequest.js
│   └── services/        cppBridge.js (spawns the C++ binary)
├── cpp-core/            The C++ OOP core
│   ├── models/           Recipe, TraditionalRecipe, AIRecipe, User, RecipePreferences
│   ├── generators/       RecipeGenerator, DatabaseGenerator, AIGenerator
│   ├── engine/           RecipeMatcher, RecipeCustomizer
│   ├── storage/          RecipeStorage
│   ├── validation/       Validator
│   ├── json.hpp          nlohmann/json single-header library
│   └── main.cpp          CLI entry point / orchestrator
├── data/                 recipes.json (seed DB), saved_recipes.json
├── tests/                C++ unit tests + run_tests.sh
├── docs/                 architecture.md, class-diagram.md, flowchart.md, testing.md
├── .env.example
├── package.json
└── README.md
```

## 14. Setup Instructions

Prerequisites: Node.js 18+, a C++17 compiler (g++), and `libcurl`
development headers.

```bash
# 1. Install Node dependencies
npm install

# 2. Install libcurl dev headers (Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y libcurl4-openssl-dev

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

Then open **http://localhost:3000** in a browser.

## 15. Environment Variables

See [`.env.example`](.env.example). Only two variables are used:

| Variable | Purpose | Required? |
|---|---|---|
| `PORT` | Port the Express server listens on | No (defaults to 3000) |
| `ANTHROPIC_API_KEY` | Enables real AI generation via `AIGenerator` | No — omit it to always use the offline fallback generator |

The key is read **only** inside the C++ `AIGenerator` (via
`std::getenv`), forwarded from Node's `process.env` to the spawned
subprocess in `cppBridge.js`. It is never sent to, or readable from,
the frontend.

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

which runs:

```bash
g++ -std=c++17 -O2 -Wall cpp-core/main.cpp \
  cpp-core/models/Recipe.cpp cpp-core/models/TraditionalRecipe.cpp \
  cpp-core/models/AIRecipe.cpp cpp-core/models/User.cpp \
  cpp-core/models/RecipePreferences.cpp \
  cpp-core/validation/Validator.cpp \
  cpp-core/engine/RecipeMatcher.cpp cpp-core/engine/RecipeCustomizer.cpp \
  cpp-core/generators/DatabaseGenerator.cpp cpp-core/generators/AIGenerator.cpp \
  cpp-core/storage/RecipeStorage.cpp \
  -lcurl -o cpp-core/recipe_engine
```

You can also run the compiled binary directly, without Node.js at all,
which is useful for demonstrating the OOP core standalone in a viva:

```bash
echo '{"preferences":{"ingredients":["paneer","tomato"],"cuisine":"Indian","mealType":"Dinner","dietaryPreference":"Vegetarian","cookingTime":30,"difficulty":"Medium","servings":2}}' \
  | ./cpp-core/recipe_engine generate ./data
```

## 19. How AI Integration Works

`cpp-core/generators/AIGenerator.cpp` is the single place AI generation
happens:

1. On construction, it reads `ANTHROPIC_API_KEY` from the environment.
2. `generateRecipe()` tries `callRealProvider()` **only if** a key is
   configured. This method builds a structured prompt from
   `RecipePreferences` (listing ingredients, cuisine, meal type, diet,
   time, difficulty, servings) and asks for a strict JSON schema back,
   then POSTs it to `https://api.anthropic.com/v1/messages` using
   `libcurl`, and parses the structured JSON response into an `AIRecipe`.
3. If that call fails for **any** reason (no key, network error,
   non-2xx response, malformed JSON) — or if no key was configured in
   the first place — `callFallbackProvider()` runs instead, building a
   complete, realistic recipe purely from local string templates, with
   zero network dependency. The resulting recipe is tagged
   `usedFallback: true`, and the frontend surfaces this via the
   "AI Generated Recipe (Offline Fallback)" source badge.
4. The provider is fully swappable: everything provider-specific lives
   inside `callRealProvider()`, so pointing this at a different AI
   vendor only requires changing that one method.

## 20. Testing

See [`docs/testing.md`](docs/testing.md) for the full test case table
(TC01-TC10) and captured output. Run the suite with:

```bash
npm run test:cpp
```

## 21. Future Scope

- User accounts and per-user saved-recipe collections (currently a
  single shared `saved_recipes.json`).
- A larger, curated recipe database (or a proper database engine
  instead of flat JSON) for higher-quality database matches.
- Image generation or photo upload for saved recipes.
- Multi-language recipe generation.
- A "shopping list" feature that diffs a recipe's ingredients against
  what the user already has.
- Caching of AI-generated recipes to reduce repeated API calls for
  near-identical requests.
