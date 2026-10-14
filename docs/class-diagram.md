# Class Diagram

This document describes the C++ OOP core's class hierarchy (`cpp-core/`).
Diagrams are given as ASCII art plus a written description of each
relationship, so they can be read without any external tooling.

## 1. Recipe hierarchy (Inheritance + Polymorphism)

```
                    +-------------------+
                    |      Recipe       |  (abstract)
                    |-------------------|
                    | # id, name        |
                    | # cuisine         |
                    | # ingredients     |
                    | # instructions    |
                    | # cookingTime     |
                    | # difficulty      |
                    | # servings        |
                    | # nutrition       |
                    |-------------------|
                    | + getX()/setX()   |
                    | + displayRecipe() |  (virtual, has default body)
                    | + generateInstr.()|  (pure virtual)
                    | + getSourceLabel()|  (pure virtual)
                    | + toJson()        |  (virtual)
                    +---------^---------+
                              |
              +---------------+----------------+
              |                                 |
   +---------------------+           +----------------------+
   |   TraditionalRecipe  |           |       AIRecipe        |
   |----------------------|           |------------------------|
   | - matchScore          |           | - aiProvider           |
   |----------------------|           | - usedFallback         |
   | + generateInstructions()|         |------------------------|
   | + getSourceLabel()      |         | + generateInstructions()|
   | + toJson()              |         | + getSourceLabel()      |
   +----------------------+           | + toJson()              |
                                       +------------------------+
```

`Recipe` cannot be instantiated (two pure virtual functions:
`generateInstructions()` and `getSourceLabel()`). `TraditionalRecipe`
represents a recipe pulled from the local JSON database (with an
associated match score from `RecipeMatcher`); `AIRecipe` represents a
recipe produced by `AIGenerator`, tracking which provider produced it
and whether the offline fallback template was used.

Polymorphism is exercised wherever code holds a `Recipe*` /
`std::unique_ptr<Recipe>` and calls `generateInstructions()` or
`getSourceLabel()` without knowing (or caring) which subclass it has —
see `DatabaseGenerator::generateRecipe()`, `AIGenerator::generateRecipe()`,
and `RecipeCustomizer`'s methods, all of which take `Recipe&`.

## 2. RecipeGenerator hierarchy (Strategy pattern / Abstraction)

```
                +------------------------+
                |    RecipeGenerator      |  (abstract interface)
                |------------------------|
                | + generateRecipe(prefs) |  (pure virtual)
                +-----------^------------+
                            |
          +------------------------------+
          |                              |
+------------------------+   +--------------------------+
|   DatabaseGenerator      |   |       AIGenerator         |
|------------------------|   |--------------------------|
| - matcher: RecipeMatcher |   | - apiKey, model            |
|------------------------|   |--------------------------|
| + generateRecipe(prefs) |   | + generateRecipe(prefs)    |
| + bestMatchFor(prefs)   |   | - callRealProvider(prefs)  |
+------------------------+   | - callFallbackProvider(prefs)|
                              | + hasApiKey()               |
                              +--------------------------+
```

`main.cpp` (the CLI orchestrator) depends only on the abstract
`RecipeGenerator` interface conceptually — in practice it holds one of
each concrete generator and picks which `generateRecipe()` to call based
on `RecipeMatcher`'s score vs. `DATABASE_MATCH_THRESHOLD`. This is what
lets "database vs AI" be swapped/extended without touching calling code
elsewhere in the pipeline.

## 3. Supporting classes (composition, not inheritance)

```
RecipePreferences  -- plain value object carried through the whole pipeline
User                -- encapsulated user profile / standing preferences
RecipeMatcher        -- scores RecipePreferences against a JSON database
RecipeCustomizer     -- mutates a Recipe& in place (substitute/healthier/servings)
RecipeStorage        -- file-backed persistence for saved recipes (fstream)
Validator            -- static validation rules + ValidationException hierarchy
```

## 4. Exception hierarchy

```
std::runtime_error
        |
        +-- ValidationException   (validation/Validator.h) -- carries a `code`
        +-- StorageException      (storage/RecipeStorage.h)
```

Both are caught centrally in `main.cpp`'s command dispatcher and turned
into the API's `{"success": false, "error": {code, message}}` JSON shape.

## 5. End-to-end object collaboration for `generate`

