#include "ModelRouter.h"
#include <stdexcept>

ModelRouter::ModelRouter(std::vector<std::shared_ptr<LLMProvider>> chain_) : chain(std::move(chain_)) {
    if (chain.empty()) throw std::invalid_argument("ModelRouter requires at least one provider.");
}

std::unique_ptr<ModelRouter> ModelRouter::buildDefaultChain(std::shared_ptr<HttpClient> http) {
    std::vector<std::shared_ptr<LLMProvider>> chain;
    for (const auto& name : LLMProviderFactory::supportedNames()) {
        chain.push_back(LLMProviderFactory::create(name, http));
    }
    return std::make_unique<ModelRouter>(std::move(chain));
}

std::vector<std::string> ModelRouter::chainProviderNames() const {
    std::vector<std::string> names;
    names.reserve(chain.size());
    for (const auto& p : chain) names.push_back(p->getProviderName());
    return names;
}

std::vector<std::pair<std::string, std::string>> ModelRouter::chainStatuses() const {
    std::vector<std::pair<std::string, std::string>> statuses;
    statuses.reserve(chain.size());
    for (const auto& p : chain) statuses.emplace_back(p->getProviderName(), toString(p->getStatus()));
    return statuses;
}

std::string ModelRouter::generate(const std::string& prompt) {
    // Diagnostic trail only (provider name + resulting status, e.g.
    // "claude:RATE_LIMITED") -- never the prompt, never any credential.
    std::string attempts;

    for (const auto& provider : chain) {
        if (!provider->isAvailable()) {
            if (!attempts.empty()) attempts += ", ";
            attempts += provider->getProviderName() + ":" + toString(ProviderStatus::Unavailable);
            continue;
        }
        try {
            std::string text = provider->generate(prompt);
            lastUsedProviderName = provider->getProviderName();
            lastUsedModelName = provider->getModelName();
            lastCallSucceeded = true;
            everCalled = true;
            return text;
        } catch (const LLMException& e) {
            if (!attempts.empty()) attempts += ", ";
            attempts += provider->getProviderName() + ":" + toString(LLMException::statusFor(e.getKind()));
        }
    }

    lastUsedProviderName.clear();
    lastUsedModelName.clear();
    lastCallSucceeded = false;
    everCalled = true;
    throw LLMException(LLMErrorKind::Unavailable,
                       "All configured providers are unavailable or failed: " + attempts);
}

std::string ModelRouter::getProviderName() const {
    return lastUsedProviderName.empty() ? "router" : lastUsedProviderName;
}

std::string ModelRouter::getModelName() const { return lastUsedModelName; }

bool ModelRouter::isAvailable() const {
    for (const auto& p : chain) if (p->isAvailable()) return true;
    return false;
}

ProviderStatus ModelRouter::getStatus() const {
    if (!everCalled) return isAvailable() ? ProviderStatus::Available : ProviderStatus::Unavailable;
    return lastCallSucceeded ? ProviderStatus::Available : ProviderStatus::Unavailable;
}

void ModelRouter::setEventManager(SecurityEventManager* manager) {
    for (const auto& provider : chain) provider->setEventManager(manager);
}
