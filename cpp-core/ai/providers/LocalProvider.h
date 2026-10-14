#ifndef LOCAL_PROVIDER_H
#define LOCAL_PROVIDER_H

#include "../HttpLLMProvider.h"

/*
 * LocalProvider -- Adapter for a self-hosted, OpenAI-compatible chat
 * endpoint (e.g. Ollama's `/v1/chat/completions`, LM Studio, vLLM). No
 * API key is required: requiresApiKey() is false, since a local model
 * server typically has none, and it should be usable purely by running
 * it -- no cloud account, no key management.
 *
 * This is NOT the same thing as AIGenerator's offline template fallback
 * (RecipeTemplateEngine): that fallback has zero dependencies and always
 * succeeds, and remains the final safety net if every configured
 * provider -- including this one -- is unavailable or fails. LocalProvider
 * is one more Strategy the ModelRouter/AIOrchestrator can pick or fail
 * over to; it still requires a model server to actually be running.
 */
class LocalProvider : public HttpLLMProvider {
public:
    LocalProvider(std::string baseUrl, std::string model,
                  std::shared_ptr<HttpClient> http, long timeoutMs = DEFAULT_TIMEOUT_MS);

    // Reads LOCAL_LLM_URL (default http://localhost:11434) and
    // LOCAL_LLM_MODEL (default llama3.2). No API key is ever read.
    static std::unique_ptr<LocalProvider> fromEnvironment(std::shared_ptr<HttpClient> http);

protected:
    bool requiresApiKey() const override { return false; }
    bool isConfigurationValid() const override;
    std::string endpointUrl() const override;
    Headers buildHeaders() const override;
    json buildRequestBody(const std::string& prompt) const override;
    std::string extractText(const json& response) const override;

private:
    std::string baseUrl;
};

#endif // LOCAL_PROVIDER_H
