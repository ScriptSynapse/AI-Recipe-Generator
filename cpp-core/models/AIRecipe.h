#ifndef AI_RECIPE_H
#define AI_RECIPE_H

#include "Recipe.h"

/*
 * AIRecipe
 * -----------------------------------------------------------------------
 * A recipe produced by AIGenerator (either the real AI provider or the
 * local mock/fallback templates). Tracks provenance metadata that a
 * TraditionalRecipe doesn't need: which provider created it, and whether
 * the fallback generator had to be used.
 */
class AIRecipe : public Recipe {
private:
    std::string aiProvider;   // e.g. "anthropic-claude" or "fallback-mock"
    bool usedFallback;

public:
    AIRecipe(const std::string& id,
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
             const std::string& aiProvider,
             bool usedFallback);

    ~AIRecipe() override;

    std::string getAiProvider() const;
    bool didUseFallback() const;

    // Override: AI recipes may need a disclaimer/formatting pass applied
    // to freshly generated free-text instructions (e.g. trimming, adding
    // a generated-by-AI safety note) — different responsibility than
    // TraditionalRecipe's normalization pass.
    void generateInstructions() override;

    std::string getSourceLabel() const override;

    json toJson() const override;
};

#endif // AI_RECIPE_H
