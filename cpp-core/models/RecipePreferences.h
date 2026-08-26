#ifndef RECIPE_PREFERENCES_H
#define RECIPE_PREFERENCES_H

#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * RecipePreferences
 * -----------------------------------------------------------------------
 * A dedicated value object carrying one request's worth of user input
 * through the entire pipeline: Validator -> RecipeMatcher ->
 * DatabaseGenerator/AIGenerator -> RecipeCustomizer.
 *
 * Keeping this as its own class (rather than passing 7 loose parameters
 * around) is itself an OOP decision worth explaining in a viva: it keeps
 * function signatures stable as the pipeline grows and gives validation
 * a single object to check.
 */
class RecipePreferences {
private:
    std::vector<std::string> ingredients;
    std::string cuisine;
    std::string mealType;
    std::string dietaryPreference;
    int cookingTime;      // minutes
    std::string difficulty;
    int servings;

public:
    RecipePreferences();
    RecipePreferences(std::vector<std::string> ingredients,
                       std::string cuisine,
                       std::string mealType,
                       std::string dietaryPreference,
                       int cookingTime,
                       std::string difficulty,
                       int servings);

    const std::vector<std::string>& getIngredients() const;
    std::string getCuisine() const;
    std::string getMealType() const;
    std::string getDietaryPreference() const;
    int getCookingTime() const;
    std::string getDifficulty() const;
    int getServings() const;

    void setServings(int s);

    json toJson() const;
    static RecipePreferences fromJson(const json& j);
};

#endif // RECIPE_PREFERENCES_H
