// Tests for ModelRouter: sequential failover, skip-unavailable, all-fail
// behavior, health reporting, and that it plugs into AIGenerator (which
// only knows it received an LLMProvider) with zero changes to AIGenerator.
#include <cassert>
#include <iostream>
#include <memory>
#include "../cpp-core/ai/ModelRouter.h"
#include "../cpp-core/generators/AIGenerator.h"
#include "../cpp-core/models/RecipePreferences.h"
#include "helpers/FakeProvider.h"

namespace {
template <typename Ex, typename Fn>
bool throwsAs(Fn fn) { try { fn(); } catch (const Ex&) { return true; } catch (...) { return false; } return false; }

std::unique_ptr<FakeProvider> make(const std::string& name, bool available, bool throwsErr,
                                   LLMErrorKind kind, const std::string& response) {
    auto p = std::make_unique<FakeProvider>(name, name + "-model", response);
    p->available = available;
    p->shouldThrow = throwsErr;
    p->failureKind = kind;
    return p;
}
} // namespace

int main() {
    // MR-01: first available provider wins; later providers are never called.
    {
        auto a = make("first", true, false, LLMErrorKind::Network, "A-reply");
        auto b = make("second", true, false, LLMErrorKind::Network, "B-reply");
        FakeProvider* bRaw = b.get();
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);

        assert(router.generate("prompt") == "A-reply");
        assert(bRaw->calls == 0);
        assert(router.getProviderName() == "first");
        assert(router.getModelName() == "first-model");
        assert(router.getStatus() == ProviderStatus::Available);
    }
    std::cout << "MR-01 passed: first available provider wins, later ones untouched.\n";

    // MR-02: unavailable providers are skipped without being called.
    {
        auto a = make("unavailable-one", false, false, LLMErrorKind::Network, "unused");
        FakeProvider* aRaw = a.get();
        auto b = make("works", true, false, LLMErrorKind::Network, "B-reply");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);

        assert(router.generate("prompt") == "B-reply");
        assert(aRaw->calls == 0);
        assert(router.getProviderName() == "works");
    }
    std::cout << "MR-02 passed: unavailable provider skipped, never called.\n";

    // MR-03: a provider that throws is skipped; the next one is tried.
    {
        auto a = make("flaky", true, true, LLMErrorKind::RateLimited, "unused");
        FakeProvider* aRaw = a.get();
        auto b = make("backup", true, false, LLMErrorKind::Network, "backup-reply");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);

        assert(router.generate("prompt") == "backup-reply");
        assert(aRaw->calls == 1);
        assert(router.getProviderName() == "backup");
    }
    std::cout << "MR-03 passed: failing provider tried once, chain continues to the next.\n";

    // MR-04: every provider unavailable/failing -> router throws, diagnostic
    // message lists every provider but leaks no internals.
    {
        auto a = make("down-a", false, false, LLMErrorKind::Network, "unused");
        auto b = make("down-b", true, true, LLMErrorKind::Timeout, "unused");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);

        bool threw = throwsAs<LLMException>([&] { router.generate("prompt"); });
        assert(threw);
        try {
            router.generate("prompt");
        } catch (const LLMException& e) {
            std::string msg = e.what();
            assert(msg.find("down-a") != std::string::npos);
            assert(msg.find("down-b") != std::string::npos);
        }
        assert(router.getProviderName() == "router");   // nothing succeeded
        assert(router.getStatus() == ProviderStatus::Unavailable);
    }
    std::cout << "MR-04 passed: all-fail throws with a full diagnostic trail.\n";

    // MR-05: isAvailable() is true if ANY chain member is available, even
    // if the first one(s) are not.
    {
        auto a = make("down", false, false, LLMErrorKind::Network, "unused");
        auto b = make("up", true, false, LLMErrorKind::Network, "reply");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);
        assert(router.isAvailable());
    }
    std::cout << "MR-05 passed: isAvailable() true if any member is available.\n";

    // MR-06: constructing with an empty chain is a programming error.
    assert(throwsAs<std::invalid_argument>([] { ModelRouter router(std::vector<std::shared_ptr<LLMProvider>>{}); }));
    std::cout << "MR-06 passed: empty chain rejected.\n";

    // MR-07: chainProviderNames() preserves order.
    {
        auto a = make("alpha", true, false, LLMErrorKind::Network, "x");
        auto b = make("beta", true, false, LLMErrorKind::Network, "y");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        ModelRouter router(chain);
        auto names = router.chainProviderNames();
        assert((names == std::vector<std::string>{"alpha", "beta"}));
    }
    std::cout << "MR-07 passed: chainProviderNames() preserves chain order.\n";

    // MR-08: ModelRouter plugs into AIGenerator's existing injection point
    // (Phase B) with zero changes to AIGenerator -- failover "for free".
    {
        RecipePreferences prefs = RecipePreferences::fromJson(json{
            {"ingredients", {"paneer", "tomato"}}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
            {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2}});
        const char* validJson = R"({
          "name": "Router Recipe", "ingredients": [{"name":"paneer","quantity":200,"unit":"g"}],
          "instructions": ["Cook it."], "cookingTime": 20, "difficulty": "Easy",
          "calories": 500, "proteinGrams": 30, "carbsGrams": 20, "fatGrams": 20, "substitutions": []
        })";
        auto a = make("down", false, false, LLMErrorKind::Network, "unused");
        auto b = make("up", true, false, LLMErrorKind::Network, validJson);
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        auto router = std::make_unique<ModelRouter>(chain);

        AIGenerator gen(std::move(router));
        auto recipe = gen.generateRecipe(prefs);
        json out = recipe->toJson();
        assert(out["usedFallback"] == false);
        assert(out["aiProvider"] == "up");
        assert(out["name"] == "Router Recipe");
    }
    std::cout << "MR-08 passed: AIGenerator + ModelRouter failover integration.\n";

    // MR-09: chainStatuses() reports every member's OWN status, cheaply,
    // without calling generate() on any of them.
    {
        auto avail = make("avail", true, false, LLMErrorKind::Network, "reply");
        auto missing = make("missing-key", false, false, LLMErrorKind::Network, "unused");
        FakeProvider* availRaw = avail.get();
        FakeProvider* missingRaw = missing.get();
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(avail), std::move(missing)};
        ModelRouter router(chain);

        auto statuses = router.chainStatuses();
        assert(statuses.size() == 2);
        assert(statuses[0].first == "avail" && statuses[0].second == "AVAILABLE");
        assert(statuses[1].first == "missing-key" && statuses[1].second == "UNAVAILABLE");
        assert(availRaw->calls == 0 && missingRaw->calls == 0);   // never actually called
    }
    std::cout << "MR-09 passed: chainStatuses() reports every member's status without calling any of them.\n";

    // MR-10: AIGenerator::getProviderStatuses() forwards to the router for
    // every member, and degrades to a single-entry list for a plain provider.
    {
        auto a = make("router-a", true, false, LLMErrorKind::Network, "x");
        auto b = make("router-b", false, false, LLMErrorKind::Network, "y");
        std::vector<std::shared_ptr<LLMProvider>> chain{std::move(a), std::move(b)};
        AIGenerator routed(std::make_unique<ModelRouter>(chain));
        auto statuses = routed.getProviderStatuses();
        assert(statuses.size() == 2);
        assert(statuses[0].first == "router-a" && statuses[0].second == "AVAILABLE");
        assert(statuses[1].first == "router-b" && statuses[1].second == "UNAVAILABLE");

        AIGenerator single(make("solo", true, false, LLMErrorKind::Network, "z"));
        auto soloStatuses = single.getProviderStatuses();
        assert(soloStatuses.size() == 1);
        assert(soloStatuses[0].first == "solo" && soloStatuses[0].second == "AVAILABLE");
    }
    std::cout << "MR-10 passed: AIGenerator::getProviderStatuses() works for both a router and a plain provider.\n";

    std::cout << "All ModelRouter tests passed.\n";
    return 0;
}
