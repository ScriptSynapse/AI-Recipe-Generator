#ifndef GROQ_PROVIDER_H
#define GROQ_PROVIDER_H

#include "../HttpLLMProvider.h"

/*
 * GroqProvider -- Adapter for Groq's OpenAI-compatible chat completions
 * endpoint. Request/response shape matches OpenAIProvider except Groq
 * uses the classic `max_tokens` field, so this is NOT simply reused via
 * inheritance from OpenAIProvider (a genuine, if small, format
 * difference -- composition over convenience inheritance).
 */
class GroqProvider : public HttpLLMProvider {
public:
    GroqProvider(std::string apiKey, std::string model,
                std::shared_ptr<HttpClient> http, long timeoutMs = DEFAULT_TIMEOUT_MS);

    static std::unique_ptr<GroqProvider> fromEnvironment(std::shared_ptr<HttpClient> http);

protected:
    std::string endpointUrl() const override;
    Headers buildHeaders() const override;
    json buildRequestBody(const std::string& prompt) const override;
    std::string extractText(const json& response) const override;
};

#endif // GROQ_PROVIDER_H
