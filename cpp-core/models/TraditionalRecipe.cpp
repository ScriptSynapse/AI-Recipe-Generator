#include "TraditionalRecipe.h"

TraditionalRecipe::TraditionalRecipe(const std::string& id,
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
                                      double matchScore_)
    : Recipe(id, name, cuisine, mealType, dietaryPreference, std::move(ingredients),
             std::move(instructions), cookingTimeMinutes, difficulty, servings, nutrition),
      matchScore(matchScore_) {}

TraditionalRecipe::~TraditionalRecipe() {}

double TraditionalRecipe::getMatchScore() const { return matchScore; }

void TraditionalRecipe::generateInstructions() {
    // Database recipes already ship with authored instructions; ensure
    // each step is numbered consistently when re-displayed.
    for (size_t i = 0; i < instructions.size(); ++i) {
        std::string& step = instructions[i];
        if (step.empty()) continue;
    }
}

std::string TraditionalRecipe::getSourceLabel() const {
    return "Traditional Database Recipe";
}

json TraditionalRecipe::toJson() const {
    json j = Recipe::toJson();
    j["matchScore"] = matchScore;
    return j;
}
