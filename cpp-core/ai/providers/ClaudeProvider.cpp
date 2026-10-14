#include "ClaudeProvider.h"
#include "../EnvUtil.h"

namespace { constexpr const char* DEFAULT_MODEL = "claude-sonnet-4-5"; constexpr int MAX_TOKENS = 1500; }

ClaudeProvider::ClaudeProvider(std::string apiKey, std::string model,
                               std::shared_ptr<HttpClient> http, long timeoutMs)
    : HttpLLMProvider("claude", std::move(model), std::move(apiKey), std::move(http), timeoutMs) {}

std::unique_ptr<ClaudeProvider> ClaudeProvider::fromEnvironment(std::shared_ptr<HttpClient> http) {
    return std::make_unique<ClaudeProvider>(
        readEnv("ANTHROPIC_API_KEY"), readEnvOr("ANTHROPIC_MODEL", DEFAULT_MODEL), std::move(http));
}

std::string ClaudeProvider::endpointUrl() const { return "https://api.anthropic.com/v1/messages"; }

HttpLLMProvider::Headers ClaudeProvider::buildHeaders() const {
    return {
        {"content-type", "application/json"},
        {"x-api-key", key()},
        {"anthropic-version", "2023-06-01"},
    };
}

json ClaudeProvider::buildRequestBody(const std::string& prompt) const {
    return json{
        {"model", getModelName()},
        {"max_tokens", MAX_TOKENS},
        {"messages", json::array({json{{"role", "user"}, {"content", prompt}}})},
    };
}

std::string ClaudeProvider::extractText(const json& response) const {
    if (!response.contains("content") || !response["content"].is_array() || response["content"].empty()) {
        failBadResponse("response missing 'content' array.");
    }
    return response["content"][0].value("text", "");
}
