#include "AIOrchestrator.h"
#include "LLMProviderFactory.h"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <future>
#include <stdexcept>

namespace {
std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}
}

const char* toString(OrchestrationMode mode) {
    switch (mode) {
        case OrchestrationMode::SingleModel: return "SINGLE_MODEL";
        case OrchestrationMode::MultiModel:  return "MULTI_MODEL";
        case OrchestrationMode::Fastest:     return "FASTEST";
        case OrchestrationMode::BestQuality: return "BEST_QUALITY";
        case OrchestrationMode::CompareAll:  return "COMPARE_ALL";
    }
    return "MULTI_MODEL";
}

AIOrchestrator::AIOrchestrator(std::vector<std::shared_ptr<LLMProvider>> providers_)
    : providers(std::move(providers_)) {
    if (providers.empty()) throw std::invalid_argument("AIOrchestrator requires at least one provider.");
}

std::vector<std::shared_ptr<LLMProvider>> AIOrchestrator::buildDefaultProviders(std::shared_ptr<HttpClient> http) {
    std::vector<std::shared_ptr<LLMProvider>> result;
    for (const auto& name : LLMProviderFactory::supportedNames()) {
        result.push_back(LLMProviderFactory::create(name, http));
    }
    return result;
}

std::vector<std::string> AIOrchestrator::providerNames() const {
    std::vector<std::string> names;
    names.reserve(providers.size());
    for (const auto& p : providers) names.push_back(p->getProviderName());
    return names;
}

std::vector<AIOrchestrator::ProviderInfo> AIOrchestrator::providerInfo() const {
    std::vector<ProviderInfo> info;
    info.reserve(providers.size());
    for (const auto& p : providers) {
        info.push_back({p->getProviderName(), p->getModelName(), toString(p->getStatus()), p->isAvailable()});
    }
    return info;
}

void AIOrchestrator::setEventManager(SecurityEventManager* manager) {
    for (const auto& p : providers) p->setEventManager(manager);
}

std::shared_ptr<LLMProvider> AIOrchestrator::findByName(const std::string& name) const {
    std::string target = toLower(name);
    for (const auto& p : providers) if (toLower(p->getProviderName()) == target) return p;
    return nullptr;
}

ModelResult AIOrchestrator::callOne(const std::shared_ptr<LLMProvider>& provider, const std::string& prompt) const {
    ModelResult result;
    result.providerName = provider->getProviderName();
    result.modelName = provider->getModelName();

    if (!provider->isAvailable()) {
        result.success = false;
        result.skipped = true;
        result.errorKind = LLMErrorKind::Unavailable;
        result.errorMessage = result.providerName + " is not configured or unavailable.";
        result.durationMs = 0;
        return result;
    }

    auto start = std::chrono::steady_clock::now();
    try {
        result.text = provider->generate(prompt);
        result.success = true;
    } catch (const LLMException& e) {
        result.success = false;
        result.errorKind = e.getKind();
        // e.what() is already vendor-safe (Phase C: no keys, no raw HTTP bodies).
        result.errorMessage = e.what();
    } catch (const std::exception&) {
        result.success = false;
        result.errorKind = LLMErrorKind::Unavailable;
        result.errorMessage = result.providerName + " failed unexpectedly.";
    }
    auto end = std::chrono::steady_clock::now();
    result.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
    return result;
}

std::vector<ModelResult> AIOrchestrator::run(OrchestrationMode mode, const std::string& prompt,
                                             const std::string& singleProviderName) {
    if (prompt.empty()) throw std::invalid_argument("AIOrchestrator::run requires a non-empty prompt.");

    if (mode == OrchestrationMode::SingleModel) {
        if (singleProviderName.empty()) {
            throw std::invalid_argument("SingleModel mode requires a provider name.");
        }
        auto provider = findByName(singleProviderName);
        if (!provider) {
            std::string available;
            for (const auto& n : providerNames()) available += (available.empty() ? "" : ", ") + n;
            throw std::invalid_argument("Unknown provider '" + singleProviderName + "'. Registered: " + available);
        }
        return {callOne(provider, prompt)};
    }

    // MultiModel / Fastest / BestQuality / CompareAll: call every
    // registered provider concurrently, so total wall time is bounded by
    // the slowest single provider rather than the sum of all of them.
    std::vector<std::future<ModelResult>> futures;
    futures.reserve(providers.size());
    for (const auto& provider : providers) {
        futures.push_back(std::async(std::launch::async,
                                     [this, provider, &prompt] { return callOne(provider, prompt); }));
    }

    std::vector<ModelResult> results;
    results.reserve(futures.size());
    for (auto& future : futures) results.push_back(future.get());
    return results;
}

const ModelResult* AIOrchestrator::selectFastestSuccessful(const std::vector<ModelResult>& results) {
    const ModelResult* best = nullptr;
    for (const auto& r : results) {
        if (!r.success) continue;
        if (!best || r.durationMs < best->durationMs) best = &r;
    }
    return best;
}

const ModelResult* AIOrchestrator::selectBestByScore(const std::vector<ModelResult>& results,
                                                     const std::function<double(const ModelResult&)>& scorer) {
    const ModelResult* best = nullptr;
    double bestScore = 0.0;
    for (const auto& r : results) {
        if (!r.success) continue;
        double score = scorer(r);
        if (!best || score > bestScore) { best = &r; bestScore = score; }
    }
    return best;
}
