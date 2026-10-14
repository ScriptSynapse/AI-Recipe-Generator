#ifndef AI_GENERATOR_H
#define AI_GENERATOR_H

#include "RecipeGenerator.h"
#include "../ai/LLMProvider.h"
#include "../security/events/SecurityEventManager.h"
#include <memory>
#include <string>
#include <utility>
#include <vector>

/*
 * AIGenerator
 * -----------------------------------------------------------------------
 * Concrete RecipeGenerator that produces an AIRecipe by delegating text
 * generation to an injected LLMProvider (Strategy pattern -- see
 * ai/LLMProvider.h and ai/LLMProviderFactory.h). AIGenerator itself knows
 * nothing about HTTP, curl, or any vendor's request/response format;
 * that all lives behind the provider.
 *
 * Two things always work, by design:
 *   - callFallbackProvider() builds a realistic recipe locally from
 *     templates (RecipeTemplateEngine), with zero network dependency.
 *     This is the final safety net, independent of every provider.
 *   - generateRecipe() only calls the provider if it reports itself
 *     available; ANY failure (missing key, network error, timeout,
 *     malformed reply) is caught here and degrades to the fallback, so
 *     the app never crashes or returns nothing because an AI service is
 *     unavailable.
 *
 * The default constructor preserves the original single-provider
 * behavior (Anthropic Claude, configured via ANTHROPIC_API_KEY /
 * ANTHROPIC_MODEL) by asking LLMProviderFactory for a "claude" provider
 * over a real CurlHttpClient. Passing a different provider (any vendor,
 * or a test double) is dependency injection via the second constructor.
 */
class AIGenerator : public RecipeGenerator {
private:
    // Always non-null after construction (both constructors guarantee this;
    // see AIGenerator.cpp). Kept as unique_ptr, not a reference, so the
    // generator can be default-constructed, copied by move, and stored in
    // containers (e.g. by ModelRouter in a later phase).
    std::unique_ptr<LLMProvider> provider;
    SecurityEventManager* events = nullptr;   // optional audit trail, not owned

    // Turns a provider's raw text reply into an AIRecipe (shared by every
    // provider). Throws on malformed content; generateRecipe() catches.
public:
    // Shared with the AI Model Lab (ModelComparator), so every model is asked
    // the SAME question and its answer goes through the SAME validation as in
    // normal generation. All three use no instance state.
    static std::string buildPrompt(const RecipePreferences& preferences);
    // Validates (AIOutputValidator) and turns a model's raw reply into a recipe.
    // Throws AIOutputValidationException / std::exception on a bad reply.
    static std::unique_ptr<Recipe> parseRecipeResponse(std::string text,
                                                       const RecipePreferences& preferences,
                                                       const std::string& providerLabel);
    // The offline template recipe (no network, no model).
    static std::unique_ptr<Recipe> callFallbackProvider(const RecipePreferences& preferences);

    // Anthropic Claude via the factory + a real CurlHttpClient (legacy default).
    AIGenerator();
    // Dependency injection: use exactly this provider (any LLMProvider).
    explicit AIGenerator(std::unique_ptr<LLMProvider> injectedProvider);

    std::unique_ptr<Recipe> generateRecipe(const RecipePreferences& preferences) override;

    // Optional audit trail. Reports rejected AI output itself, and hands the
    // manager to the provider so provider failures are reported too. `manager`
    // may be null and is not owned.
    void setEventManager(SecurityEventManager* manager);

    bool hasApiKey() const;   // true if the configured provider is usable right now
    std::string getModel() const;

    // Every configured model's OWN status (Phase 20 groundwork), regardless
    // of whether the underlying provider is a single LLMProvider or a
    // ModelRouter chain -- callers never need to know which.
    std::vector<std::pair<std::string, std::string>> getProviderStatuses() const;
};

#endif // AI_GENERATOR_H
