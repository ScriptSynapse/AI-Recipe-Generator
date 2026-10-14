#include "RecipeEvaluator.h"
#include "../utils/ScoringUtil.h"
#include <algorithm>
#include <cmath>

namespace {

std::string toLower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), ::tolower);
    return out;
}

std::string toLowerJoined(const std::vector<std::string>& lines) {
    std::string out;
    for (const auto& line : lines) { out += toLower(line); out += ' '; }
    return out;
}

bool anyContains(const std::string& haystack, const std::vector<std::string>& needles) {
    return std::any_of(needles.begin(), needles.end(),
                       [&](const std::string& n) { return haystack.find(n) != std::string::npos; });
}

// Diet -> ingredient keywords that conflict with it. Deliberately a short,
// defensible list of common/clear-cut conflicts (not an exhaustive food
// database) -- false negatives are possible, but every flagged item is a
// genuine, explainable conflict, never a guess.
const std::vector<std::string>& conflictKeywordsFor(const std::string& dietLower) {
    static const std::vector<std::string> none;
    static const std::vector<std::string> meatAndFish = {
        "chicken", "beef", "pork", "fish", "shrimp", "prawn", "meat",
        "mutton", "lamb", "turkey", "bacon", "sausage", "anchovy", "gelatin"};
    static const std::vector<std::string> veganExclusions = {
        "chicken", "beef", "pork", "fish", "shrimp", "prawn", "meat",
        "mutton", "lamb", "turkey", "bacon", "sausage", "anchovy", "gelatin",
        "milk", "cheese", "paneer", "butter", "cream", "yogurt", "yoghurt", "ghee", "honey", "egg"};
    static const std::vector<std::string> glutenExclusions = {
        "wheat", "flour", "maida", "bread", "pasta", "noodle", "barley", "rye"};
    static const std::vector<std::string> dairyExclusions = {
        "milk", "cheese", "paneer", "butter", "cream", "yogurt", "yoghurt", "ghee"};

    if (dietLower == "vegetarian") return meatAndFish;
    if (dietLower == "vegan") return veganExclusions;
    if (dietLower == "gluten free") return glutenExclusions;
    if (dietLower == "dairy free") return dairyExclusions;
    // "High Protein" / "Low Carb" are macro targets, not ingredient
    // exclusion lists -- there is nothing to scan for, so no keywords.
    return none;
}

const std::vector<std::string>& rawProteinKeywords() {
    static const std::vector<std::string> keywords = {
        "chicken", "beef", "pork", "fish", "shrimp", "prawn", "meat",
        "mutton", "lamb", "turkey", "bacon", "sausage", "egg"};
    return keywords;
}

const std::vector<std::string>& cookingVerbs() {
    static const std::vector<std::string> verbs = {
        "cook", "cooked", "cooking", "heat", "heated", "boil", "boiled", "boiling",
        "fry", "fried", "frying", "bake", "baked", "baking", "roast", "roasted",
        "grill", "grilled", "simmer", "simmered", "saute", "sauté", "sautéed",
        "sear", "seared", "steam", "steamed", "microwave", "pressure cook", "stir-fry", "stir fry"};
    return verbs;
}

} // namespace

double RecipeEvaluator::scoreIngredientCompatibility(const std::vector<Ingredient>& recipeIngredients,
                                                     const std::vector<std::string>& requestedIngredients) {
    if (requestedIngredients.empty()) return 100.0;

    std::vector<std::string> recipeNamesLower;
    for (const auto& ing : recipeIngredients) recipeNamesLower.push_back(toLower(ing.name));

    int matched = 0;
    for (const auto& requested : requestedIngredients) {
        std::string r = toLower(requested);
        bool found = std::any_of(recipeNamesLower.begin(), recipeNamesLower.end(), [&](const std::string& ing) {
            return ing.find(r) != std::string::npos || r.find(ing) != std::string::npos;
        });
        if (found) ++matched;
    }
    return (static_cast<double>(matched) / requestedIngredients.size()) * 100.0;
}

double RecipeEvaluator::scoreDietCompliance(const std::vector<Ingredient>& recipeIngredients,
                                            const std::string& dietaryPreference,
                                            std::vector<std::string>& warningsOut) {
    std::string dietLower = toLower(dietaryPreference);
    if (dietLower == "no preference") return 100.0;

    const auto& conflicts = conflictKeywordsFor(dietLower);
    if (conflicts.empty()) return 100.0;   // nothing checkable for this diet (e.g. High Protein)

    int strikes = 0;
    for (const auto& ing : recipeIngredients) {
        std::string nameLower = toLower(ing.name);
        if (anyContains(nameLower, conflicts)) {
            ++strikes;
            warningsOut.push_back("Ingredient '" + ing.name + "' conflicts with a " + dietaryPreference + " diet.");
        }
    }
    if (strikes == 0) return 100.0;
    // A single diet violation is a serious failure (e.g. meat in a
    // vegetarian recipe), not a minor deduction -- first strike drops
    // the score well below a typical "pass" threshold.
    return std::max(0.0, 100.0 - 50.0 - 20.0 * (strikes - 1));
}

