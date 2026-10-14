#include "LLMProviderFactory.h"
#include "providers/ClaudeProvider.h"
#include "providers/GeminiProvider.h"
#include "providers/OpenAIProvider.h"
#include "providers/GroqProvider.h"
#include "providers/LocalProvider.h"
#include <algorithm>
#include <cctype>

namespace {
std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}
}

std::vector<std::string> LLMProviderFactory::supportedNames() {
    return {"claude", "gemini", "openai", "groq", "local"};
}

std::unique_ptr<LLMProvider> LLMProviderFactory::create(const std::string& name, std::shared_ptr<HttpClient> http) {
    if (!http) throw std::invalid_argument("LLMProviderFactory::create requires an HttpClient.");
    std::string id = toLower(name);

    if (id == "claude" || id == "anthropic") return ClaudeProvider::fromEnvironment(std::move(http));
    if (id == "gemini" || id == "google") return GeminiProvider::fromEnvironment(std::move(http));
    if (id == "openai" || id == "gpt") return OpenAIProvider::fromEnvironment(std::move(http));
    if (id == "groq") return GroqProvider::fromEnvironment(std::move(http));
    if (id == "local") return LocalProvider::fromEnvironment(std::move(http));

    std::string supported;
    for (const auto& n : supportedNames()) supported += (supported.empty() ? "" : ", ") + n;
    throw std::invalid_argument("Unknown LLM provider '" + name + "'. Supported: " + supported);
}
