// Phase B tests: LLMProvider abstraction, LLMException/ProviderStatus,
// health tracking, and AIGenerator's use of an injected provider
// (success, every failure kind, malformed output, unavailable provider).
#include <cassert>
#include <iostream>
#include <memory>
#include <type_traits>
#include <vector>
#include "../cpp-core/ai/LLMProvider.h"
#include "../cpp-core/generators/AIGenerator.h"
#include "../cpp-core/models/RecipePreferences.h"
#include "helpers/FakeProvider.h"

static RecipePreferences prefs() {
    return RecipePreferences::fromJson(json{
        {"ingredients", {"paneer", "tomato"}}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
        {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2}});
}

static const char* VALID_JSON = R"({
  "name": "Tomato Paneer Saute",
  "ingredients": [{"name":"paneer","quantity":200,"unit":"g"},{"name":"tomato","quantity":2,"unit":"whole"}],
  "instructions": ["Cube the paneer.", "Saute with tomato.", "Season with salt."],
  "cookingTime": 20, "difficulty": "Easy",
  "calories": 640, "proteinGrams": 38, "carbsGrams": 22, "fatGrams": 44,
  "substitutions": ["Tofu works instead of paneer."]
})";

// Runs AIGenerator with a FakeProvider configured by `setup`; returns the recipe JSON.
template <typename Setup>
static json run(Setup setup, FakeProvider** outProvider = nullptr) {
    auto fake = std::make_unique<FakeProvider>("fake", "fake-model-1", VALID_JSON);
    setup(*fake);
    FakeProvider* raw = fake.get();
    AIGenerator gen(std::move(fake));
    auto recipe = gen.generateRecipe(prefs());
    if (outProvider) *outProvider = raw;   // valid only while `gen` lives; read counters immediately below
    return recipe->toJson();
}

