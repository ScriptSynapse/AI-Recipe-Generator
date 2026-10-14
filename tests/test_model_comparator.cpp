// Phase O: ModelComparator (AI Model Lab). Uses scripted FakeProviders, so
// every number asserted here is one the comparator actually computed from a
// scripted reply -- no network, no real models.
#include <atomic>
#include <cassert>
#include <iostream>
#include <memory>
#include "../cpp-core/ai/AIOrchestrator.h"
#include "../cpp-core/ai/ModelComparator.h"
#include "../cpp-core/generators/AIGenerator.h"
#include "../cpp-core/security/events/ResponseEventCollector.h"
#include "../cpp-core/security/events/SecurityEventFactory.h"
#include "helpers/FakeProvider.h"

namespace {
RecipePreferences prefs() {
    return RecipePreferences::fromJson(json{
        {"ingredients", {"paneer", "tomato"}}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
        {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2}});
}

// A reply that satisfies the schema AND uses the requested ingredients.
std::string goodReply(const std::string& name = "Paneer Tomato Curry") {
    return json{
        {"name", name},
        {"ingredients", json::array({json{{"name", "paneer"}, {"quantity", 200}, {"unit", "g"}},
                                     json{{"name", "tomato"}, {"quantity", 2}, {"unit", ""}}})},
        {"instructions", json::array({"Cube the paneer and chop the tomato finely.",
                                      "Simmer the tomato until it breaks down into a sauce.",
                                      "Add the paneer and cook gently for five minutes.",
                                      "Season and serve hot."})},
        {"cookingTime", 25}, {"difficulty", "Easy"},
        {"calories", 520}, {"proteinGrams", 28}, {"carbsGrams", 20}, {"fatGrams", 36},
        {"substitutions", json::array({"Tofu works in place of paneer."})}}.dump();
}

// Valid, but ignores the requested tomato and uses an ingredient the user did not list.
std::string poorReply() {
    return json{
        {"name", "Plain Paneer"},
        {"ingredients", json::array({json{{"name", "paneer"}, {"quantity", 200}, {"unit", "g"}}})},
        {"instructions", json::array({"Cook it.", "Eat it."})},
        {"cookingTime", 25}, {"difficulty", "Easy"},
        {"calories", 100}, {"proteinGrams", 28}, {"carbsGrams", 20}, {"fatGrams", 36},
        {"substitutions", json::array()}}.dump();
}

std::shared_ptr<FakeProvider> fake(const std::string& name, const std::string& reply, int delayMs = 0) {
    auto p = std::make_shared<FakeProvider>(name, name + "-model", reply);
    p->delayMs = delayMs;
    return p;
}

const ComparedModel* find(const ComparisonReport& r, const std::string& provider) {
    for (const auto& m : r.models) if (m.provider == provider) return &m;
    return nullptr;
}

// A provider that reports its failure to the audit trail from whatever thread it runs on.
class EmittingProvider : public FakeProvider {
public:
    SecurityEventManager* manager = nullptr;
    using FakeProvider::FakeProvider;
    void setEventManager(SecurityEventManager* m) override { manager = m; }
    std::string generate(const std::string& prompt) override {
        if (manager) manager->emit(SecurityEventFactory::modelFailure(name, LLMErrorKind::Timeout, 0));
        return FakeProvider::generate(prompt);
    }
};
} // namespace

