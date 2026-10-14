#ifndef OPENAI_PROVIDER_H
#define OPENAI_PROVIDER_H

#include "../HttpLLMProvider.h"

/*
 * OpenAIProvider -- Adapter for the OpenAI Chat Completions API.
 * Auth: "Authorization: Bearer <key>".
 * Uses max_completion_tokens (max_tokens is deprecated / rejected by
 * newer reasoning models). Response text: choices[0].message.content
 */
class OpenAIProvider : public HttpLLMProvider {
public:
    OpenAIProvider(std::string apiKey, std::string model,
                   std::shared_ptr<HttpClient> http, long timeoutMs = DEFAULT_TIMEOUT_MS);

    static std::unique_ptr<OpenAIProvider> fromEnvironment(std::shared_ptr<HttpClient> http);

protected:
    std::string endpointUrl() const override;
    Headers buildHeaders() const override;
    json buildRequestBody(const std::string& prompt) const override;
    std::string extractText(const json& response) const override;
};

#endif // OPENAI_PROVIDER_H
