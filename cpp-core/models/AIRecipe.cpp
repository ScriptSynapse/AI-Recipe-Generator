#include "AIRecipe.h"

AIRecipe::AIRecipe(const std::string& id,
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
                    const std::string& aiProvider_,
                    bool usedFallback_)
    : Recipe(id, name, cuisine, mealType, dietaryPreference, std::move(ingredients),
             std::move(instructions), cookingTimeMinutes, difficulty, servings, nutrition),
      aiProvider(aiProvider_), usedFallback(usedFallback_) {}

AIRecipe::~AIRecipe() {}

std::string AIRecipe::getAiProvider() const { return aiProvider; }
bool AIRecipe::didUseFallback() const { return usedFallback; }

void AIRecipe::generateInstructions() {
    // Strip any leading/trailing whitespace the AI model may have added
    // and drop empty lines so the step list is clean for the frontend.
    std::vector<std::string> cleaned;
    for (auto s : instructions) {
        size_t start = s.find_first_not_of(" \t\r\n");
        size_t end = s.find_last_not_of(" \t\r\n");
        if (start == std::string::npos) continue;
        cleaned.push_back(s.substr(start, end - start + 1));
    }
    instructions = cleaned;
}

std::string AIRecipe::getSourceLabel() const {
    return usedFallback ? "AI Generated Recipe (Offline Fallback)" : "AI Generated Recipe";
}

json AIRecipe::toJson() const {
    json j = Recipe::toJson();
    j["aiProvider"] = aiProvider;
    j["usedFallback"] = usedFallback;
    return j;
}
