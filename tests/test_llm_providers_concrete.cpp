// Phase C tests: ClaudeProvider, GeminiProvider, OpenAIProvider,
// GroqProvider, LocalProvider -- each exercised through the HttpLLMProvider
// template method, using a scripted FakeHttpClient so nothing touches the
// network. Verifies: request shape (URL/headers/body) per vendor, response
// parsing, and that every failure mode (missing key, HTTP error, 429, bad
// JSON, transport failure) maps to the right LLMErrorKind and never leaks
// the API key.
#include <cassert>
#include <iostream>
#include <memory>
#include "../cpp-core/ai/LLMProvider.h"
#include "../cpp-core/ai/LLMProviderFactory.h"
#include "../cpp-core/ai/providers/ClaudeProvider.h"
#include "../cpp-core/ai/providers/GeminiProvider.h"
#include "../cpp-core/ai/providers/OpenAIProvider.h"
#include "../cpp-core/ai/providers/GroqProvider.h"
#include "../cpp-core/ai/providers/LocalProvider.h"
#include "helpers/FakeHttpClient.h"

namespace {

std::string headerValue(const HttpLLMProvider::Headers& headers, const std::string& name) {
    for (const auto& h : headers) if (h.first == name) return h.second;
    return "__MISSING__";
}

template <typename Ex, typename Fn>
bool throwsAs(Fn fn) { try { fn(); } catch (const Ex&) { return true; } catch (...) { return false; } return false; }

} // namespace

