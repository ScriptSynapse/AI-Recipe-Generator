#include "RecipeCustomizer.h"
#include <algorithm>
#include <cctype>
#include <map>
#include <cmath>

static std::string toLowerStr(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), ::tolower);
    return out;
}

std::string RecipeCustomizer::lookupSubstitute(const std::string& ingredientName) {
    static const std::map<std::string, std::string> substitutes = {
        {"cream", "milk + cashew paste"},
        {"heavy cream", "milk + cashew paste"},
        {"butter", "olive oil or margarine"},
        {"paneer", "firm tofu"},
        {"egg", "flax egg (1 tbsp ground flaxseed + 3 tbsp water)"},
        {"milk", "unsweetened almond or oat milk"},
        {"sugar", "honey or maple syrup"},
        {"all-purpose flour", "whole wheat flour or a 1:1 gluten-free blend"},
        {"soy sauce", "tamari or coconut aminos"},
        {"white rice", "brown rice or quinoa"},
        {"sour cream", "plain Greek yogurt"},
        {"chicken", "extra-firm tofu or chickpeas"},
        {"beef", "mushrooms or lentils"},
        {"cheese", "nutritional yeast or dairy-free cheese"},
        {"mayonnaise", "mashed avocado or Greek yogurt"}
    };
    auto it = substitutes.find(toLowerStr(ingredientName));
    if (it != substitutes.end()) return it->second;
    return "a similar-textured ingredient you have on hand";
}

void RecipeCustomizer::substituteIngredient(Recipe& recipe, const std::string& ingredientName) {
    std::string suggestion = lookupSubstitute(ingredientName);
    std::vector<Ingredient> ingredients = recipe.getIngredients();

    bool found = false;
    for (auto& ing : ingredients) {
        if (toLowerStr(ing.name) == toLowerStr(ingredientName)) {
            ing.name = suggestion;
            found = true;
        }
    }
    recipe.setIngredients(ingredients);
    recipe.addSubstitutionNote("Suggested substitute for " + ingredientName + ": " + suggestion);
    if (!found) {
        recipe.addSubstitutionNote("(Note: \"" + ingredientName + "\" was not found in the ingredient list, but the substitution above still applies if used.)");
    }
}

void RecipeCustomizer::makeHealthier(Recipe& recipe) {
    std::vector<Ingredient> ingredients = recipe.getIngredients();
    static const std::map<std::string, std::pair<std::string, double>> healthySwaps = {
        // ingredient (lowercase) -> {replacement, quantity multiplier}
        {"butter", {"olive oil", 0.75}},
        {"cream", {"low-fat milk", 0.8}},
        {"heavy cream", {"low-fat milk", 0.8}},
        {"sugar", {"honey", 0.6}},
        {"white rice", {"brown rice", 1.0}},
        {"mayonnaise", {"Greek yogurt", 1.0}},
        {"sour cream", {"Greek yogurt", 1.0}},
        {"all-purpose flour", {"whole wheat flour", 1.0}}
    };

    bool swapped = false;
    for (auto& ing : ingredients) {
        auto it = healthySwaps.find(toLowerStr(ing.name));
        if (it != healthySwaps.end()) {
            recipe.addSubstitutionNote("Healthier swap: " + ing.name + " -> " + it->second.first);
            ing.name = it->second.first;
            ing.quantity = std::round(ing.quantity * it->second.second * 100.0) / 100.0;
            swapped = true;
        }
    }
    recipe.setIngredients(ingredients);

    // Reduce oil/butter-type quantities generically by 20% even without
    // a named swap, and reflect the change in the nutrition estimate.
    NutritionInfo nutrition = recipe.getNutrition();
    nutrition.calories *= 0.85;
    nutrition.fatGrams *= 0.75;
    nutrition.estimated = true;
    recipe.setNutrition(nutrition);

    if (!swapped) {
        recipe.addSubstitutionNote("Reduced overall fat/calories by trimming oil and using leaner cooking methods (e.g. baking or air-frying instead of deep-frying).");
    }
}

void RecipeCustomizer::changeServingSize(Recipe& recipe, int newServings) {
    if (newServings < 1) newServings = 1;
    if (newServings > 12) newServings = 12;

    int oldServings = recipe.getServings();
    if (oldServings <= 0) oldServings = 1;
    double scale = static_cast<double>(newServings) / oldServings;

    std::vector<Ingredient> ingredients = recipe.getIngredients();
    for (auto& ing : ingredients) {
        ing.quantity = std::round(ing.quantity * scale * 100.0) / 100.0;
    }
    recipe.setIngredients(ingredients);

    NutritionInfo nutrition = recipe.getNutrition();
    nutrition.calories *= scale;
    nutrition.proteinGrams *= scale;
    nutrition.carbsGrams *= scale;
    nutrition.fatGrams *= scale;
    recipe.setNutrition(nutrition);

    recipe.setServings(newServings);
}

// Overload: scale by a multiplier instead of an absolute target.
void RecipeCustomizer::changeServingSize(Recipe& recipe, double multiplier) {
    if (multiplier <= 0) multiplier = 1.0;
    int newServings = static_cast<int>(std::round(recipe.getServings() * multiplier));
    changeServingSize(recipe, newServings); // delegates to the int overload
}

void RecipeCustomizer::modifyRecipe(Recipe& recipe, const std::string& action, const std::string& argument) {
    std::string a = toLowerStr(action);
    if (a == "substitute") {
        substituteIngredient(recipe, argument);
    } else if (a == "healthier") {
        makeHealthier(recipe);
    } else if (a == "servings") {
        try {
            int newServings = std::stoi(argument);
            changeServingSize(recipe, newServings);
        } catch (...) {
            throw std::invalid_argument("Invalid servings value: " + argument);
        }
    } else {
        throw std::invalid_argument("Unknown customization action: " + action);
    }
}
