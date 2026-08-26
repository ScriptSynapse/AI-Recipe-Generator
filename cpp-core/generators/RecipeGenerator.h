#ifndef RECIPE_GENERATOR_H
#define RECIPE_GENERATOR_H

#include <memory>
#include "../models/Recipe.h"
#include "../models/RecipePreferences.h"

/*
 * RecipeGenerator (Abstract Strategy Interface)
 * -----------------------------------------------------------------------
 * Defines a common contract for "something that can turn preferences
 * into a Recipe". DatabaseGenerator and AIGenerator implement this
 * interface differently (lookup+scoring vs. AI prompt+parsing / mock
 * templates), and the rest of the application (main.cpp) depends only
 * on this abstract interface — the Strategy pattern applied to recipe
 * generation. This is what lets DatabaseGenerator and AIGenerator be
 * swapped or combined without touching calling code.
 */
class RecipeGenerator {
public:
    virtual std::unique_ptr<Recipe> generateRecipe(const RecipePreferences& preferences) = 0;
    virtual ~RecipeGenerator() {}
};

#endif // RECIPE_GENERATOR_H