std::vector<std::string> RecipeEvaluator::findDietConflicts(const std::vector<Ingredient>& recipeIngredients,
                                                            const std::string& dietaryPreference) {
    std::vector<std::string> found;
    const auto& conflicts = conflictKeywordsFor(toLower(dietaryPreference));
    if (conflicts.empty()) return found;
    for (const auto& ing : recipeIngredients) {
        if (anyContains(toLower(ing.name), conflicts)) found.push_back(ing.name);
    }
    return found;
}

double RecipeEvaluator::scoreCookingTimeCompliance(int requestedMinutes, int actualMinutes) {
    return ScoringUtil::cookingTimeComplianceScore(requestedMinutes, actualMinutes);
}

double RecipeEvaluator::scoreInstructionCompleteness(const std::vector<std::string>& instructions,
                                                     std::vector<std::string>& warningsOut) {
    if (instructions.empty()) {
        warningsOut.push_back("Recipe has no instructions.");
        return 0.0;
    }

    double base = std::min(100.0, static_cast<double>(instructions.size()) * 20.0);

    int tooShortCount = 0;
    for (const auto& step : instructions) {
        size_t start = step.find_first_not_of(" \t\r\n");
        size_t end = step.find_last_not_of(" \t\r\n");
        std::string trimmed = (start == std::string::npos) ? "" : step.substr(start, end - start + 1);
        if (trimmed.size() < 8) ++tooShortCount;
    }
    if (tooShortCount > 0) {
        warningsOut.push_back(std::to_string(tooShortCount) +
                              " instruction step(s) are too short to describe a real action.");
    }

    return std::max(0.0, base - tooShortCount * 15.0);
}

double RecipeEvaluator::scoreNutritionConsistency(const NutritionInfo& nutrition,
                                                  std::vector<std::string>& warningsOut) {
    if (nutrition.calories < 0 || nutrition.proteinGrams < 0
        || nutrition.carbsGrams < 0 || nutrition.fatGrams < 0) {
        warningsOut.push_back("Nutrition values cannot be negative.");
        return 0.0;
    }
    if (nutrition.calories <= 0) {
        warningsOut.push_back("Recipe reports zero or missing calories.");
        return 0.0;
    }

    double computedCalories = nutrition.proteinGrams * 4.0 + nutrition.carbsGrams * 4.0 + nutrition.fatGrams * 9.0;
    double diffRatio = std::abs(nutrition.calories - computedCalories) / std::max(nutrition.calories, 1.0);

    if (diffRatio <= 0.15) return 100.0;
    if (diffRatio <= 0.30) return 70.0;
    if (diffRatio <= 0.50) {
        warningsOut.push_back("Stated calories do not closely match protein/carb/fat macros.");
        return 40.0;
    }
    warningsOut.push_back("Stated calories are substantially inconsistent with protein/carb/fat macros.");
    return 10.0;
}

double RecipeEvaluator::scoreSafety(const std::vector<Ingredient>& recipeIngredients,
                                    const std::vector<std::string>& instructions,
                                    std::vector<std::string>& warningsOut) {
    bool hasRawProtein = std::any_of(recipeIngredients.begin(), recipeIngredients.end(), [](const Ingredient& ing) {
        return anyContains(toLower(ing.name), rawProteinKeywords());
    });

    if (instructions.empty()) {
        warningsOut.push_back("Cannot verify cooking safety: no instructions provided.");
        return hasRawProtein ? 20.0 : 60.0;
    }

    bool hasCookingVerb = anyContains(toLowerJoined(instructions), cookingVerbs());
    if (hasRawProtein && !hasCookingVerb) {
        warningsOut.push_back(
            "Recipe includes a raw animal-protein ingredient, but no instruction step describes cooking it.");
        return 35.0;
    }
    return 100.0;
}

RecipeEvaluation RecipeEvaluator::evaluate(const Recipe& recipe, const RecipePreferences& preferences) {
    RecipeEvaluation eval;

    eval.ingredientScore = scoreIngredientCompatibility(recipe.getIngredients(), preferences.getIngredients());
    eval.dietScore = scoreDietCompliance(recipe.getIngredients(), preferences.getDietaryPreference(), eval.warnings);
    double timeScore = scoreCookingTimeCompliance(preferences.getCookingTime(), recipe.getCookingTime());
    eval.instructionScore = scoreInstructionCompleteness(recipe.getInstructions(), eval.warnings);
    eval.nutritionScore = scoreNutritionConsistency(recipe.getNutrition(), eval.warnings);
    eval.safetyScore = scoreSafety(recipe.getIngredients(), recipe.getInstructions(), eval.warnings);

    // Cooking-time compliance is folded into the overall score alongside
    // the others but isn't one of the 5 headline sub-scores the spec's
    // JSON example names -- it still needs to pull overallScore down when
    // a recipe blows the user's time budget, so it gets its own weight
    // share taken out of the ingredient/instruction weights (the two
    // least safety-critical categories) rather than a 6th top-level field.
    eval.overallScore =
        eval.ingredientScore * (WEIGHT_INGREDIENT - 0.05)
        + eval.dietScore * WEIGHT_DIET
        + timeScore * 0.10
        + eval.instructionScore * (WEIGHT_INSTRUCTION - 0.05)
        + eval.nutritionScore * WEIGHT_NUTRITION
        + eval.safetyScore * WEIGHT_SAFETY;

    if (timeScore < 50.0) {
        eval.warnings.push_back("Recipe's cooking time significantly exceeds the requested budget.");
    }

    return eval;
}
