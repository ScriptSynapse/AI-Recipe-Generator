#include "RecipeMatcher.h"
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

double RecipeMatcher::scoreCookingTime(int userTime, int recipeTime) const {
    if (recipeTime <= userTime) return 100.0;
    int over = recipeTime - userTime;
    double penalty = (static_cast<double>(over) / std::max(userTime, 1)) * 100.0;
    return std::max(0.0, 100.0 - penalty);
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
        mr.cuisineScore = scoreCuisine(preferences.getCuisine(), recipe.value("cuisine", ""));
        mr.dietScore = scoreDiet(preferences.getDietaryPreference(), recipe.value("dietaryPreference", "No Preference"));
        mr.timeScore = scoreCookingTime(preferences.getCookingTime(), recipe.value("cookingTime", 30));
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
