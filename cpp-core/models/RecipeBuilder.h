#ifndef RECIPE_BUILDER_H
#define RECIPE_BUILDER_H

#include <memory>
#include <string>
#include <vector>
#include "Recipe.h"

/*
 * RecipeBuilder -- Builder pattern.
 * -----------------------------------------------------------------------
 * Recipe's constructors take eleven positional arguments (twelve for
 * TraditionalRecipe/AIRecipe), several of the same type, which is easy to
 * get wrong silently (swap cuisine and meal type and it still compiles).
 * The builder names every field, supplies defaults for the optional ones,
 * and VALIDATES the finished recipe in build(), so an invalid Recipe object
 * cannot be constructed through it.
 *
 *   auto recipe = RecipeBuilder()
 *       .withName("Kadai Paneer").withIngredients({...}).withInstructions({...})
 *       .withCookingTime(30).build();                       // TraditionalRecipe
 *   auto ai = RecipeBuilder()...asAI("claude", false).build();   // AIRecipe
 *
 * Defaults: diet "No Preference", difficulty "Medium", servings 2, empty
 * nutrition (estimated), and a generated id if none is given.
 * Validation (ValidationException, code RECIPE_*):
 *   name non-empty; >= 1 ingredient, each with a name and a non-negative
 *   quantity; >= 1 non-empty instruction; cooking time 1..480; servings
 *   1..12; difficulty and diet from the Validator lists; cuisine and meal
 *   type, when given, from the Validator lists.
 * Error messages are fixed text -- they never echo the supplied values.
 */
class RecipeBuilder {
public:
    RecipeBuilder& withId(const std::string& id);
    RecipeBuilder& withName(const std::string& name);
    RecipeBuilder& withIngredients(const std::vector<Ingredient>& ingredients);
    RecipeBuilder& withInstructions(const std::vector<std::string>& instructions);
    RecipeBuilder& withNutrition(const NutritionInfo& nutrition);
    RecipeBuilder& withCuisine(const std::string& cuisine);
    RecipeBuilder& withMealType(const std::string& mealType);
    RecipeBuilder& withDiet(const std::string& diet);
    RecipeBuilder& withCookingTime(int minutes);
    RecipeBuilder& withDifficulty(const std::string& difficulty);
    RecipeBuilder& withServings(int servings);
    RecipeBuilder& withSubstitutionNotes(const std::vector<std::string>& notes);

    // Choose the concrete type. Default is a TraditionalRecipe.
    RecipeBuilder& asTraditional(double matchScore = 0.0);
    RecipeBuilder& asAI(const std::string& provider, bool usedFallback);

    // Validates and constructs. Throws ValidationException.
    std::unique_ptr<Recipe> build() const;

private:
    std::string id;
    std::string name;
    std::string cuisine;
    std::string mealType;
    std::string diet = "No Preference";
    std::vector<Ingredient> ingredients;
    std::vector<std::string> instructions;
    int cookingTime = 30;
    std::string difficulty = "Medium";
    int servings = 2;
    NutritionInfo nutrition;
    std::vector<std::string> substitutionNotes;
    bool ai = false;
    std::string aiProvider;
    bool usedFallback = true;
    double matchScore = 0.0;
};

#endif // RECIPE_BUILDER_H
