#ifndef AI_GENERATOR_H
#define AI_GENERATOR_H

#include "RecipeGenerator.h"
#include <string>

/*
 * AIGenerator
 * -----------------------------------------------------------------------
 * Concrete RecipeGenerator that produces an AIRecipe.
 *
 * Modularity requirement: the *provider* is swappable and isolated to
 * two private methods:
 *   - callRealProvider()  -> builds a structured prompt from
 *                             RecipePreferences, POSTs it to the
 *                             Anthropic Messages API (via libcurl),
 *                             and parses the structured JSON reply.
 *   - callFallbackProvider() -> builds a realistic recipe locally from
 *                             templates, with zero network dependency.
 *
 * generateRecipe() tries the real provider only if an API key is
 * configured; any failure (missing key, network error, malformed
 * response) transparently falls back to the local generator so the
 * app never crashes or produces an empty result because the AI service
 * is unavailable.
 */
class AIGenerator : public RecipeGenerator {
private:
    std::string apiKey;   // read from ANTHROPIC_API_KEY env var; may be empty
    std::string model;

    std::unique_ptr<Recipe> callRealProvider(const RecipePreferences& preferences);
    std::unique_ptr<Recipe> callFallbackProvider(const RecipePreferences& preferences);

    std::string buildPrompt(const RecipePreferences& preferences) const;

public:
    AIGenerator();

    std::unique_ptr<Recipe> generateRecipe(const RecipePreferences& preferences) override;

    bool hasApiKey() const;
};

#endif // AI_GENERATOR_H
