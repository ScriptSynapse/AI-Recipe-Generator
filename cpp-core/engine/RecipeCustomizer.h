#ifndef RECIPE_CUSTOMIZER_H
#define RECIPE_CUSTOMIZER_H

#include <memory>
#include <string>
#include "../models/Recipe.h"

/*
 * RecipeCustomizer
 * -----------------------------------------------------------------------
 * Operates on an existing Recipe object (via base-class pointer/reference
 * — another example of polymorphism, since it works identically whether
 * handed a TraditionalRecipe or AIRecipe) to apply user-requested edits
 * in place: substitutions, a "healthier" pass, and serving-size scaling.
 *
 * Function overloading: two overloads of changeServingSize() are
 * provided — one that takes an absolute new serving count, and one that
 * takes a multiplier — to demonstrate overload resolution by parameter
 * type/count.
 */
class RecipeCustomizer {
private:
    // Small built-in substitution knowledge base: ingredient -> suggestion.
    static std::string lookupSubstitute(const std::string& ingredientName);

public:
    // Suggests and records a substitute for `ingredientName`, replacing
    // it in the ingredient list if a known substitute exists.
    void substituteIngredient(Recipe& recipe, const std::string& ingredientName);

    // Applies a small set of "healthier" transformations: trims added
    // fat/sugar-heavy ingredients, notes swaps, and shaves an estimated
    // percentage off calories/fat to reflect the change.
    void makeHealthier(Recipe& recipe);

    // Overload 1: scale to an explicit new serving count.
    void changeServingSize(Recipe& recipe, int newServings);

    // Overload 2: scale by a multiplier (e.g. 1.5x). Demonstrates
    // function overloading — same name, different parameter meaning.
    void changeServingSize(Recipe& recipe, double multiplier);

    // Generic entry point used by the /api/recipes/customize route,
    // dispatching to one of the above based on a string action.
    void modifyRecipe(Recipe& recipe, const std::string& action, const std::string& argument);
};

#endif // RECIPE_CUSTOMIZER_H