int main() {
    // MC-01: a valid reply is validated, turned into a recipe, evaluated; raw text never returned.
    {
        auto a = fake("alpha", goodReply());
        AIOrchestrator orch({a});
        ModelComparator cmp(orch);
        auto report = cmp.compare(prefs(), OrchestrationMode::CompareAll);
        const ComparedModel* m = find(report, "alpha");
        assert(m && m->status == ComparedStatus::Success && m->hasRecipe);
        assert(m->recipe["name"] == "Paneer Tomato Curry");
        assert(m->evaluation.overallScore > 50);
        json j = report.toJson();
        assert(j.dump().find("\"text\"") == std::string::npos);
    }
    std::cout << "MC-01 passed: valid reply -> validated recipe with real evaluator scores.\n";

    // MC-02: invalid replies are REJECTED, never returned, and reported to the audit trail without their content.
    {
        auto schemaViolation = fake("evil", json{{"name", "x"}, {"isAdmin", true}, {"payload", "<script>alert(1)</script>SECRETREPLY"}}.dump());
        auto notJson = fake("chatty", "Sure! Here is a lovely recipe for you: SECRETREPLY2");
        AIOrchestrator orch({schemaViolation, notJson});
        auto collector = std::make_shared<ResponseEventCollector>();
        SecurityEventManager events; events.attach(collector);
        ModelComparator cmp(orch);
        auto report = cmp.compare(prefs(), OrchestrationMode::CompareAll, "", &events);
        for (const char* name : {"evil", "chatty"}) {
            const ComparedModel* m = find(report, name);
            assert(m && m->status == ComparedStatus::Rejected && !m->hasRecipe);
        }
        std::string out = report.toJson().dump() + collector->toJson().dump();
        assert(out.find("SECRETREPLY") == std::string::npos);
        assert(out.find("<script>") == std::string::npos);
        assert(collector->events().size() >= 1);
        assert(std::string(toString(collector->events()[0].type)) == "AI_OUTPUT_REJECTED");
    }
    std::cout << "MC-02 passed: invalid replies rejected, nothing from them leaks, audit event raised.\n";

    // MC-03: provider failure vs not configured are distinguished.
    {
        auto down = fake("down", "");
        down->shouldThrow = true; down->failureKind = LLMErrorKind::Timeout;
        auto nokey = fake("nokey", ""); nokey->available = false;
        AIOrchestrator orch({down, nokey});
        ModelComparator cmp(orch);
        auto report = cmp.compare(prefs(), OrchestrationMode::CompareAll);
        assert(find(report, "down")->status == ComparedStatus::Failed);
        assert(find(report, "down")->errorKind == "TIMEOUT");
        assert(find(report, "nokey")->status == ComparedStatus::Skipped);
        assert(find(report, "nokey")->errorKind.empty());
        assert(report.fastest.empty() && report.best.empty());
    }
    std::cout << "MC-03 passed: FAILED (with kind) vs SKIPPED; no winner when nothing valid.\n";

    // MC-04: fastest and best are chosen by DIFFERENT, real criteria.
    {
        auto quickPoor = fake("quick", poorReply(), 0);
        auto slowGood = fake("slow", goodReply(), 120);
        AIOrchestrator orch({quickPoor, slowGood});
        ModelComparator cmp(orch);
        auto report = cmp.compare(prefs(), OrchestrationMode::CompareAll);
        assert(find(report, "quick")->evaluation.overallScore < find(report, "slow")->evaluation.overallScore);
        assert(find(report, "slow")->durationMs >= 100);
        assert(report.fastest == "quick");
        assert(report.best == "slow");
        assert(report.recommended.empty());
    }
    std::cout << "MC-04 passed: fastest=lowest measured latency, best=highest evaluator score.\n";

    // MC-05: recommended follows the mode.
    {
        auto quickPoor = fake("quick", poorReply(), 0);
        auto slowGood = fake("slow", goodReply(), 60);
        AIOrchestrator orch({quickPoor, slowGood});
        ModelComparator cmp(orch);
        assert(cmp.compare(prefs(), OrchestrationMode::Fastest).recommended == "quick");
        assert(cmp.compare(prefs(), OrchestrationMode::BestQuality).recommended == "slow");
    }
    std::cout << "MC-05 passed: FASTEST recommends the fastest, BEST_QUALITY the best.\n";

    // MC-06: the offline baseline is always shown (multi-model) but never wins; absent in single-model mode.
    {
        auto a = fake("alpha", poorReply());
        AIOrchestrator orch({a});
        ModelComparator cmp(orch);
        auto all = cmp.compare(prefs(), OrchestrationMode::CompareAll);
        const ComparedModel* base = find(all, "offline-template");
        assert(base && base->status == ComparedStatus::Baseline && base->hasRecipe);
        assert(all.best == "alpha" && all.fastest == "alpha");      // baseline can't win even if it scores higher
        auto single = cmp.compare(prefs(), OrchestrationMode::SingleModel, "alpha");
        assert(single.models.size() == 1 && find(single, "offline-template") == nullptr);
    }
    std::cout << "MC-06 passed: baseline shown for reference, never a winner, omitted for single-model.\n";

    // MC-07: every model gets the identical prompt, the same one normal generation uses.
    {
        auto a = fake("alpha", goodReply()), b = fake("beta", goodReply());
        AIOrchestrator orch({a, b});
        ModelComparator cmp(orch);
        cmp.compare(prefs(), OrchestrationMode::CompareAll);
        assert(a->lastPrompt == b->lastPrompt);
        assert(a->lastPrompt == AIGenerator::buildPrompt(prefs()));
        assert(a->lastPrompt.find("paneer") != std::string::npos);
    }
    std::cout << "MC-07 passed: all models receive the identical, canonical prompt.\n";

    // MC-08: winner selection is a pure function: ties go to the faster; failures and baseline are ignored.
    {
        ComparisonReport r;
        auto add = [&](const char* name, ComparedStatus st, long long ms, double score) {
            ComparedModel m; m.provider = name; m.status = st; m.durationMs = ms;
            m.hasRecipe = st == ComparedStatus::Success || st == ComparedStatus::Baseline;
            m.evaluation.overallScore = score; r.models.push_back(m);
        };
        add("slowTie", ComparedStatus::Success, 900, 80);
        add("fastTie", ComparedStatus::Success, 300, 80);
        add("failed", ComparedStatus::Failed, 1, 100);
        add("baseline", ComparedStatus::Baseline, 0, 100);
        ModelComparator::selectWinners(r);
        assert(r.best == "fastTie" && r.fastest == "fastTie");
    }
    std::cout << "MC-08 passed: ties -> faster; failed and baseline never selected.\n";

    // MC-09: unknown provider in single mode is the caller's error, not a silent empty report.
    {
        auto a = fake("alpha", goodReply());
        AIOrchestrator orch({a});
        ModelComparator cmp(orch);
        bool threw = false;
        try { cmp.compare(prefs(), OrchestrationMode::SingleModel, "nope"); } catch (const std::invalid_argument&) { threw = true; }
        assert(threw);
    }
    std::cout << "MC-09 passed: unknown single-model provider throws.\n";

    // MC-10: providers run concurrently AND may report events from their own threads safely.
    {
        std::vector<std::shared_ptr<LLMProvider>> providers;
        for (int i = 0; i < 8; ++i) {
            auto p = std::make_shared<EmittingProvider>("p" + std::to_string(i), "m", goodReply());
            p->delayMs = 150;
            providers.push_back(p);
        }
        AIOrchestrator orch(providers);
        auto collector = std::make_shared<ResponseEventCollector>();
        SecurityEventManager events; events.attach(collector);
        orch.setEventManager(&events);
        ModelComparator cmp(orch);
        auto start = std::chrono::steady_clock::now();
        auto report = cmp.compare(prefs(), OrchestrationMode::CompareAll, "", &events);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
        assert(ms < 8 * 150 / 2);                    // far below the sequential 1200ms
        assert(collector->events().size() == 8);     // none lost to a data race
        for (int i = 0; i < 8; ++i) assert(find(report, "p" + std::to_string(i))->status == ComparedStatus::Success);
    }
    std::cout << "MC-10 passed: concurrent providers; all 8 thread-emitted events recorded.\n";

    // MC-11: report JSON shape the API depends on.
    {
        auto a = fake("alpha", goodReply());
        AIOrchestrator orch({a});
        ModelComparator cmp(orch);
        json j = cmp.compare(prefs(), OrchestrationMode::BestQuality).toJson();
        assert(j["mode"] == "BEST_QUALITY" && j["best"] == "alpha" && j["recommended"] == "alpha");
        assert(j["fastest"] == "alpha" && j["models"].is_array());
        assert(j["models"][0].contains("evaluation") && j["models"][0]["evaluation"].contains("overallScore"));
        ComparisonReport empty;
        assert(empty.toJson()["best"].is_null());
    }
    std::cout << "MC-11 passed: JSON shape (nulls for no winner).\n";

    std::cout << "All ModelComparator tests passed.\n";
    return 0;
}
