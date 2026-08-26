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
