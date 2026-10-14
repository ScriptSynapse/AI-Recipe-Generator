#include "LocalProvider.h"
#include "../EnvUtil.h"

namespace {
constexpr const char* DEFAULT_URL = "http://localhost:11434";
constexpr const char* DEFAULT_MODEL = "llama3.2";
constexpr int MAX_TOKENS = 1500;
}

LocalProvider::LocalProvider(std::string baseUrl_, std::string model,
                             std::shared_ptr<HttpClient> http, long timeoutMs)
    : HttpLLMProvider("local", std::move(model), /*apiKey=*/"", std::move(http), timeoutMs),
      baseUrl(trimCopy(baseUrl_)) {
    // Strip a trailing slash so endpointUrl() never produces "//v1/...".
    while (!baseUrl.empty() && baseUrl.back() == '/') baseUrl.pop_back();
}

std::unique_ptr<LocalProvider> LocalProvider::fromEnvironment(std::shared_ptr<HttpClient> http) {
    return std::make_unique<LocalProvider>(
        readEnvOr("LOCAL_LLM_URL", DEFAULT_URL), readEnvOr("LOCAL_LLM_MODEL", DEFAULT_MODEL), std::move(http));
}

bool LocalProvider::isConfigurationValid() const {
    if (baseUrl.rfind("http://", 0) != 0 && baseUrl.rfind("https://", 0) != 0) return false;
    return isValidModelName(getModelName());
}

std::string LocalProvider::endpointUrl() const { return baseUrl + "/v1/chat/completions"; }

HttpLLMProvider::Headers LocalProvider::buildHeaders() const {
    return {{"content-type", "application/json"}};   // no auth: local server, no API key
}

json LocalProvider::buildRequestBody(const std::string& prompt) const {
    return json{
        {"model", getModelName()},
        {"max_tokens", MAX_TOKENS},
        {"messages", json::array({json{{"role", "user"}, {"content", prompt}}})},
    };
}

std::string LocalProvider::extractText(const json& response) const {
    if (!response.contains("choices") || !response["choices"].is_array() || response["choices"].empty()) {
        failBadResponse("response missing 'choices' array.");
    }
    return response["choices"][0]["message"].value("content", "");
}
