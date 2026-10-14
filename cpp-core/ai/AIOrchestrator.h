#ifndef AI_ORCHESTRATOR_H
#define AI_ORCHESTRATOR_H

#include <functional>
#include <memory>
#include <string>
#include <vector>
#include "LLMProvider.h"
#include "ModelResult.h"
#include "http/HttpClient.h"
#include "../security/events/SecurityEventManager.h"

/*
 * AIOrchestrator -- Phase E.
 * -----------------------------------------------------------------------
 * Fans a single prompt out to one or more registered providers and
 * collects a ModelResult per provider: raw text, success/failure, a
 * sanitized error, and a real measured duration. It does NOT parse,
 * score, or pick a "winning" recipe -- that requires evaluating the
 * *parsed* recipe (ingredient/diet/safety compliance), which is
 * RecipeEvaluator's job (Phase F) and does not exist yet. Fabricating a
 * quality score here from raw, unparsed text would be exactly the kind
 * of made-up metric the project spec forbids, so AIOrchestrator exposes
 * only what it can honestly measure itself:
 *
 *   - selectFastestSuccessful(): a real comparison of measured durations.
 *   - selectBestByScore(): a generic hook that takes an actual scoring
 *     function -- Phase F plugs RecipeEvaluator's score in here once it
 *     exists, instead of AIOrchestrator inventing one.
 *
 * OrchestrationMode records the user-facing choice (Phase 18's "AI
 * Strategy" step) for the caller/API layer to interpret:
 *   - SingleModel: exactly one named provider is called, no failover.
 *   - MultiModel / BestQuality / CompareAll: every registered, available
 *     provider is called; what happens with the results differs by mode
 *     (synthesize, score-and-pick, or just display all) and is decided
 *     by the caller using the results returned here.
 *   - Fastest: every provider is called (so it can be measured), and
 *     selectFastestSuccessful() gives the caller the one that finished
 *     first successfully.
 *
 * Concurrency (Phase 33): for every mode except SingleModel, providers
 * are dispatched with std::async and results are collected afterwards,
 * so wall-clock time is bounded by the SLOWEST provider, not the sum of
 * all of them. Each provider already enforces its own HTTP timeout
 * (CurlHttpClient); AIOrchestrator does not attempt to forcibly cancel a
 * provider call in flight (C++/libcurl offers no safe, portable way to
 * do that without extra machinery), so a provider whose own timeout is
 * misconfigured to be very large can still make one std::async task run
 * long -- it cannot, however, block or delay any *other* provider's
 * result, since they all run concurrently.
 */
enum class OrchestrationMode { SingleModel, MultiModel, Fastest, BestQuality, CompareAll };

const char* toString(OrchestrationMode mode);

class AIOrchestrator {
public:
    explicit AIOrchestrator(std::vector<std::shared_ptr<LLMProvider>> providers);

    // One instance of every LLMProviderFactory-supported provider, sharing
    // one HttpClient.
    static std::vector<std::shared_ptr<LLMProvider>> buildDefaultProviders(std::shared_ptr<HttpClient> http);

    // Runs `prompt` against provider(s) selected by `mode`.
    //  - mode == SingleModel: `singleProviderName` is required (matched
    //    case-insensitively against each provider's getProviderName());
    //    throws std::invalid_argument if empty, blank, or unmatched.
    //  - otherwise: `singleProviderName` is ignored; every registered
    //    provider is called.
    // Never throws for a provider-level failure (missing key, timeout,
    // bad HTTP status, ...) -- those are reported as a failed/skipped
    // ModelResult so the caller always gets a complete picture. Only
    // throws for a caller/programming error (empty prompt, bad mode
    // usage).
    std::vector<ModelResult> run(OrchestrationMode mode, const std::string& prompt,
                                 const std::string& singleProviderName = "");

    std::vector<std::string> providerNames() const;

    // What the AI Model Lab shows for each registered provider. Never
    // contains a key or any configuration value -- only names and state.
    struct ProviderInfo {
        std::string name;
        std::string model;
        std::string status;     // toString(ProviderStatus)
        bool available = false; // false => not configured, will be skipped
    };
    std::vector<ProviderInfo> providerInfo() const;

    // Hands the (non-owned, nullable) audit-trail manager to every provider so
    // their failures are reported. Call before run().
    void setEventManager(SecurityEventManager* manager);

    // Real comparisons over already-collected results (no re-calling providers).
    static const ModelResult* selectFastestSuccessful(const std::vector<ModelResult>& results);
    static const ModelResult* selectBestByScore(const std::vector<ModelResult>& results,
                                                const std::function<double(const ModelResult&)>& scorer);

private:
    std::vector<std::shared_ptr<LLMProvider>> providers;

    ModelResult callOne(const std::shared_ptr<LLMProvider>& provider, const std::string& prompt) const;
    std::shared_ptr<LLMProvider> findByName(const std::string& name) const;
};

#endif // AI_ORCHESTRATOR_H
