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
