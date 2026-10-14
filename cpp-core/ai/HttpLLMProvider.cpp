#include "HttpLLMProvider.h"
#include "EnvUtil.h"
#include "../security/events/SecurityEventFactory.h"
#include "../security/events/SecurityEventManager.h"
#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace {
bool hasControlChars(const std::string& s) {
    return std::any_of(s.begin(), s.end(), [](unsigned char c) { return c < 0x20 || c == 0x7f; });
}
}

HttpLLMProvider::HttpLLMProvider(std::string providerName_, std::string model_, std::string apiKey_,
                                 std::shared_ptr<HttpClient> http_, long timeoutMs_)
    : providerName(std::move(providerName_)),
      model(trimCopy(model_)),
      apiKey(trimCopy(apiKey_)),
      http(std::move(http_)),
      timeoutMs(timeoutMs_) {
    if (!http) throw std::invalid_argument("HttpLLMProvider requires an HttpClient.");
    // A key containing control characters (e.g. an embedded newline) could
    // inject extra HTTP headers. Treat it as not configured.
    if (hasControlChars(apiKey)) apiKey.clear();
}

bool HttpLLMProvider::isValidModelName(const std::string& name) {
    if (name.empty() || name.size() > 100) return false;
    if (name.find("..") != std::string::npos) return false;
    return std::all_of(name.begin(), name.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '.' || c == '_' || c == '-' || c == ':' || c == '/';
    });
}

LLMErrorKind HttpLLMProvider::kindForHttpStatus(int status) {
    if (status == 429) return LLMErrorKind::RateLimited;
    if (status == 408 || status == 504) return LLMErrorKind::Timeout;
    return LLMErrorKind::HttpError;
}

bool HttpLLMProvider::isAvailable() const {
    if (requiresApiKey() && apiKey.empty()) return false;
    if (!isValidModelName(model)) return false;
    return isConfigurationValid();
}

ProviderStatus HttpLLMProvider::getStatus() const {
    if (requiresApiKey() && apiKey.empty()) return ProviderStatus::ApiKeyMissing;
    if (!isAvailable()) return ProviderStatus::Unavailable;
    return LLMProvider::getStatus();
}

void HttpLLMProvider::reportFailure(const LLMException& e) {
    recordFailure(e);
    if (events) {
        events->emit(SecurityEventFactory::modelFailure(providerName, e.getKind(), e.getHttpStatus()));
    }
}

void HttpLLMProvider::failBadResponse(const std::string& why) const {
    throw LLMException(LLMErrorKind::BadResponse, providerName + ": " + why);
}

std::string HttpLLMProvider::generate(const std::string& prompt) {
    try {
        if (requiresApiKey() && apiKey.empty()) {
            throw LLMException(LLMErrorKind::ApiKeyMissing, providerName + ": API key is not configured.");
        }
        if (!isAvailable()) {
            throw LLMException(LLMErrorKind::Unavailable, providerName + ": provider is not configured correctly.");
        }

        HttpRequest request;
        request.url = endpointUrl();
        request.headers = buildHeaders();
        // error_handler_t::replace: invalid UTF-8 in user text must not abort serialization.
        request.body = buildRequestBody(prompt).dump(-1, ' ', false, json::error_handler_t::replace);
        request.timeoutMs = timeoutMs;

        HttpResponse response = http->post(request);

        if (response.status < 200 || response.status >= 300) {
            // Status code only -- the upstream body is intentionally discarded.
            throw LLMException(kindForHttpStatus(response.status),
                               providerName + ": request failed with HTTP " + std::to_string(response.status),
                               response.status);
        }

        json parsed = json::parse(response.body);
        std::string text = extractText(parsed);
        if (text.empty()) failBadResponse("response contained no text.");

        recordSuccess();
        return text;
    } catch (const LLMException& e) {
        reportFailure(e);
        throw;
    } catch (const json::exception&) {
        LLMException bad(LLMErrorKind::BadResponse, providerName + ": unexpected response format.");
        reportFailure(bad);
        throw bad;
    }
}