```
main.cpp
  -> RecipePreferences::fromJson(body)
  -> Validator::validate(prefs)                [throws ValidationException on bad input]
  -> DatabaseGenerator::bestMatchFor(prefs)
       -> RecipeMatcher::findBestMatch(prefs)
            -> scoreIngredients/scoreCuisine/scoreDiet/scoreCookingTime/scoreDifficulty
  -> if score >= threshold:
        DatabaseGenerator::generateRecipe(prefs) -> new TraditionalRecipe
     else:
        AIGenerator::generateRecipe(prefs)
           -> callRealProvider(prefs)   [if API key configured]
           -> callFallbackProvider(prefs) [on failure or no key] -> new AIRecipe
  -> recipe->toJson()
  -> printed to stdout, read by backend/services/cppBridge.js
```

## 6. RecipeTemplateEngine (offline fallback content generation)

`AIGenerator::callFallbackProvider()` delegates to
`RecipeTemplateEngine::generate()` to avoid producing the same generic
instructions for every dish. It's a pure classification/templating
utility (every method `static`, no instance state):

```
RecipeTemplateEngine::generate(preferences, rng)
  -> classifyAll(preferences.getIngredients())
       -> classifyIngredient() per ingredient, via keyword matching, into:
            Protein | Dairy | Grain | Vegetable | Fruit | Sweet | Liquid | Other
  -> determineDishMode(classification, preferences)
       -> Dessert    if mealType == Dessert, or sweets present with no protein
       -> Breakfast  if mealType == Breakfast
       -> Salad      if no protein/grain, raw produce present, quick + easy
       -> StirFry    if cuisine in {Chinese, Thai, Japanese} and time <= 40
       -> Simmer     if a liquid ingredient is present, or cuisine in
                      {Indian, Mexican, Mediterranean}
       -> General     otherwise (catch-all template)
  -> buildTitle(mode, classification, preferences)
  -> buildInstructions(mode, classification, preferences, rng)
       -> a distinct instruction sequence per DishMode, referencing the
          ACTUAL classified ingredient names (e.g. "Whisk the eggs with
          the sugar" vs. "Stir-fry the chicken and broccoli") rather
          than one fixed template with names substituted in
```

This only runs when `AIGenerator` falls back to the offline path (no
API key configured, or the real provider call failed) — a successful
real-AI call already produces dish-appropriate instructions on its own,
since the model reasons about the ingredients directly.

## 7. AI provider layer (Strategy, Template Method, Composite, Factory)

```
            +---------------------------+
            |   <<interface>> LLMProvider|
            |---------------------------|
            | generate(prompt) : string  |
            | getProviderName/ModelName  |
            | isAvailable() / getStatus()|
            | setEventManager(mgr)       |
            +------^----------^---------+
                   |          |
     +-------------+--+   +---+----------------+
     | HttpLLMProvider |   |    ModelRouter     |  Composite: owns an ordered
     |  (template)     |   |  chain of providers|  vector<shared_ptr<LLMProvider>>
     +--^--^--^--^--^--+   +--------------------+
        |  |  |  |  |
   Claude Gemini OpenAI Groq Local      each uses an injected HttpClient
                                        (CurlHttpClient | test fake)

LLMProviderFactory  --creates-->  LLMProvider by name
AIGenerator         --uses-->     LLMProvider (a ModelRouter in production)
AIOrchestrator      --runs-->     many providers concurrently -> vector<ModelResult>
ModelComparator     --uses-->     AIOrchestrator + AIOutputValidator + RecipeEvaluator
```

## 8. Security layer (Chain of Responsibility, Observer)

```
SecurityPipeline  ◇--> SecurityCheck (interface: check(SecurityContext) -> SecurityCheckResult)
                         ^
        +----------------+-------------------+-------------------+
 InputValidatorCheck  PromptInjectionDetectorCheck  XSSDetectorCheck  AIOutputValidatorCheck
   (wraps Validator)    (PromptSecurityScanner)      (XSSDetector)     (wraps AIOutputValidator)

SecurityEventFactory --creates--> SecurityEvent
SecurityEventManager (subject) --notifies--> SecurityEventObserver
        ResponseEventCollector (observer) -> events returned in the engine response
```

## 9. Recipe construction and evaluation

```
RecipeBuilder (Builder)  --build()-->  Recipe  (TraditionalRecipe | AIRecipe)
                           validates fields; throws ValidationException (RECIPE_* codes)
RecipeEvaluator            scores a Recipe against RecipePreferences; findDietConflicts()
IngredientConsistencyChecker (static check)  --> ConsistencyReport {missingRequired, additional, suspicious, dietConflicts}
RecipeStorage  ◆--> FileLock (RAII)           saved_recipes.json, temp file + atomic rename
```

Relationship key: ◆ composition (owner controls lifetime), ◇ aggregation, ^ inheritance/implementation.
Not built: `StorageRepository`, `AlertManager`, `SecurityDashboard` (C++), `RateLimitChecker` (C++), `IngredientSafetyChecker`.
