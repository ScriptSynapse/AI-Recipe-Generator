#include "DatabaseGenerator.h"
#include "../models/TraditionalRecipe.h"
#include <stdexcept>
#include <cmath>

DatabaseGenerator::DatabaseGenerator(std::vector<json> database) : matcher(std::move(database)) {}

MatchResult DatabaseGenerator::bestMatchFor(const RecipePreferences& preferences) const {
    return matcher.findBestMatch(preferences);
}

std::unique_ptr<Recipe> DatabaseGenerator::generateRecipe(const RecipePreferences& preferences) {
    MatchResult best = matcher.findBestMatch(preferences);
    if (best.score < 0) {
        throw std::runtime_error("No recipes available in local database.");
    }
    return generateFromMatch(preferences, best);
}

std::unique_ptr<Recipe> DatabaseGenerator::generateFromMatch(const RecipePreferences& preferences, const MatchResult& best) const {
    const json& r = best.recipeJson;

    std::vector<Ingredient> ingredients;
    double baseServings = r.value("servings", 2);
    double scale = baseServings > 0 ? static_cast<double>(preferences.getServings()) / baseServings : 1.0;
    if (r.contains("ingredients")) {
        for (const auto& ij : r["ingredients"]) {
            Ingredient ing = Ingredient::fromJson(ij);
            ing.quantity = std::round(ing.quantity * scale * 100.0) / 100.0;
            ingredients.push_back(ing);
        }
    }

    std::vector<std::string> instructions;
    if (r.contains("instructions")) {
        for (const auto& step : r["instructions"]) instructions.push_back(step.get<std::string>());
    }

    NutritionInfo nutrition;
    if (r.contains("nutrition")) {
        double factor = scale;
        nutrition.calories = r["nutrition"].value("calories", 0.0) * factor;
        nutrition.proteinGrams = r["nutrition"].value("proteinGrams", 0.0) * factor;
        nutrition.carbsGrams = r["nutrition"].value("carbsGrams", 0.0) * factor;
        nutrition.fatGrams = r["nutrition"].value("fatGrams", 0.0) * factor;
        nutrition.estimated = r["nutrition"].value("estimated", true);
    }

    auto recipe = std::make_unique<TraditionalRecipe>(
        r.value("id", "db-recipe"),
        r.value("name", "Database Recipe"),
        r.value("cuisine", preferences.getCuisine()),
        r.value("mealType", preferences.getMealType()),
        r.value("dietaryPreference", preferences.getDietaryPreference()),
        ingredients,
        instructions,
        r.value("cookingTime", preferences.getCookingTime()),
        r.value("difficulty", preferences.getDifficulty()),
        preferences.getServings(),
        nutrition,
        best.score
    );

    // Exercise the polymorphic hook even though TraditionalRecipe's
    // implementation is a light normalization pass.
    recipe->generateInstructions();

    return recipe;
}
