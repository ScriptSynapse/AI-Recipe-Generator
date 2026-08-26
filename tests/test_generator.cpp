// Unit tests for DatabaseGenerator and AIGenerator (offline fallback path).
#include <cassert>
#include <iostream>
#include "../cpp-core/generators/DatabaseGenerator.h"
#include "../cpp-core/generators/AIGenerator.h"
#include "../cpp-core/models/RecipePreferences.h"
#include "../cpp-core/models/TraditionalRecipe.h"
#include "../cpp-core/models/AIRecipe.h"

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
        }
    };
}

int main() {
    // TC01/TC08 groundwork: DatabaseGenerator returns a TraditionalRecipe
    // and scales servings correctly.
    {
        DatabaseGenerator gen(sampleDb());
        RecipePreferences prefs({"paneer", "tomato"}, "Indian", "Dinner", "Vegetarian", 30, "Medium", 4);
        auto recipe = gen.generateRecipe(prefs);
        assert(recipe->getSourceLabel() == "Traditional Database Recipe");
        assert(recipe->getServings() == 4);
        // Original db recipe used 200g paneer for 2 servings -> 400g for 4.
        bool foundScaled = false;
        for (const auto& ing : recipe->getIngredients()) {
            if (ing.name == "paneer") { assert(ing.quantity == 400.0); foundScaled = true; }
        }
        assert(foundScaled);
        std::cout << "TC-DB-01 passed: DatabaseGenerator scales servings correctly.\n";
    }

    // TC10: no database match (empty DB) -> AIGenerator must still return
    // a usable recipe via the offline fallback (no ANTHROPIC_API_KEY set
    // in this test process).
    {
        AIGenerator aiGen;
        RecipePreferences prefs({"dragonfruit", "kimchi"}, "Other", "Snack", "Vegan", 20, "Easy", 2);
        auto recipe = aiGen.generateRecipe(prefs);
        assert(recipe->getSourceLabel().find("AI") != std::string::npos);
        assert(!recipe->getIngredients().empty());
        assert(!recipe->getInstructions().empty());
        std::cout << "TC10 passed: AIGenerator (fallback) produced a usable recipe: " << recipe->getName() << "\n";
    }

    std::cout << "All generator tests passed.\n";
    return 0;
}
