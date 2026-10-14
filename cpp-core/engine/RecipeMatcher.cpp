#include "RecipeMatcher.h"
#include "../utils/ScoringUtil.h"
#include <algorithm>
#include <cctype>
#include <cmath>

RecipeMatcher::RecipeMatcher(std::vector<json> database_) : database(std::move(database_)) {}

static std::string toLower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), ::tolower);
    return out;
}

// Ingredient overlap: fraction of the user's ingredients that appear
// (as substrings, case-insensitively) somewhere in the recipe's
// ingredient list. This rewards recipes that use what the user already
// has, which is the app's core value proposition.
double RecipeMatcher::scoreIngredients(const std::vector<std::string>& userIngredients,
                                       const std::vector<std::string>& recipeIngredients) const {
    if (userIngredients.empty()) return 0.0;

    std::vector<std::string> recipeLower;
    for (const auto& r : recipeIngredients) recipeLower.push_back(toLower(r));

    int matched = 0;
    for (const auto& userIng : userIngredients) {
        std::string u = toLower(userIng);
        bool found = std::any_of(recipeLower.begin(), recipeLower.end(), [&](const std::string& r) {
            return r.find(u) != std::string::npos || u.find(r) != std::string::npos;
        });
        if (found) matched++;
    }
    return (static_cast<double>(matched) / userIngredients.size()) * 100.0;
}

// Coverage is the reverse direction of scoreIngredients: what fraction of
// the RECIPE's own ingredient list is something the user actually has.
// A recipe that calls for 6 ingredients when the user only listed 3 has
// low coverage even if every one of the user's 3 ingredients is used.
double RecipeMatcher::computeIngredientCoverage(const std::vector<std::string>& userIngredients,
                                                const std::vector<std::string>& recipeIngredients) const {
    if (recipeIngredients.empty()) return 0.0;

    std::vector<std::string> userLower;
    for (const auto& u : userIngredients) userLower.push_back(toLower(u));

    // A short list of near-universal seasonings/staples that don't count
    // against coverage -- almost every kitchen has these, and requiring
    // a user to explicitly type "salt" and "water" for every recipe
    // would be an unreasonable bar for "uses only my ingredients".
    static const std::vector<std::string> impliedStaples = {
        "salt", "water", "black pepper", "pepper"
    };

    int covered = 0;
    for (const auto& recipeIng : recipeIngredients) {
        std::string r = toLower(recipeIng);
        bool isStaple = std::any_of(impliedStaples.begin(), impliedStaples.end(), [&](const std::string& s) {
            return r.find(s) != std::string::npos;
        });
        bool found = isStaple || std::any_of(userLower.begin(), userLower.end(), [&](const std::string& u) {
            return r.find(u) != std::string::npos || u.find(r) != std::string::npos;
        });
        if (found) covered++;
    }
    return (static_cast<double>(covered) / recipeIngredients.size()) * 100.0;
}

double RecipeMatcher::scoreCuisine(const std::string& userCuisine, const std::string& recipeCuisine) const {
    if (toLower(userCuisine) == toLower(recipeCuisine)) return 100.0;
    if (toLower(userCuisine) == "other") return 60.0; // user has no strong preference
    return 0.0;
}

double RecipeMatcher::scoreDiet(const std::string& userDiet, const std::string& recipeDiet) const {
    std::string u = toLower(userDiet);
    std::string r = toLower(recipeDiet);
    if (u == "no preference") return 100.0;
    if (u == r) return 100.0;
    // Vegan recipes automatically satisfy a vegetarian request, etc.
    if (u == "vegetarian" && r == "vegan") return 90.0;
    return 0.0;
}

double RecipeMatcher::scoreDifficulty(const std::string& userDifficulty, const std::string& recipeDifficulty) const {
    static const std::vector<std::string> order = {"easy", "medium", "hard"};
    auto rank = [](const std::string& d) {
        std::string lower = toLower(d);
        for (size_t i = 0; i < order.size(); ++i) if (order[i] == lower) return static_cast<int>(i);
        return 1;
    };
    int diff = std::abs(rank(userDifficulty) - rank(recipeDifficulty));
    if (diff == 0) return 100.0;
    if (diff == 1) return 50.0;
    return 0.0;
}

std::vector<MatchResult> RecipeMatcher::findMatches(const RecipePreferences& preferences) const {
    std::vector<MatchResult> results;

    for (const auto& recipe : database) {
        std::vector<std::string> recipeIngredients;
        if (recipe.contains("ingredients")) {
            for (const auto& ing : recipe["ingredients"]) {
                recipeIngredients.push_back(ing.value("name", ""));
            }
        }

        MatchResult mr;
        mr.recipeJson = recipe;
        mr.ingredientScore = scoreIngredients(preferences.getIngredients(), recipeIngredients);
        mr.ingredientCoverage = computeIngredientCoverage(preferences.getIngredients(), recipeIngredients);
        mr.cuisineScore = scoreCuisine(preferences.getCuisine(), recipe.value("cuisine", ""));
        mr.dietScore = scoreDiet(preferences.getDietaryPreference(), recipe.value("dietaryPreference", "No Preference"));
        mr.timeScore = ScoringUtil::cookingTimeComplianceScore(preferences.getCookingTime(), recipe.value("cookingTime", 30));
        mr.difficultyScore = scoreDifficulty(preferences.getDifficulty(), recipe.value("difficulty", "Medium"));

        // Weighted rubric: ingredients 50%, cuisine 20%, diet 15%, time 10%, difficulty 5%.
        mr.score = mr.ingredientScore * 0.50
                 + mr.cuisineScore * 0.20
                 + mr.dietScore * 0.15
                 + mr.timeScore * 0.10
                 + mr.difficultyScore * 0.05;

        // A recipe that violates the dietary preference (score 0) is
        // hard-excluded regardless of everything else, since serving
        // e.g. meat to a vegan user is not an acceptable "close match".
        if (mr.dietScore <= 0.0 && toLower(preferences.getDietaryPreference()) != "no preference") {
            continue;
        }

        results.push_back(mr);
    }

    std::sort(results.begin(), results.end(), [](const MatchResult& a, const MatchResult& b) {
        return a.score > b.score;
    });

    return results;
}

MatchResult RecipeMatcher::findBestMatch(const RecipePreferences& preferences) const {
    auto matches = findMatches(preferences);
    if (matches.empty()) {
        MatchResult empty;
        empty.score = -1.0;
        return empty;
    }
    return matches.front();
}
