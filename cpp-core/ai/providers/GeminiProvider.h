#ifndef GEMINI_PROVIDER_H
#define GEMINI_PROVIDER_H

#include "../HttpLLMProvider.h"

/*
 * GeminiProvider -- Adapter for the Google Gemini generateContent API.
 * Auth: x-goog-api-key header. Model is part of the URL path, so it is
 * validated (isValidModelName) before being concatenated in -- otherwise
 * a malicious/misconfigured GOOGLE_MODEL could redirect the request path.
 * Request: {contents:[{parts:[{text}]}]}
 * Response text: response.candidates[0].content.parts[0].text
 */
class GeminiProvider : public HttpLLMProvider {
public:
    GeminiProvider(std::string apiKey, std::string model,
                   std::shared_ptr<HttpClient> http, long timeoutMs = DEFAULT_TIMEOUT_MS);

    static std::unique_ptr<GeminiProvider> fromEnvironment(std::shared_ptr<HttpClient> http);

protected:
    std::string endpointUrl() const override;
    Headers buildHeaders() const override;
    json buildRequestBody(const std::string& prompt) const override;
    std::string extractText(const json& response) const override;
    bool isConfigurationValid() const override;
};

#endif // GEMINI_PROVIDER_H
