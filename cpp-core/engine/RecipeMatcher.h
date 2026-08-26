#ifndef RECIPE_MATCHER_H
#define RECIPE_MATCHER_H

#include <string>
#include <vector>
#include "../json.hpp"
#include "../models/RecipePreferences.h"

using json = nlohmann::json;

// One scored candidate from the local recipe database.
struct MatchResult {
    json recipeJson;   // raw database record
    double score = -1.0; // 0-100 total weighted score
    double ingredientScore = 0.0;
    double cuisineScore = 0.0;
    double dietScore = 0.0;
    double timeScore = 0.0;
    double difficultyScore = 0.0;
};

/*
 * RecipeMatcher
 * -----------------------------------------------------------------------
 * Searches the local recipe database (loaded as JSON) and scores every
 * candidate recipe against the user's RecipePreferences using a weighted
 * rubric:
 *
 *   Ingredient match   = 50%
 *   Cuisine match      = 20%
 *   Diet match         = 15%
 *   Cooking time       = 10%
 *   Difficulty         = 5%
 *
 * Returns candidates ranked highest score first. RecipeMatcher itself
 * does not decide database-vs-AI; that threshold decision lives in
 * main.cpp so it stays easily configurable/explainable.
 */
class RecipeMatcher {
private:
    std::vector<json> database;

    double scoreIngredients(const std::vector<std::string>& userIngredients,
                             const std::vector<std::string>& recipeIngredients) const;
    double scoreCuisine(const std::string& userCuisine, const std::string& recipeCuisine) const;
    double scoreDiet(const std::string& userDiet, const std::string& recipeDiet) const;
    double scoreCookingTime(int userTime, int recipeTime) const;
    double scoreDifficulty(const std::string& userDifficulty, const std::string& recipeDifficulty) const;

public:
    explicit RecipeMatcher(std::vector<json> database);

    // Returns all candidates from the database ranked by descending score.
    std::vector<MatchResult> findMatches(const RecipePreferences& preferences) const;

    // Convenience: best match, or nullopt-like (score < 0) if db empty.
    MatchResult findBestMatch(const RecipePreferences& preferences) const;
};

#endif // RECIPE_MATCHER_H
