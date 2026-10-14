#ifndef INGREDIENT_CONSISTENCY_CHECKER_H
#define INGREDIENT_CONSISTENCY_CHECKER_H

#include <string>
#include <vector>
#include "../models/Recipe.h"
#include "../models/RecipePreferences.h"

/*
 * One line of the user-facing "AI SAFETY CHECK" list.
 * status is "pass" or "warn"; label and detail are fixed text built from
 * counts and the recipe's own ingredient names -- never from user prose.
 */
struct ConsistencyCheck {
    std::string label;
    std::string status;
    std::string detail;
};

/*
 * IngredientConsistencyChecker -- compares what the USER asked for with
 * what the recipe actually contains.
 * -----------------------------------------------------------------------
 *   missingRequired  user ingredients that appear nowhere in the recipe
 *   additional       recipe ingredients matching none of the user's (and not
 *                    a near-universal staple: salt, water, pepper)
 *   suspicious       recipe ingredients that are not food (a short, explicit
 *                    list of household chemicals and poisons)
 *   dietConflicts    recipe ingredients that conflict with the requested diet
 *                    (shares RecipeEvaluator's keyword lists, so the two can't
 *                    disagree)
 *
 * Matching is case-insensitive substring in either direction, the same
 * convention RecipeMatcher uses. Like the evaluator it is a deliberately
 * short, explainable rule set, not a food database: false negatives are
 * possible, every flag is a concrete, inspectable reason.
 */
struct ConsistencyReport {
    std::vector<std::string> missingRequired;
    std::vector<std::string> additional;
    std::vector<std::string> suspicious;
    std::vector<std::string> dietConflicts;

    bool requiredRespected() const { return missingRequired.empty(); }
    bool dietRespected() const { return dietConflicts.empty(); }
    bool noUnsafeIngredients() const { return suspicious.empty(); }
    // True only when there is nothing at all to warn about.
    bool clean() const { return missingRequired.empty() && additional.empty() && suspicious.empty() && dietConflicts.empty(); }

    std::vector<ConsistencyCheck> checks() const;
    json toJson() const;
};

class IngredientConsistencyChecker {
public:
    static ConsistencyReport check(const Recipe& recipe, const RecipePreferences& preferences);
    static ConsistencyReport check(const std::vector<Ingredient>& recipeIngredients,
                                   const std::vector<std::string>& requestedIngredients,
                                   const std::string& dietaryPreference);
};

#endif // INGREDIENT_CONSISTENCY_CHECKER_H
