#include "OpenAIProvider.h"
#include "../EnvUtil.h"

namespace { constexpr const char* DEFAULT_MODEL = "gpt-4o-mini"; constexpr int MAX_TOKENS = 1500; }

OpenAIProvider::OpenAIProvider(std::string apiKey, std::string model,
                               std::shared_ptr<HttpClient> http, long timeoutMs)
    : HttpLLMProvider("openai", std::move(model), std::move(apiKey), std::move(http), timeoutMs) {}

std::unique_ptr<OpenAIProvider> OpenAIProvider::fromEnvironment(std::shared_ptr<HttpClient> http) {
    return std::make_unique<OpenAIProvider>(
        readEnv("OPENAI_API_KEY"), readEnvOr("OPENAI_MODEL", DEFAULT_MODEL), std::move(http));
}

std::string OpenAIProvider::endpointUrl() const { return "https://api.openai.com/v1/chat/completions"; }

HttpLLMProvider::Headers OpenAIProvider::buildHeaders() const {
    return {{"content-type", "application/json"}, {"authorization", "Bearer " + key()}};
}

json OpenAIProvider::buildRequestBody(const std::string& prompt) const {
    return json{
        {"model", getModelName()},
        {"max_completion_tokens", MAX_TOKENS},
        {"messages", json::array({json{{"role", "user"}, {"content", prompt}}})},
    };
}

std::string OpenAIProvider::extractText(const json& response) const {
    if (!response.contains("choices") || !response["choices"].is_array() || response["choices"].empty()) {
        failBadResponse("response missing 'choices' array.");
    }
    return response["choices"][0]["message"].value("content", "");
}
