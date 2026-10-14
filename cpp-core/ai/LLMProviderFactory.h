#ifndef LLM_PROVIDER_FACTORY_H
#define LLM_PROVIDER_FACTORY_H

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>
#include "LLMProvider.h"
#include "http/HttpClient.h"

/*
 * LLMProviderFactory -- Factory pattern.
 * -----------------------------------------------------------------------
 * Centralizes "name string -> concrete LLMProvider" construction, so
 * callers (AIGenerator, and later AIOrchestrator/ModelRouter) depend only
 * on this factory and the LLMProvider interface -- never on a concrete
 * provider header. Every provider reads its own configuration from the
 * environment (see each provider's fromEnvironment()); the factory does
 * not touch environment variables itself.
 *
 *      auto provider = LLMProviderFactory::create("claude", http);
 *
 * An unknown name throws std::invalid_argument with the name list, which
 * the caller can translate into a clean 400-style API error -- it is
 * never silently ignored or defaulted to a random provider.
 */
class LLMProviderFactory {
public:
    static std::unique_ptr<LLMProvider> create(const std::string& name, std::shared_ptr<HttpClient> http);

    // Stable ids the factory accepts, in the order ModelRouter's default
    // failover chain will use them (Phase 21).
    static std::vector<std::string> supportedNames();
};

#endif // LLM_PROVIDER_FACTORY_H
