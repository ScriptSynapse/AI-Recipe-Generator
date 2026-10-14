// Tests for AIOrchestrator: SingleModel vs call-all modes, uniform
// ModelResult reporting (success/failure/skipped -- never throws for a
// provider-level failure), REAL concurrency (measured wall time, not
// assumed), and the two honest selection helpers.
#include <cassert>
#include <chrono>
#include <iostream>
#include <memory>
#include "../cpp-core/ai/AIOrchestrator.h"
#include "helpers/FakeProvider.h"

namespace {
template <typename Ex, typename Fn>
bool throwsAs(Fn fn) { try { fn(); } catch (const Ex&) { return true; } catch (...) { return false; } return false; }

std::shared_ptr<FakeProvider> make(const std::string& name, bool available, const std::string& response,
                                   int delayMs = 0, bool shouldThrow = false,
                                   LLMErrorKind kind = LLMErrorKind::Network) {
    auto p = std::make_shared<FakeProvider>(name, name + "-model", response);
    p->available = available;
    p->delayMs = delayMs;
    p->shouldThrow = shouldThrow;
    p->failureKind = kind;
    return p;
}

const ModelResult* find(const std::vector<ModelResult>& results, const std::string& name) {
    for (const auto& r : results) if (r.providerName == name) return &r;
    return nullptr;
}
} // namespace

