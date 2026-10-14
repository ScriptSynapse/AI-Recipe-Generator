#ifndef HTTP_LLM_PROVIDER_H
#define HTTP_LLM_PROVIDER_H

#include <memory>
#include <string>
#include <utility>
#include <vector>
#include "LLMProvider.h"
#include "http/HttpClient.h"
#include "../json.hpp"

using json = nlohmann::json;

/*
 * HttpLLMProvider (abstract) -- Template Method + Adapter base
 * -----------------------------------------------------------------------
 * All cloud/local providers here share the same skeleton:
 *
 *      check configuration -> build request -> POST -> map HTTP status ->
 *      parse vendor JSON -> record health -> return text
 *
 * generate() implements that skeleton ONCE (the template method). Each
 * vendor adapter only supplies the parts that differ, via protected pure
 * virtual hooks: endpointUrl(), buildHeaders(), buildRequestBody() and
 * extractText(). That is the Adapter pattern: the vendor's request and
 * response formats never leak past these four methods.
 *
 * Security properties enforced here for every provider:
 *  - API keys live only in headers; they are never placed in URLs, request
 *    bodies, exception messages or logs.
 *  - Keys/model names containing control characters are rejected (header
 *    and path injection); the provider then reports itself unavailable.
 *  - Upstream error bodies are never copied into exceptions (some vendors
 *    echo fragments of the key in 401 responses).
 */
class HttpLLMProvider : public LLMProvider {
public:
    using Headers = std::vector<std::pair<std::string, std::string>>;

    static const long DEFAULT_TIMEOUT_MS = 30000;

    std::string generate(const std::string& prompt) override;
    std::string getProviderName() const override { return providerName; }
    std::string getModelName() const override { return model; }
    bool isAvailable() const override;
    ProviderStatus getStatus() const override;
    void setEventManager(SecurityEventManager* manager) override { events = manager; }

    // HTTP status -> error kind (429 rate limited, 408/504 timeout, else http error).
    static LLMErrorKind kindForHttpStatus(int status);
    // Model identifiers are used in URLs/JSON: allow only [A-Za-z0-9._:/-], no "..".
    static bool isValidModelName(const std::string& name);

protected:
    HttpLLMProvider(std::string providerName, std::string model, std::string apiKey,
                    std::shared_ptr<HttpClient> http, long timeoutMs);

    const std::string& key() const { return apiKey; }

    // Hooks (Adapter):
    virtual std::string endpointUrl() const = 0;
    virtual Headers buildHeaders() const = 0;                       // includes auth
    virtual json buildRequestBody(const std::string& prompt) const = 0;
    virtual std::string extractText(const json& response) const = 0; // throws LLMException(BadResponse)

    // Configuration hooks (overridable):
    virtual bool requiresApiKey() const { return true; }
    virtual bool isConfigurationValid() const { return true; }      // extra checks (URL, model charset)

    // Helper for extractText() implementations.
    [[noreturn]] void failBadResponse(const std::string& why) const;

private:
    std::string providerName;
    std::string model;
    std::string apiKey;
    std::shared_ptr<HttpClient> http;
    long timeoutMs;
    SecurityEventManager* events = nullptr;     // optional, not owned

    // Records the failure for health reporting AND reports it to the audit trail.
    void reportFailure(const LLMException& e);
};

#endif // HTTP_LLM_PROVIDER_H
