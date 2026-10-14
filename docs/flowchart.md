# Data Flow & Flowcharts

## 1. Overall pipeline (as specified)

```
USER
 |
 v
WEB FRONTEND            (frontend/generator.html + generator.js)
 |
 v
REST API / BACKEND      (backend/routes/recipes.js -> controllers/recipeController.js)
 |
 v
C++ OOP CORE            (cpp-core/recipe_engine, invoked via services/cppBridge.js)
 |
 v
INPUT VALIDATOR         (validation/Validator.cpp)
 |
 v
RECIPE MATCHER          (engine/RecipeMatcher.cpp)
 |
 v
DATABASE GENERATOR  OR  AI GENERATOR     (generators/DatabaseGenerator.cpp | AIGenerator.cpp)
 |
 v
RECIPE OBJECT           (models/TraditionalRecipe.cpp | AIRecipe.cpp)
 |
 v
RECIPE CUSTOMIZER       (engine/RecipeCustomizer.cpp) -- only on customize/substitute/healthier/servings
 |
 v
RECIPE STORAGE          (storage/RecipeStorage.cpp) -- only on save/list/get/delete
 |
 v
WEB RESULT              (frontend/results.html)
```

## 2. Generate-recipe decision flowchart

```
                      +---------------------------+
                      | Receive RecipePreferences  |
                      +-------------+-------------+
                                    |
                                    v
                      +---------------------------+
                      | Validator::validate(prefs) |
                      +-------------+-------------+
                            |                 |
                       valid|                 |invalid
                            v                 v
              +---------------------+   +----------------------+
              | RecipeMatcher scores |   | throw ValidationExc. |
              | every DB recipe      |   | -> HTTP 400 JSON      |
              +----------+-----------+   +----------------------+
                         |
                         v
             +-------------------------+
             | bestScore >= threshold?  |
             |     (55 / 100)           |
             +------+------------+------+
                    | yes        | no
                    v            v
       +------------------+  +---------------------------+
       | DatabaseGenerator |  | AIGenerator.generateRecipe |
       | -> TraditionalRecipe| +-----------+----------------+
       +------------------+              |
                                          v
                             +-------------------------+
                             | ANTHROPIC_API_KEY set?    |
                             +------+-------------+------+
                                    | yes          | no
                                    v              v
                         +--------------------+  +-----------------------+
                         | callRealProvider()  |  | callFallbackProvider() |
                         | (libcurl -> Claude) |  | (local templates)      |
                         +---------+----------+  +------------+------------+
                                   |                            |
                             success|   failure                 |
                                    v      \_____________________|
                          +------------------+     (falls through on any
                          |  new AIRecipe     |      network/parse error)
                          +------------------+
```

## 3. Customization action flowchart (RecipeCustomizer.modifyRecipe)

```
   action string  ---->  RecipeCustomizer::modifyRecipe(recipe, action, argument)
                                |
             +------------------+-------------------+------------------+
             |                  |                   |                  |
        "substitute"       "healthier"          "servings"          (else)
             |                  |                   |                  |
             v                  v                   v                  v
   substituteIngredient   makeHealthier    changeServingSize(int)  throw
   - look up swap map     - apply known    - rescale ingredients   invalid_argument
   - replace ingredient     healthy swaps  - rescale nutrition
   - add substitution note - trim calories - clamp 1-12
                             /fat by ~15-25%
```

## 4. Testing / validation flow

```
Invalid input example (empty ingredients):

  Frontend: user clicks "Generate Recipe" with 0 ingredient chips
       -> generator.js shows inline "Please add at least one ingredient."
          (client-side, no request sent)

  API-layer bypass example (direct API call with empty array):
       -> validateGeneratePayload passes (array is valid shape)
       -> C++ Validator::validate() throws ValidationException(
            "EMPTY_INGREDIENTS", "Please enter at least one ingredient.")
       -> main.cpp catches it, responds:
            { "success": false,
              "error": { "code": "EMPTY_INGREDIENTS",
                         "message": "Please enter at least one ingredient." } }
       -> recipeController maps EMPTY_INGREDIENTS -> HTTP 400
```

## 5. Secured request flow (current)

```
Request
  |
  v
security headers -> request id -> CORS -> authenticate
  |
  v
rate limit ----(exceeded)----> 429, audit RATE_LIMIT
  |
  v
requirePermission ----(no)----> 401 / 403, audit UNAUTHORIZED_ACCESS
  |
  v
payload shape check ----(bad)----> 400
  |
  v
C++ engine
  |
  v
SecurityPipeline: InputValidator -> PromptInjectionDetector -> XSSDetector
  |  (any rejects)--> 400, event audited, STOP (no provider called)
  v
database match good enough? --yes--> TraditionalRecipe
  |no
  v
ModelRouter: Claude -> Gemini -> OpenAI -> Groq -> Local
  |   each answer: AIOutputValidator + RecipeBuilder
  |   (invalid / unavailable / error) --> next provider, event audited
  v
all failed? --yes--> offline template generator (usedFallback = true)
  |
  v
IngredientConsistencyChecker -> { recipe, matchInfo, consistency }
  |
  v
Node: record usage (successful signed-in requests only) -> JSON to browser
```

## 6. AI Model Lab comparison flow

```
POST /api/ai/compare  (login + ai-lab:use, compare rate limit)
  -> same input SecurityPipeline as generate
  -> ModelComparator: every AVAILABLE provider called in parallel (std::async)
  -> per model: AIOutputValidator -> RecipeBuilder -> RecipeEvaluator score
  -> fastest / best chosen only among validated replies
  -> Node records analytics and usage for models actually called
```

## 7. Login and session flow

```
POST /api/auth/login -> auth rate limit -> LoginThrottle check
  -> scrypt verify (dummy hash if user unknown)
  -> fail: AUTH_FAILURE audited, throttle count++
  -> ok: new random token; SHA hash stored server-side; HttpOnly SameSite=Strict cookie; AUTH_SUCCESS audited
Each later request: cookie -> hash -> session lookup -> expiry check -> req.auth.user
```
