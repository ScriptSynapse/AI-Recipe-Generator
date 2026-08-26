#ifndef TRADITIONAL_RECIPE_H
#define TRADITIONAL_RECIPE_H

#include "Recipe.h"

/*
 * TraditionalRecipe
 * -----------------------------------------------------------------------
 * A recipe retrieved (and possibly lightly adapted) from the local
 * recipe database via DatabaseGenerator / RecipeMatcher.
 *
 * Demonstrates inheritance: reuses all of Recipe's storage and getters,
 * and only supplies the two pieces of behavior that differ from an
 * AI-authored recipe.
 */
class TraditionalRecipe : public Recipe {
private:
    double matchScore; // similarity score assigned by RecipeMatcher (0-100)

public:
    TraditionalRecipe(const std::string& id,
                       const std::string& name,
                       const std::string& cuisine,
                       const std::string& mealType,
                       const std::string& dietaryPreference,
                       std::vector<Ingredient> ingredients,
                       std::vector<std::string> instructions,
                       int cookingTimeMinutes,
                       const std::string& difficulty,
                       int servings,
                       NutritionInfo nutrition,
                       double matchScore);

    ~TraditionalRecipe() override;

    double getMatchScore() const;

    // Override: database recipes already have authored instructions, so
    // "generating" them just means normalizing formatting/numbering
    // rather than composing prose from scratch (that's AIRecipe's job).
    void generateInstructions() override;

    std::string getSourceLabel() const override;

    json toJson() const override;
};

#endif // TRADITIONAL_RECIPE_H