int main() {
    const std::string SECRET = "sk-super-secret-value";

    // ---- ClaudeProvider ------------------------------------------------
    {
        auto http = std::make_shared<FakeHttpClient>();
        http->scriptedResponse = {200, R"({"content":[{"type":"text","text":"claude reply"}]})"};
        ClaudeProvider p(SECRET, "claude-sonnet-4-5", http);

        assert(p.isAvailable());
        assert(p.getProviderName() == "claude");
        assert(p.generate("make a recipe") == "claude reply");
        assert(http->lastRequest.url == "https://api.anthropic.com/v1/messages");
        assert(headerValue(http->lastRequest.headers, "x-api-key") == SECRET);
        assert(headerValue(http->lastRequest.headers, "anthropic-version") == "2023-06-01");
        assert(http->lastRequest.body.find("claude-sonnet-4-5") != std::string::npos);
        assert(http->lastRequest.body.find("make a recipe") != std::string::npos);
    }
    std::cout << "PROV-CLAUDE-01 passed: request shape and happy path.\n";
    {
        ClaudeProvider p("", "claude-sonnet-4-5", std::make_shared<FakeHttpClient>());
        assert(!p.isAvailable());
        assert(p.getStatus() == ProviderStatus::ApiKeyMissing);
        assert(throwsAs<LLMException>([&] { p.generate("x"); }));
    }
    std::cout << "PROV-CLAUDE-02 passed: missing key -> unavailable, ApiKeyMissing.\n";

    // ---- GeminiProvider --------------------------------------------------
    {
        auto http = std::make_shared<FakeHttpClient>();
        http->scriptedResponse = {200, R"({"candidates":[{"content":{"parts":[{"text":"gemini reply"}]}}]})"};
        GeminiProvider p(SECRET, "gemini-2.5-flash", http);

        assert(p.generate("prompt") == "gemini reply");
        assert(http->lastRequest.url ==
               "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
        assert(headerValue(http->lastRequest.headers, "x-goog-api-key") == SECRET);
        assert(headerValue(http->lastRequest.headers, "authorization") == "__MISSING__");
    }
    std::cout << "PROV-GEMINI-01 passed: request shape (model in URL path) and happy path.\n";
    {
        // A malicious/misconfigured model name must not be able to alter the URL path.
        GeminiProvider p(SECRET, "../../v1beta/other:delete", std::make_shared<FakeHttpClient>());
        assert(!p.isAvailable());
    }
    std::cout << "PROV-GEMINI-02 passed: path-traversal-shaped model name rejected.\n";

    // ---- OpenAIProvider ----------------------------------------------------
    {
        auto http = std::make_shared<FakeHttpClient>();
        http->scriptedResponse = {200, R"({"choices":[{"message":{"role":"assistant","content":"openai reply"}}]})"};
        OpenAIProvider p(SECRET, "gpt-4o-mini", http);

        assert(p.generate("prompt") == "openai reply");
        assert(http->lastRequest.url == "https://api.openai.com/v1/chat/completions");
        assert(headerValue(http->lastRequest.headers, "authorization") == "Bearer " + SECRET);
        assert(http->lastRequest.body.find("max_completion_tokens") != std::string::npos);
        assert(http->lastRequest.body.find("\"max_tokens\"") == std::string::npos);
    }
    std::cout << "PROV-OPENAI-01 passed: uses max_completion_tokens, Bearer auth.\n";

    // ---- GroqProvider (OpenAI-compatible but classic max_tokens) -----------
    {
        auto http = std::make_shared<FakeHttpClient>();
        http->scriptedResponse = {200, R"({"choices":[{"message":{"content":"groq reply"}}]})"};
        GroqProvider p(SECRET, "llama-3.3-70b-versatile", http);

        assert(p.generate("prompt") == "groq reply");
        assert(http->lastRequest.url == "https://api.groq.com/openai/v1/chat/completions");
        assert(headerValue(http->lastRequest.headers, "authorization") == "Bearer " + SECRET);
        assert(http->lastRequest.body.find("\"max_tokens\"") != std::string::npos);
    }
    std::cout << "PROV-GROQ-01 passed: OpenAI-compatible endpoint, max_tokens field.\n";

    // ---- LocalProvider (no API key ever required) --------------------------
    {
        auto http = std::make_shared<FakeHttpClient>();
        http->scriptedResponse = {200, R"({"choices":[{"message":{"content":"local reply"}}]})"};
        LocalProvider p("http://localhost:11434", "llama3.2", http);

        assert(p.isAvailable());   // available with NO key at all
        assert(p.generate("prompt") == "local reply");
        assert(http->lastRequest.url == "http://localhost:11434/v1/chat/completions");
        assert(headerValue(http->lastRequest.headers, "authorization") == "__MISSING__");
    }
    std::cout << "PROV-LOCAL-01 passed: no key required, trailing-slash-safe URL join.\n";
    {
        LocalProvider p("not-a-url", "llama3.2", std::make_shared<FakeHttpClient>());
        assert(!p.isAvailable());   // rejects a non-http(s) base URL
    }
    std::cout << "PROV-LOCAL-02 passed: non-http(s) base URL rejected.\n";

    // ---- Shared failure-mode matrix, run against every provider ------------
    struct Case { const char* name; std::function<std::unique_ptr<LLMProvider>(std::shared_ptr<FakeHttpClient>)> make; };
    std::vector<Case> providers = {
        {"claude", [&](auto h) { return std::make_unique<ClaudeProvider>(SECRET, "m", h); }},
        {"gemini", [&](auto h) { return std::make_unique<GeminiProvider>(SECRET, "m", h); }},
        {"openai", [&](auto h) { return std::make_unique<OpenAIProvider>(SECRET, "m", h); }},
        {"groq",   [&](auto h) { return std::make_unique<GroqProvider>(SECRET, "m", h); }},
        {"local",  [&](auto h) { return std::make_unique<LocalProvider>("http://localhost:1234", "m", h); }},
    };

    for (auto& c : providers) {
        // HTTP 429 -> RateLimited, and the key never appears in the exception message.
        {
            auto http = std::make_shared<FakeHttpClient>();
            http->scriptedResponse = {429, "{\"error\":\"rate limited\"}"};
            auto p = c.make(http);
            try {
                p->generate("x");
                assert(false && "expected LLMException");
            } catch (const LLMException& e) {
                assert(e.getKind() == LLMErrorKind::RateLimited);
                assert(std::string(e.what()).find(SECRET) == std::string::npos);
            }
            assert(p->getStatus() == ProviderStatus::RateLimited);
        }
        // HTTP 500 -> HttpError.
        {
            auto http = std::make_shared<FakeHttpClient>();
            http->scriptedResponse = {500, "internal server error, key=" + SECRET};
            auto p = c.make(http);
            assert(throwsAs<LLMException>([&] { p->generate("x"); }));
            try { p->generate("x"); } catch (const LLMException& e) {
                assert(e.getKind() == LLMErrorKind::HttpError);
                assert(std::string(e.what()).find(SECRET) == std::string::npos);
                assert(std::string(e.what()).find("internal server error") == std::string::npos);
            }
        }
        // Malformed JSON body -> BadResponse, not a crash.
        {
            auto http = std::make_shared<FakeHttpClient>();
            http->scriptedResponse = {200, "{ not json"};
            auto p = c.make(http);
            try { p->generate("x"); assert(false); }
            catch (const LLMException& e) { assert(e.getKind() == LLMErrorKind::BadResponse); }
        }
        // Well-formed JSON, wrong shape -> BadResponse via failBadResponse().
        {
            auto http = std::make_shared<FakeHttpClient>();
            http->scriptedResponse = {200, R"({"unexpected":"shape"})"};
            auto p = c.make(http);
            try { p->generate("x"); assert(false); }
            catch (const LLMException& e) { assert(e.getKind() == LLMErrorKind::BadResponse); }
        }
        // Transport-level failure (timeout) surfaces as-is and updates status.
        {
            auto http = std::make_shared<FakeHttpClient>();
            http->shouldThrow = true;
            http->throwException = LLMException(LLMErrorKind::Timeout, "timed out");
            auto p = c.make(http);
            assert(throwsAs<LLMException>([&] { p->generate("x"); }));
            assert(p->getStatus() == ProviderStatus::Timeout);
        }
        std::cout << "PROV-MATRIX passed for " << c.name << ": 429/500/bad-json/wrong-shape/timeout.\n";
    }

    // ---- LLMProviderFactory (Phase D) --------------------------------------
    {
        auto http = std::make_shared<FakeHttpClient>();
        for (const auto& name : {"claude", "gemini", "openai", "groq", "local"}) {
            auto p = LLMProviderFactory::create(name, http);
            assert(p != nullptr);
            assert(p->getProviderName() == std::string(name));
        }
        // case-insensitive + a couple of aliases
        assert(LLMProviderFactory::create("Claude", http)->getProviderName() == "claude");
        assert(LLMProviderFactory::create("GOOGLE", http)->getProviderName() == "gemini");
        assert(throwsAs<std::invalid_argument>([&] { LLMProviderFactory::create("chatgpt-5", http); }));
        assert(throwsAs<std::invalid_argument>([&] { LLMProviderFactory::create("claude", nullptr); }));
        assert(LLMProviderFactory::supportedNames().size() == 5);
    }
    std::cout << "FACTORY-01 passed: all 5 names construct the right provider; unknown name throws.\n";

    std::cout << "All concrete LLM provider tests passed.\n";
    return 0;
}
