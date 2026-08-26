#include "RecipePreferences.h"

RecipePreferences::RecipePreferences()
    : cuisine("Other"), mealType("Dinner"), dietaryPreference("No Preference"),
      cookingTime(30), difficulty("Medium"), servings(2) {}

RecipePreferences::RecipePreferences(std::vector<std::string> ingredients_,
                                      std::string cuisine_,
                                      std::string mealType_,
                                      std::string dietaryPreference_,
                                      int cookingTime_,
                                      std::string difficulty_,
                                      int servings_)
    : ingredients(std::move(ingredients_)), cuisine(std::move(cuisine_)),
      mealType(std::move(mealType_)), dietaryPreference(std::move(dietaryPreference_)),
      cookingTime(cookingTime_), difficulty(std::move(difficulty_)), servings(servings_) {}

const std::vector<std::string>& RecipePreferences::getIngredients() const { return ingredients; }
std::string RecipePreferences::getCuisine() const { return cuisine; }
std::string RecipePreferences::getMealType() const { return mealType; }
std::string RecipePreferences::getDietaryPreference() const { return dietaryPreference; }
int RecipePreferences::getCookingTime() const { return cookingTime; }
std::string RecipePreferences::getDifficulty() const { return difficulty; }
int RecipePreferences::getServings() const { return servings; }

void RecipePreferences::setServings(int s) { servings = s; }

json RecipePreferences::toJson() const {
    return json{
        {"ingredients", ingredients},
        {"cuisine", cuisine},
        {"mealType", mealType},
        {"dietaryPreference", dietaryPreference},
        {"cookingTime", cookingTime},
        {"difficulty", difficulty},
        {"servings", servings}
    };
}

RecipePreferences RecipePreferences::fromJson(const json& j) {
    std::vector<std::string> ingredients;
    if (j.contains("ingredients") && j["ingredients"].is_array()) {
        for (const auto& i : j["ingredients"]) ingredients.push_back(i.get<std::string>());
    }
    return RecipePreferences(
        ingredients,
        j.value("cuisine", "Other"),
        j.value("mealType", "Dinner"),
        j.value("dietaryPreference", "No Preference"),
        j.value("cookingTime", 30),
        j.value("difficulty", "Medium"),
        j.value("servings", 2)
    );
}