int main() {
    // LLM-01: interface is abstract and usable polymorphically.
    static_assert(std::is_abstract_v<LLMProvider>, "LLMProvider must be abstract");
    {
        std::vector<std::unique_ptr<LLMProvider>> providers;
        providers.push_back(std::make_unique<FakeProvider>("claude", "m-a", "one"));
        providers.push_back(std::make_unique<FakeProvider>("gemini", "m-b", "two"));
        assert(providers[0]->generate("p") == "one");
        assert(providers[1]->generate("p") == "two");
        assert(providers[0]->getProviderName() == "claude" && providers[1]->getModelName() == "m-b");
    }
    std::cout << "LLM-01 passed: providers interchangeable behind the base interface.\n";

    // LLM-02: LLMException carries kind + HTTP status; kind -> status mapping.
    {
        LLMException e(LLMErrorKind::RateLimited, "slow down", 429);
        assert(e.getKind() == LLMErrorKind::RateLimited && e.getHttpStatus() == 429);
        assert(std::string(e.what()) == "slow down");
        assert(LLMException::statusFor(LLMErrorKind::Timeout) == ProviderStatus::Timeout);
        assert(LLMException::statusFor(LLMErrorKind::RateLimited) == ProviderStatus::RateLimited);
        assert(LLMException::statusFor(LLMErrorKind::ApiKeyMissing) == ProviderStatus::ApiKeyMissing);
        assert(LLMException::statusFor(LLMErrorKind::Network) == ProviderStatus::Unavailable);
        assert(std::string(toString(ProviderStatus::ApiKeyMissing)) == "API_KEY_MISSING");
    }
    std::cout << "LLM-02 passed: LLMException kinds and status mapping.\n";

    // LLM-03: health tracking follows the outcome of calls and recovers.
    {
        FakeProvider p("fake", "m", "ok");
        assert(p.getStatus() == ProviderStatus::Available);
        p.shouldThrow = true; p.failureKind = LLMErrorKind::Timeout;
        try { p.generate("x"); assert(false); } catch (const LLMException&) {}
        assert(p.getStatus() == ProviderStatus::Timeout);
        p.failureKind = LLMErrorKind::RateLimited;
        try { p.generate("x"); assert(false); } catch (const LLMException&) {}
        assert(p.getStatus() == ProviderStatus::RateLimited);
        p.shouldThrow = false;
        p.generate("x");
        assert(p.getStatus() == ProviderStatus::Available);
        p.available = false;
        assert(p.getStatus() == ProviderStatus::Unavailable);
    }
    std::cout << "LLM-03 passed: status tracks timeout / rate limit / recovery / unavailable.\n";

    // LLM-04: AIGenerator uses an injected provider and labels the recipe with it.
    {
        json r = run([](FakeProvider&) {});
        assert(r["name"] == "Tomato Paneer Saute");
        assert(r["aiProvider"] == "fake");
        assert(r["usedFallback"] == false);
        assert(r["ingredients"].size() == 2);
    }
    std::cout << "LLM-04 passed: injected provider used; recipe attributed to it (not fallback).\n";

    // LLM-05: the prompt handed to the provider contains the user's constraints.
    {
        auto fake = std::make_unique<FakeProvider>("fake", "m", VALID_JSON);
        FakeProvider* raw = fake.get();
        AIGenerator gen(std::move(fake));
        gen.generateRecipe(prefs());
        assert(raw->calls == 1);
        assert(raw->lastPrompt.find("paneer, tomato") != std::string::npos);
        assert(raw->lastPrompt.find("Vegetarian") != std::string::npos);
    }
    std::cout << "LLM-05 passed: prompt contains ingredients and diet.\n";

    // LLM-06: every failure kind degrades to the local fallback -- nothing escapes.
    for (LLMErrorKind k : {LLMErrorKind::ApiKeyMissing, LLMErrorKind::Timeout, LLMErrorKind::RateLimited,
                           LLMErrorKind::Network, LLMErrorKind::HttpError, LLMErrorKind::BadResponse,
                           LLMErrorKind::Unavailable}) {
        json r = run([k](FakeProvider& f) { f.shouldThrow = true; f.failureKind = k; });
        assert(r["usedFallback"] == true);
        assert(r["aiProvider"] == "fallback-mock");
        assert(r["ingredients"].size() == 2);   // fallback still honours the user's ingredients
    }
    std::cout << "LLM-06 passed: all 7 failure kinds fall back cleanly.\n";

    // LLM-07: malformed model output falls back (not JSON / wrong shapes / empty).
    for (const std::string& bad : {std::string("I'm sorry, I can't do that."), std::string("{ not json"),
                                   std::string(""), std::string("[1,2,3]"),
                                   std::string(R"({"name":"x","instructions":[1,2,3]})"),
                                   std::string(R"({"name":"x","ingredients":"paneer"})")}) {
        json r = run([&](FakeProvider& f) { f.response = bad; });
        assert(r["usedFallback"] == true);
    }
    std::cout << "LLM-07 passed: malformed replies fall back cleanly.\n";

    // LLM-08: markdown-fenced JSON is accepted.
    {
        json r = run([](FakeProvider& f) { f.response = std::string("```json\n") + VALID_JSON + "\n```"; });
        assert(r["usedFallback"] == false && r["name"] == "Tomato Paneer Saute");
    }
    std::cout << "LLM-08 passed: fenced JSON parsed.\n";

    // LLM-09: an unavailable provider is never called; fallback is used.
    {
        auto fake = std::make_unique<FakeProvider>("fake", "m", VALID_JSON);
        fake->available = false;
        FakeProvider* raw = fake.get();
        AIGenerator gen(std::move(fake));
        assert(!gen.hasApiKey());
        auto recipe = gen.generateRecipe(prefs());
        assert(raw->calls == 0);
        assert(recipe->toJson()["usedFallback"] == true);
    }
    std::cout << "LLM-09 passed: unavailable provider skipped without a call.\n";

    // LLM-10: health reporting reflects the injected provider.
    {
        AIGenerator gen(std::make_unique<FakeProvider>("fake", "fake-model-9", VALID_JSON));
        assert(gen.hasApiKey());
        assert(gen.getModel() == "fake-model-9");
    }
    std::cout << "LLM-10 passed: hasApiKey()/getModel() reflect the provider.\n";

    std::cout << "All LLMProvider tests passed.\n";
    return 0;
}
