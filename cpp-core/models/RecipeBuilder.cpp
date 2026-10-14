#include "RecipeBuilder.h"
#include <atomic>
#include <cctype>
#include "AIRecipe.h"
#include "TraditionalRecipe.h"
#include "../validation/Validator.h"

namespace {

std::string generatedId() {
    static std::atomic<unsigned long> counter{0};
    return "recipe-" + std::to_string(++counter);
}

bool blank(const std::string& s) {
    for (unsigned char c : s) if (!std::isspace(c)) return false;
    return true;
}

} // namespace

RecipeBuilder& RecipeBuilder::withId(const std::string& v) { id = v; return *this; }
RecipeBuilder& RecipeBuilder::withName(const std::string& v) { name = v; return *this; }
RecipeBuilder& RecipeBuilder::withIngredients(const std::vector<Ingredient>& v) { ingredients = v; return *this; }
RecipeBuilder& RecipeBuilder::withInstructions(const std::vector<std::string>& v) { instructions = v; return *this; }
RecipeBuilder& RecipeBuilder::withNutrition(const NutritionInfo& v) { nutrition = v; return *this; }
RecipeBuilder& RecipeBuilder::withCuisine(const std::string& v) { cuisine = v; return *this; }
RecipeBuilder& RecipeBuilder::withMealType(const std::string& v) { mealType = v; return *this; }
RecipeBuilder& RecipeBuilder::withDiet(const std::string& v) { diet = v; return *this; }
RecipeBuilder& RecipeBuilder::withCookingTime(int v) { cookingTime = v; return *this; }
RecipeBuilder& RecipeBuilder::withDifficulty(const std::string& v) { difficulty = v; return *this; }
RecipeBuilder& RecipeBuilder::withServings(int v) { servings = v; return *this; }
RecipeBuilder& RecipeBuilder::withSubstitutionNotes(const std::vector<std::string>& v) { substitutionNotes = v; return *this; }

RecipeBuilder& RecipeBuilder::asTraditional(double score) { ai = false; matchScore = score; return *this; }
RecipeBuilder& RecipeBuilder::asAI(const std::string& provider, bool fallback) {
    ai = true; aiProvider = provider; usedFallback = fallback; return *this;
}

std::unique_ptr<Recipe> RecipeBuilder::build() const {
    if (blank(name)) throw ValidationException("RECIPE_NAME", "A recipe needs a name.");
    if (ingredients.empty()) throw ValidationException("RECIPE_INGREDIENTS", "A recipe needs at least one ingredient.");
    for (const auto& ing : ingredients) {
        if (blank(ing.name)) throw ValidationException("RECIPE_INGREDIENTS", "Every ingredient needs a name.");
        if (!(ing.quantity >= 0.0)) throw ValidationException("RECIPE_INGREDIENTS", "Ingredient quantities cannot be negative.");
    }
    if (instructions.empty()) throw ValidationException("RECIPE_INSTRUCTIONS", "A recipe needs at least one instruction.");
    for (const auto& step : instructions) {
        if (blank(step)) throw ValidationException("RECIPE_INSTRUCTIONS", "Instruction steps cannot be empty.");
    }
    if (cookingTime < 1 || cookingTime > 480) throw ValidationException("RECIPE_TIME", "Cooking time must be between 1 and 480 minutes.");
    if (servings < 1 || servings > 12) throw ValidationException("RECIPE_SERVINGS", "Servings must be between 1 and 12.");
    if (!Validator::isValidDifficulty(difficulty)) throw ValidationException("RECIPE_DIFFICULTY", "Unsupported difficulty.");
    if (!Validator::isValidDiet(diet)) throw ValidationException("RECIPE_DIET", "Unsupported dietary preference.");
    if (!cuisine.empty() && !Validator::isValidCuisine(cuisine)) throw ValidationException("RECIPE_CUISINE", "Unsupported cuisine.");
    if (!mealType.empty() && !Validator::isValidMealType(mealType)) throw ValidationException("RECIPE_MEAL_TYPE", "Unsupported meal type.");
    if (ai && blank(aiProvider)) throw ValidationException("RECIPE_PROVIDER", "An AI recipe needs a provider name.");

    const std::string finalId = id.empty() ? generatedId() : id;
    std::unique_ptr<Recipe> recipe;
    if (ai) {
        recipe = std::make_unique<AIRecipe>(finalId, name, cuisine, mealType, diet, ingredients, instructions,
                                            cookingTime, difficulty, servings, nutrition, aiProvider, usedFallback);
    } else {
        recipe = std::make_unique<TraditionalRecipe>(finalId, name, cuisine, mealType, diet, ingredients, instructions,
                                                     cookingTime, difficulty, servings, nutrition, matchScore);
    }
    for (const auto& note : substitutionNotes) recipe->addSubstitutionNote(note);
    return recipe;
}
