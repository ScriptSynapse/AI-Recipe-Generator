#ifndef RECIPE_TEMPLATE_ENGINE_H
#define RECIPE_TEMPLATE_ENGINE_H

#include <string>
#include <vector>
#include <random>
#include "../models/RecipePreferences.h"

/*
 * RecipeTemplateEngine
 * -----------------------------------------------------------------------
 * Used only by AIGenerator's offline fallback path (AIGenerator.cpp),
 * this class is what keeps fallback recipes from all reading like the
 * same 7 generic steps with different nouns swapped in.
 *
 * It does two things:
 *   1. Classifies each user-supplied ingredient into a food category
 *      (protein, vegetable, grain/starch, dairy, fruit, sweet/baking,
 *      liquid/sauce, or other) using keyword matching.
 *   2. Picks a DishMode from that classification plus the requested
 *      meal type and cuisine (dessert / breakfast / salad / stir-fry /
 *      simmered-curry / general), then builds a title and an
 *      instruction sequence written specifically for that mode,
 *      referencing the actual classified ingredients by name (e.g.
 *      "Whisk the eggs and sugar" for a dessert vs. "Stir-fry the
 *      onion and capsicum" for a stir-fry) rather than one-size-fits-all
 *      wording.
 *
 * This is a pure classification/templating utility with no state of its
 * own -- every method is static -- so it's used as
 * RecipeTemplateEngine::generate(...) without instantiation.
 */
class RecipeTemplateEngine {
public:
    struct GeneratedContent {
        std::string title;
        std::vector<std::string> instructions;
    };

    // Builds a title and instruction sequence tailored to the given
    // preferences' ingredients, cuisine, and meal type. `rng` supplies
    // controlled randomness so repeated calls (e.g. via "Regenerate")
    // can vary phrasing/ordering without becoming unpredictable.
    static GeneratedContent generate(const RecipePreferences& preferences, std::mt19937& rng);

private:
    enum class Category { Protein, Dairy, Grain, Vegetable, Fruit, Sweet, Liquid, Other };
    enum class DishMode { Dessert, Breakfast, Salad, StirFry, Simmer, General };

    struct Classification {
        std::vector<std::string> proteins;
        std::vector<std::string> dairy;
        std::vector<std::string> grains;
        std::vector<std::string> vegetables;
        std::vector<std::string> fruits;
        std::vector<std::string> sweets;
        std::vector<std::string> liquids;
        std::vector<std::string> other;
    };

    static Category classifyIngredient(const std::string& ingredientLower);
    static Classification classifyAll(const std::vector<std::string>& ingredients);
    static DishMode determineDishMode(const Classification& c, const RecipePreferences& preferences);
    static std::string joinWithAnd(const std::vector<std::string>& items);
    static std::string pickOne(const std::vector<std::string>& options, std::mt19937& rng);

    static std::string buildTitle(DishMode mode, const Classification& c, const RecipePreferences& preferences);
    static std::vector<std::string> buildInstructions(DishMode mode, const Classification& c,
                                                        const RecipePreferences& preferences, std::mt19937& rng);
};

#endif // RECIPE_TEMPLATE_ENGINE_H
