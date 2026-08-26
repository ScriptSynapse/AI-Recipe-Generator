// Unit tests for RecipeCustomizer: substitution, healthier pass, and
// both overloads of changeServingSize.
#include <cassert>
#include <iostream>
#include "../cpp-core/engine/RecipeCustomizer.h"
#include "../cpp-core/models/TraditionalRecipe.h"

static std::unique_ptr<TraditionalRecipe> sampleRecipe() {
    std::vector<Ingredient> ingredients = {
        {"paneer", 200, "g"},
        {"cream", 2, "tbsp"},
        {"butter", 1, "tbsp"}
    };
    std::vector<std::string> instructions = {"Cook everything together."};
    NutritionInfo nutrition;
    nutrition.calories = 500; nutrition.proteinGrams = 20; nutrition.carbsGrams = 10; nutrition.fatGrams = 30;
    return std::make_unique<TraditionalRecipe>(
        "t1", "Test Recipe", "Indian", "Dinner", "Vegetarian",
        ingredients, instructions, 30, "Medium", 2, nutrition, 95.0
    );
}

int main() {
    // TC09: substituting an ingredient records a note and swaps the name.
    {
        auto recipe = sampleRecipe();
        RecipeCustomizer customizer;
        customizer.substituteIngredient(*recipe, "cream");
        bool found = false;
        for (const auto& ing : recipe->getIngredients()) {
            if (ing.name == "milk + cashew paste") found = true;
        }
        assert(found);
        assert(!recipe->getSubstitutionNotes().empty());
        std::cout << "TC09 passed: substituteIngredient() swaps cream for milk + cashew paste.\n";
    }

    // makeHealthier reduces calories/fat.
    {
        auto recipe = sampleRecipe();
        double before = recipe->getNutrition().calories;
        RecipeCustomizer customizer;
        customizer.makeHealthier(*recipe);
        assert(recipe->getNutrition().calories < before);
        std::cout << "Healthier test passed: calories reduced from " << before << " to " << recipe->getNutrition().calories << "\n";
    }

    // changeServingSize(int): 2 -> 4 doubles ingredient quantities.
    {
        auto recipe = sampleRecipe();
        RecipeCustomizer customizer;
        customizer.changeServingSize(*recipe, 4); // overload #1 (int)
        assert(recipe->getServings() == 4);
        for (const auto& ing : recipe->getIngredients()) {
            if (ing.name == "paneer") assert(ing.quantity == 400.0);
        }
        std::cout << "Serving-size (int overload) test passed.\n";
    }

    // changeServingSize(double): 1.5x multiplier from base 2 -> 3.
    {
        auto recipe = sampleRecipe();
        RecipeCustomizer customizer;
        customizer.changeServingSize(*recipe, 1.5); // overload #2 (double)
        assert(recipe->getServings() == 3);
        std::cout << "Serving-size (double multiplier overload) test passed.\n";
    }

    std::cout << "All RecipeCustomizer tests passed.\n";
    return 0;
}
