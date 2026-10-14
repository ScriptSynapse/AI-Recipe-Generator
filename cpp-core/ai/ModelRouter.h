#ifndef MODEL_ROUTER_H
#define MODEL_ROUTER_H

#include <memory>
#include <string>
#include <vector>
#include "LLMProvider.h"
#include "LLMProviderFactory.h"
#include "http/HttpClient.h"

/*
 * ModelRouter -- sequential failover chain (Phase 21).
 * -----------------------------------------------------------------------
 * Wraps an ordered list of providers and tries them one at a time:
 *
 *      Claude -> Gemini -> OpenAI -> Groq -> Local
 *        v fail    v fail    v fail   v fail
 *
 * skipping any that report themselves unavailable (no key configured,
 * bad configuration) and moving on from any that throw. Only if every
 * provider in the chain is unavailable or fails does generate() itself
 * throw -- at which point the caller (AIGenerator) falls through to the
 * offline template generator, which has no dependency on any provider
 * and cannot fail this way.
 *
 * ModelRouter itself implements LLMProvider (it IS a provider, from the
 * point of view of anything holding an LLMProvider pointer -- a Composite
 * over the Strategy interface). That means it drops straight into
 * AIGenerator's existing injection point (Phase B) with no change to
 * AIGenerator at all: constructing AIGenerator with a ModelRouter gives
 * automatic multi-provider failover for free.
 *
 * getProviderName()/getModelName()/getStatus() describe whichever
 * provider actually served the most recent successful generate() call
 * (or the router's own aggregate state before any call has succeeded),
 * so callers/logs can tell which vendor a recipe actually came from.
 */
class ModelRouter : public LLMProvider {
public:
    explicit ModelRouter(std::vector<std::shared_ptr<LLMProvider>> chain);

    // Builds the default chain (one instance of every LLMProviderFactory
    // name, in LLMProviderFactory::supportedNames() order) sharing one
    // HttpClient (safe: CurlHttpClient is stateless/thread-safe per call).
    static std::unique_ptr<ModelRouter> buildDefaultChain(std::shared_ptr<HttpClient> http);

    std::string generate(const std::string& prompt) override;
    std::string getProviderName() const override;
    std::string getModelName() const override;
    bool isAvailable() const override;
    ProviderStatus getStatus() const override;

    // Passes the manager to every provider in the chain, so each one reports
    // its own failures (with its own name) as the router works down the chain.
    void setEventManager(SecurityEventManager* manager) override;

    // Provider names in chain order, for diagnostics/tests/the AI Model Lab.
    std::vector<std::string> chainProviderNames() const;

    // Every chain member's OWN current status (Phase 20: Available /
    // Unavailable / API key missing / Timeout / Rate limited), queried
    // directly from each provider -- cheap, no network call, no generate().
    // This is what lets a health/status endpoint show "here is every
    // configured model and its state" rather than only whichever model
    // most recently succeeded.
    std::vector<std::pair<std::string, std::string>> chainStatuses() const;

private:
    std::vector<std::shared_ptr<LLMProvider>> chain;
    std::string lastUsedProviderName;
    std::string lastUsedModelName;
    bool lastCallSucceeded = false;
    bool everCalled = false;
};

#endif // MODEL_ROUTER_H