int main() {
    // ORCH-01: SingleModel calls exactly the named provider; others untouched.
    {
        auto a = make("alpha", true, "alpha-reply");
        auto b = make("beta", true, "beta-reply");
        AIOrchestrator orch({a, b});

        auto results = orch.run(OrchestrationMode::SingleModel, "prompt", "alpha");
        assert(results.size() == 1);
        assert(results[0].providerName == "alpha");
        assert(results[0].success && results[0].text == "alpha-reply");
        assert(a->calls == 1);
        assert(b->calls == 0);
    }
    std::cout << "ORCH-01 passed: SingleModel calls only the named provider.\n";

    // ORCH-02: SingleModel is case-insensitive; unknown name throws with the list.
    {
        auto a = make("Alpha", true, "reply");
        AIOrchestrator orch({a});
        auto results = orch.run(OrchestrationMode::SingleModel, "prompt", "aLpHa");
        assert(results[0].success);

        assert(throwsAs<std::invalid_argument>([&] { orch.run(OrchestrationMode::SingleModel, "prompt", "nope"); }));
        assert(throwsAs<std::invalid_argument>([&] { orch.run(OrchestrationMode::SingleModel, "prompt", ""); }));
    }
    std::cout << "ORCH-02 passed: case-insensitive match; unknown/empty name rejected.\n";

    // ORCH-03: empty prompt is a programming error regardless of mode.
    {
        auto a = make("alpha", true, "reply");
        AIOrchestrator orch({a});
        assert(throwsAs<std::invalid_argument>([&] { orch.run(OrchestrationMode::MultiModel, "", ""); }));
    }
    std::cout << "ORCH-03 passed: empty prompt rejected.\n";

    // ORCH-04: call-all modes call every provider and report all outcomes
    // uniformly -- success, failure, and skipped-unavailable -- without throwing.
    {
        auto ok = make("ok", true, "ok-reply");
        auto down = make("down", false, "unused");
        auto broken = make("broken", true, "unused", 0, true, LLMErrorKind::RateLimited);
        AIOrchestrator orch({ok, down, broken});

        auto results = orch.run(OrchestrationMode::CompareAll, "prompt");
        assert(results.size() == 3);

        auto* okR = find(results, "ok");
        auto* downR = find(results, "down");
        auto* brokenR = find(results, "broken");
        assert(okR && okR->success && okR->text == "ok-reply" && !okR->skipped);
        assert(downR && !downR->success && downR->skipped);
        assert(brokenR && !brokenR->success && !brokenR->skipped);
        assert(brokenR->errorKind == LLMErrorKind::RateLimited);
        assert(down->calls == 0);        // skipped providers are never actually called
        assert(broken->calls == 1);
    }
    std::cout << "ORCH-04 passed: CompareAll reports success/failure/skipped uniformly, never throws.\n";

    // ORCH-05: REAL concurrency -- 4 providers each "take" 150ms; total wall
    // time must be close to 150ms, not ~600ms. This proves std::async
    // fan-out, not merely that the API accepts multiple providers.
    {
        const int DELAY_MS = 150;
        std::vector<std::shared_ptr<LLMProvider>> providers;
        for (int i = 0; i < 4; ++i) providers.push_back(make("p" + std::to_string(i), true, "reply", DELAY_MS));
        AIOrchestrator orch(providers);

        auto start = std::chrono::steady_clock::now();
        auto results = orch.run(OrchestrationMode::MultiModel, "prompt");
        auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                             std::chrono::steady_clock::now() - start).count();

        assert(results.size() == 4);
        for (const auto& r : results) assert(r.success);
        // Generous bound: concurrent should be well under 2x one delay;
        // sequential would be ~4x (600ms). This only fails if the fan-out
        // regresses to sequential execution.
        assert(elapsedMs < DELAY_MS * 2);
        std::cout << "  (measured " << elapsedMs << "ms for 4x " << DELAY_MS << "ms providers)\n";
    }
    std::cout << "ORCH-05 passed: providers run concurrently, not sequentially.\n";

    // ORCH-06: each ModelResult carries its OWN duration, not the batch total.
    {
        auto fast = make("fast", true, "f", 20);
        auto slow = make("slow", true, "s", 150);
        AIOrchestrator orch({fast, slow});
        auto results = orch.run(OrchestrationMode::MultiModel, "prompt");
        auto* fastR = find(results, "fast");
        auto* slowR = find(results, "slow");
        assert(fastR->durationMs < slowR->durationMs);
        assert(fastR->durationMs < 100);
    }
    std::cout << "ORCH-06 passed: per-provider durations reflect that provider's own latency.\n";

    // ORCH-07: selectFastestSuccessful ignores failures and skips, picks the minimum.
    {
        auto slow = make("slow", true, "s", 100);
        auto fast = make("fast", true, "f", 10);
        auto broken = make("broken", true, "unused", 0, true);
        auto down = make("down", false, "unused");
        AIOrchestrator orch({slow, fast, broken, down});
        auto results = orch.run(OrchestrationMode::Fastest, "prompt");
        const ModelResult* winner = AIOrchestrator::selectFastestSuccessful(results);
        assert(winner && winner->providerName == "fast");
    }
    std::cout << "ORCH-07 passed: selectFastestSuccessful picks the fastest SUCCESSFUL result.\n";

    // ORCH-08: selectFastestSuccessful returns nullptr if nothing succeeded.
    {
        auto down = make("down", false, "unused");
        AIOrchestrator orch({down});
        auto results = orch.run(OrchestrationMode::CompareAll, "prompt");
        assert(AIOrchestrator::selectFastestSuccessful(results) == nullptr);
    }
    std::cout << "ORCH-08 passed: no successes -> nullptr, not a crash or a fabricated pick.\n";

    // ORCH-09: selectBestByScore uses an injected, real scoring function
    // (standing in for Phase F's RecipeEvaluator) and ignores failures.
    {
        auto short_ = make("short", true, "hi");
        auto long_ = make("long", true, "a much longer and more detailed reply");
        auto broken = make("broken", true, "unused", 0, true);
        AIOrchestrator orch({short_, long_, broken});
        auto results = orch.run(OrchestrationMode::BestQuality, "prompt");
        const ModelResult* best = AIOrchestrator::selectBestByScore(
            results, [](const ModelResult& r) { return static_cast<double>(r.text.size()); });
        assert(best && best->providerName == "long");
    }
    std::cout << "ORCH-09 passed: selectBestByScore uses the injected scorer, not a fabricated metric.\n";

    // ORCH-10: providerNames() reflects registered providers in order.
    {
        auto a = make("a1", true, "x");
        auto b = make("b2", true, "y");
        AIOrchestrator orch({a, b});
        assert((orch.providerNames() == std::vector<std::string>{"a1", "b2"}));
    }
    std::cout << "ORCH-10 passed: providerNames() preserves registration order.\n";

    // ORCH-11: constructing with zero providers is a programming error.
    assert(throwsAs<std::invalid_argument>([] { AIOrchestrator orch({}); }));
    std::cout << "ORCH-11 passed: zero providers rejected.\n";

    std::cout << "All AIOrchestrator tests passed.\n";
    return 0;
}
