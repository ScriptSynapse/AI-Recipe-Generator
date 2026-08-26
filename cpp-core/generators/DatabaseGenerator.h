#ifndef DATABASE_GENERATOR_H
#define DATABASE_GENERATOR_H

#include "RecipeGenerator.h"
#include "../engine/RecipeMatcher.h"

/*
 * DatabaseGenerator
 * -----------------------------------------------------------------------
 * Concrete RecipeGenerator that fulfills requests using RecipeMatcher
 * against the local recipe database. Produces a TraditionalRecipe,
 * scaled to the requested serving size.
 */
class DatabaseGenerator : public RecipeGenerator {
private:
    RecipeMatcher matcher;

public:
    explicit DatabaseGenerator(std::vector<json> database);

    std::unique_ptr<Recipe> generateRecipe(const RecipePreferences& preferences) override;

    // Exposes the underlying match so callers (main.cpp) can decide
    // whether the score clears the database-vs-AI threshold before
    // committing to this generator.
    MatchResult bestMatchFor(const RecipePreferences& preferences) const;

    // Builds a TraditionalRecipe from an already-chosen MatchResult
    // (e.g. one picked by main.cpp after excluding a previous recipe on
    // regenerate) instead of re-running the matcher from scratch. This
    // is what generateRecipe() itself delegates to internally.
    std::unique_ptr<Recipe> generateFromMatch(const RecipePreferences& preferences, const MatchResult& match) const;
};

#endif // DATABASE_GENERATOR_H
