#include "GeminiProvider.h"
#include "../EnvUtil.h"

namespace { constexpr const char* DEFAULT_MODEL = "gemini-2.5-flash"; }

GeminiProvider::GeminiProvider(std::string apiKey, std::string model,
                               std::shared_ptr<HttpClient> http, long timeoutMs)
    : HttpLLMProvider("gemini", std::move(model), std::move(apiKey), std::move(http), timeoutMs) {}

std::unique_ptr<GeminiProvider> GeminiProvider::fromEnvironment(std::shared_ptr<HttpClient> http) {
    return std::make_unique<GeminiProvider>(
        readEnv("GOOGLE_API_KEY"), readEnvOr("GOOGLE_MODEL", DEFAULT_MODEL), std::move(http));
}

bool GeminiProvider::isConfigurationValid() const { return isValidModelName(getModelName()); }

std::string GeminiProvider::endpointUrl() const {
    return "https://generativelanguage.googleapis.com/v1beta/models/" + getModelName() + ":generateContent";
}

HttpLLMProvider::Headers GeminiProvider::buildHeaders() const {
    return {{"content-type", "application/json"}, {"x-goog-api-key", key()}};
}

json GeminiProvider::buildRequestBody(const std::string& prompt) const {
    return json{{"contents", json::array({json{{"parts", json::array({json{{"text", prompt}}})}}})}};
}

std::string GeminiProvider::extractText(const json& response) const {
    if (!response.contains("candidates") || !response["candidates"].is_array() || response["candidates"].empty()) {
        failBadResponse("response missing 'candidates' array.");
    }
    const json& first = response["candidates"][0];
    if (!first.contains("content") || !first["content"].contains("parts")
        || !first["content"]["parts"].is_array() || first["content"]["parts"].empty()) {
        failBadResponse("response missing content.parts.");
    }
    return first["content"]["parts"][0].value("text", "");
}
