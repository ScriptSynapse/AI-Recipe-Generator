#ifndef RECIPE_EVALUATOR_H
#define RECIPE_EVALUATOR_H

#include <string>
#include <vector>
#include "../models/Recipe.h"
#include "../models/RecipePreferences.h"
#include "RecipeEvaluation.h"

/*
 * RecipeEvaluator -- Phase F.
 * -----------------------------------------------------------------------
 * Scores an already-PARSED recipe (any Recipe -- traditional or AI
 * generated; evaluate() takes the abstract base, so this is genuine
 * polymorphism, not an AIRecipe-only tool) against the user's stated
 * preferences, across the 8 criteria named in the spec:
 *
 *   1. Ingredient compatibility  -> scoreIngredientCompatibility()
 *   2. Dietary compliance        -> scoreDietCompliance()
 *   3. Cooking-time compliance   -> scoreCookingTimeCompliance()
 *   4. Instruction completeness  -> scoreInstructionCompleteness()
 *   5. Nutrition consistency     -> scoreNutritionConsistency()
 *   8. Safety flags              -> scoreSafety()
 *
 * (6. "JSON/schema validity" and 7. "ingredient consistency" in the spec
 * are schema- and diff-level checks that belong to AIOutputValidator and
 * IngredientConsistencyChecker respectively (see those classes).
 * RecipeEvaluator only ever sees a recipe that already parsed
 * successfully into a Recipe object, so by the time it runs, #6 has
 * necessarily already passed.)
 *
 * Every sub-score is computed from something actually inspectable on the
 * recipe (its ingredient list, instruction text, timing, macros) -- never
 * a fabricated or hard-coded number, per the project's "do not fake AI
 * functionality" / "do not hard-code fake benchmark results" requirement.
 * Two things are deliberately OUT of scope here, and said so in the
 * relevant method's comment, rather than faked:
 *   - "Dietary compliance" for High Protein / Low Carb has no ingredient-
 *     exclusion list (there isn't one -- it's a macro target, not a list
 *     of banned foods), so those two diets always score 100 here.
 *   - "Nutrition consistency" checks that the stated macros and calories
 *     roughly agree with each other (an internal consistency check) --
 *     RecipeEvaluator has no external nutrition database to check the
 *     numbers' real-world accuracy against, and does not pretend to.
 *
 * Each check is a public static method so it can be unit-tested in
 * isolation and reused later (e.g. by IngredientConsistencyChecker,
 * Phase 6) without re-running the full evaluation.
 */
class RecipeEvaluator {
public:
    static RecipeEvaluation evaluate(const Recipe& recipe, const RecipePreferences& preferences);

    // Fraction of the USER-REQUESTED ingredients that actually appear in
    // the recipe (case-insensitive substring match, same convention as
    // RecipeMatcher). 100 if the user requested none (nothing to violate).
    static double scoreIngredientCompatibility(const std::vector<Ingredient>& recipeIngredients,
                                               const std::vector<std::string>& requestedIngredients);

    // Scans the recipe's OWN ingredient list for items that conflict with
    // the requested diet (e.g. "chicken" in a Vegetarian recipe), rather
    // than trusting any dietary label the recipe itself claims. Appends a
    // specific warning per conflicting ingredient found.
    static double scoreDietCompliance(const std::vector<Ingredient>& recipeIngredients,
                                      const std::string& dietaryPreference,
                                      std::vector<std::string>& warningsOut);

    // Names of the recipe's own ingredients that conflict with the diet
    // (same keyword lists scoreDietCompliance uses). Empty for diets with
    // nothing checkable ("No Preference", High Protein, Low Carb).
    static std::vector<std::string> findDietConflicts(const std::vector<Ingredient>& recipeIngredients,
                                                      const std::string& dietaryPreference);

    // Thin wrapper over ScoringUtil::cookingTimeComplianceScore (shared
    // with RecipeMatcher) so this rubric can't drift from the database
    // matcher's.
    static double scoreCookingTimeCompliance(int requestedMinutes, int actualMinutes);

    // Rewards more (and non-trivially short) steps; flags steps too short
    // to plausibly describe a real cooking action.
    static double scoreInstructionCompleteness(const std::vector<std::string>& instructions,
                                               std::vector<std::string>& warningsOut);

    // Checks that calories are internally consistent with the stated
    // macros (protein*4 + carbs*4 + fat*9 should roughly equal calories),
    // and that no value is negative.
    static double scoreNutritionConsistency(const NutritionInfo& nutrition,
                                            std::vector<std::string>& warningsOut);

    // Flags a specific, checkable food-safety structural issue: a raw
    // animal-protein ingredient present with no instruction step
    // describing any cooking action at all.
    static double scoreSafety(const std::vector<Ingredient>& recipeIngredients,
                              const std::vector<std::string>& instructions,
                              std::vector<std::string>& warningsOut);

private:
    // Weights sum to 1.0. Safety and diet compliance are weighted highest
    // since a safety or allergy-relevant diet violation matters more than
    // a slightly-off nutrition estimate or terse instructions.
    static constexpr double WEIGHT_INGREDIENT = 0.20;
    static constexpr double WEIGHT_DIET = 0.25;
    static constexpr double WEIGHT_INSTRUCTION = 0.15;
    static constexpr double WEIGHT_NUTRITION = 0.15;
    static constexpr double WEIGHT_SAFETY = 0.25;
};

#endif // RECIPE_EVALUATOR_H
