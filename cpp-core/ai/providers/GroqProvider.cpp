#include "GroqProvider.h"
#include "../EnvUtil.h"

namespace { constexpr const char* DEFAULT_MODEL = "llama-3.3-70b-versatile"; constexpr int MAX_TOKENS = 1500; }

GroqProvider::GroqProvider(std::string apiKey, std::string model,
                           std::shared_ptr<HttpClient> http, long timeoutMs)
    : HttpLLMProvider("groq", std::move(model), std::move(apiKey), std::move(http), timeoutMs) {}

std::unique_ptr<GroqProvider> GroqProvider::fromEnvironment(std::shared_ptr<HttpClient> http) {
    return std::make_unique<GroqProvider>(
        readEnv("GROQ_API_KEY"), readEnvOr("GROQ_MODEL", DEFAULT_MODEL), std::move(http));
}

std::string GroqProvider::endpointUrl() const { return "https://api.groq.com/openai/v1/chat/completions"; }

HttpLLMProvider::Headers GroqProvider::buildHeaders() const {
    return {{"content-type", "application/json"}, {"authorization", "Bearer " + key()}};
}

json GroqProvider::buildRequestBody(const std::string& prompt) const {
    return json{
        {"model", getModelName()},
        {"max_tokens", MAX_TOKENS},
        {"messages", json::array({json{{"role", "user"}, {"content", prompt}}})},
    };
}

std::string GroqProvider::extractText(const json& response) const {
    if (!response.contains("choices") || !response["choices"].is_array() || response["choices"].empty()) {
        failBadResponse("response missing 'choices' array.");
    }
    return response["choices"][0]["message"].value("content", "");
}
