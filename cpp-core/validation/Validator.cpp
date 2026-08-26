#include "Validator.h"
#include <algorithm>
#include <cctype>

const std::vector<std::string> Validator::VALID_CUISINES = {
    "Indian", "Italian", "Chinese", "Mexican", "American",
    "Mediterranean", "Japanese", "Thai", "Other"
};

const std::vector<std::string> Validator::VALID_MEAL_TYPES = {
    "Breakfast", "Lunch", "Dinner", "Snack", "Dessert"
};

const std::vector<std::string> Validator::VALID_DIFFICULTIES = {
    "Easy", "Medium", "Hard"
};

const std::vector<std::string> Validator::VALID_DIETS = {
    "No Preference", "Vegetarian", "Vegan", "Gluten Free",
    "Dairy Free", "High Protein", "Low Carb"
};

static bool containsCaseInsensitive(const std::vector<std::string>& list, const std::string& value) {
    std::string lowerValue = value;
    std::transform(lowerValue.begin(), lowerValue.end(), lowerValue.begin(), ::tolower);
    for (const auto& item : list) {
        std::string lowerItem = item;
        std::transform(lowerItem.begin(), lowerItem.end(), lowerItem.begin(), ::tolower);
        if (lowerItem == lowerValue) return true;
    }
    return false;
}

bool Validator::isValidCuisine(const std::string& cuisine) {
    return containsCaseInsensitive(VALID_CUISINES, cuisine);
}
bool Validator::isValidMealType(const std::string& mealType) {
    return containsCaseInsensitive(VALID_MEAL_TYPES, mealType);
}
bool Validator::isValidDifficulty(const std::string& difficulty) {
    return containsCaseInsensitive(VALID_DIFFICULTIES, difficulty);
}
bool Validator::isValidDiet(const std::string& diet) {
    return containsCaseInsensitive(VALID_DIETS, diet);
}

void Validator::validate(const RecipePreferences& prefs) {
    // 1. Ingredients must not be empty.
    if (prefs.getIngredients().empty()) {
        throw ValidationException("EMPTY_INGREDIENTS", "Please enter at least one ingredient.");
    }
    for (const auto& ing : prefs.getIngredients()) {
        if (ing.find_first_not_of(" \t\r\n") == std::string::npos) {
            throw ValidationException("BLANK_INGREDIENT", "Ingredient names cannot be blank.");
        }
    }

    // 2. Cuisine must be one of the supported options.
    if (!isValidCuisine(prefs.getCuisine())) {
        throw ValidationException("INVALID_CUISINE", "Please select a valid cuisine.");
    }

    // 3. Meal type must be valid.
    if (!isValidMealType(prefs.getMealType())) {
        throw ValidationException("INVALID_MEAL_TYPE", "Please select a valid meal type.");
    }

    // 4. Dietary preference must be valid.
    if (!isValidDiet(prefs.getDietaryPreference())) {
        throw ValidationException("INVALID_DIET", "Please select a valid dietary preference.");
    }

    // 5. Cooking time must be positive and within a sane bound.
    if (prefs.getCookingTime() <= 0) {
        throw ValidationException("INVALID_COOKING_TIME", "Invalid cooking time.");
    }
    if (prefs.getCookingTime() > 480) {
        throw ValidationException("INVALID_COOKING_TIME", "Cooking time is unrealistically long.");
    }

    // 6. Difficulty must be valid.
    if (!isValidDifficulty(prefs.getDifficulty())) {
        throw ValidationException("INVALID_DIFFICULTY", "Please select a valid difficulty.");
    }

    // 7. Servings must be within 1-12.
    if (prefs.getServings() < 1 || prefs.getServings() > 12) {
        throw ValidationException("INVALID_SERVINGS", "Servings must be between 1 and 12.");
    }
}
