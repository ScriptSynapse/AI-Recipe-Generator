#ifndef CLAUDE_PROVIDER_H
#define CLAUDE_PROVIDER_H

#include "../HttpLLMProvider.h"

/*
 * ClaudeProvider -- Adapter for the Anthropic Messages API.
 * Auth: x-api-key + anthropic-version headers (not Bearer).
 * Request: {model, max_tokens, messages:[{role:"user", content}]}
 * Response text: response.content[0].text
 */
class ClaudeProvider : public HttpLLMProvider {
public:
    ClaudeProvider(std::string apiKey, std::string model,
                   std::shared_ptr<HttpClient> http, long timeoutMs = DEFAULT_TIMEOUT_MS);

    // Reads ANTHROPIC_API_KEY / ANTHROPIC_MODEL (falls back to a sane default model).
    static std::unique_ptr<ClaudeProvider> fromEnvironment(std::shared_ptr<HttpClient> http);

protected:
    std::string endpointUrl() const override;
    Headers buildHeaders() const override;
    json buildRequestBody(const std::string& prompt) const override;
    std::string extractText(const json& response) const override;
};

#endif // CLAUDE_PROVIDER_H
