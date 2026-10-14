#ifndef RECIPE_EVALUATION_H
#define RECIPE_EVALUATION_H

#include <cmath>
#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * RecipeEvaluation -- the structured result of RecipeEvaluator::evaluate().
 * Every score below is 0-100 and computed from an actual, inspectable
 * property of the recipe (never fabricated); `warnings` explains exactly
 * which checks found a problem, in plain language.
 */
struct RecipeEvaluation {
    double ingredientScore = 0.0;
    double dietScore = 0.0;
    double instructionScore = 0.0;
    double nutritionScore = 0.0;
    double safetyScore = 0.0;
    double overallScore = 0.0;
    std::vector<std::string> warnings;

    json toJson() const {
        auto rounded = [](double v) { return static_cast<int>(std::lround(v)); };
        return json{
            {"ingredientScore", rounded(ingredientScore)},
            {"dietScore", rounded(dietScore)},
            {"instructionScore", rounded(instructionScore)},
            {"nutritionScore", rounded(nutritionScore)},
            {"safetyScore", rounded(safetyScore)},
            {"overallScore", rounded(overallScore)},
            {"warnings", warnings},
        };
    }
};

#endif // RECIPE_EVALUATION_H
