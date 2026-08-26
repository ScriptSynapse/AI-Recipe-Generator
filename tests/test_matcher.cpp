// Simple assert-based unit tests for RecipeMatcher.
// Build: see tests/README or run `npm run test:cpp` from project root.
#include <cassert>
#include <iostream>
#include "../cpp-core/engine/RecipeMatcher.h"
#include "../cpp-core/models/RecipePreferences.h"

static std::vector<json> sampleDb() {
    return {
        json{
            {"id", "t1"}, {"name", "Paneer Tikka"}, {"cuisine", "Indian"},
            {"mealType", "Dinner"}, {"dietaryPreference", "Vegetarian"},
            {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2},
            {"ingredients", json::array({
                json{{"name","paneer"},{"quantity",200},{"unit","g"}},
                json{{"name","tomato"},{"quantity",2},{"unit","pieces"}}
            })},
            {"instructions", json::array({"Cook it."})},
            {"nutrition", json{{"calories",500},{"proteinGrams",20},{"carbsGrams",10},{"fatGrams",20},{"estimated",false}}}
        },
        json{
            {"id", "t2"}, {"name", "Chicken Curry"}, {"cuisine", "Indian"},
            {"mealType", "Dinner"}, {"dietaryPreference", "No Preference"},
            {"cookingTime", 40}, {"difficulty", "Hard"}, {"servings", 2},
            {"ingredients", json::array({
                json{{"name","chicken"},{"quantity",300},{"unit","g"}}
            })},
            {"instructions", json::array({"Cook it."})},
            {"nutrition", json{{"calories",600},{"proteinGrams",40},{"carbsGrams",10},{"fatGrams",30},{"estimated",false}}}
        }
    };
}

int main() {
    // TC01: Paneer + Tomato should surface the paneer recipe as best match.
    {
        RecipeMatcher matcher(sampleDb());
        RecipePreferences prefs({"paneer", "tomato"}, "Indian", "Dinner", "Vegetarian", 30, "Medium", 2);
        MatchResult best = matcher.findBestMatch(prefs);
        assert(best.recipeJson.value("id", "") == "t1");
        assert(best.score > 90.0);
        std::cout << "TC01 passed: paneer+tomato -> " << best.recipeJson.value("name", "") << " (" << best.score << ")\n";
    }

    // TC04: Vegetarian preference should hard-exclude the non-veg-flagged
    // recipe when it doesn't satisfy the diet.
    {
        RecipeMatcher matcher(sampleDb());
        RecipePreferences prefs({"chicken"}, "Indian", "Dinner", "Vegetarian", 40, "Hard", 2);
        auto matches = matcher.findMatches(prefs);
        for (const auto& m : matches) {
            assert(m.recipeJson.value("id", "") != "t2");
        }
        std::cout << "TC04 passed: vegetarian preference excludes non-vegetarian recipe\n";
    }

    // Cooking time scoring: a recipe within budget scores 100 on time.
    {
        RecipeMatcher matcher(sampleDb());
        RecipePreferences prefs({"paneer"}, "Indian", "Dinner", "No Preference", 60, "Medium", 2);
        auto matches = matcher.findMatches(prefs);
        assert(!matches.empty());
        assert(matches.front().timeScore == 100.0);
        std::cout << "TC05 passed: recipe within time budget scores full time-score\n";
    }

    std::cout << "All RecipeMatcher tests passed.\n";
    return 0;
}
