#include "CurlHttpClient.h"
#include "../LLMProvider.h"
#include <curl/curl.h>
#include <mutex>

namespace {

std::once_flag curlGlobalInitFlag;

struct WriteContext {
    std::string body;
    size_t maxBytes = 0;
    bool exceeded = false;
};

size_t writeCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    auto* ctx = static_cast<WriteContext*>(userp);
    size_t total = size * nmemb;
    if (ctx->body.size() + total > ctx->maxBytes) {
        ctx->exceeded = true;
        return 0;   // tells libcurl to abort the transfer (CURLE_WRITE_ERROR)
    }
    ctx->body.append(static_cast<char*>(contents), total);
    return total;
}

bool hasLineBreak(const std::string& s) {
    return s.find('\r') != std::string::npos || s.find('\n') != std::string::npos
        || s.find('\0') != std::string::npos;
}

bool hasAllowedScheme(const std::string& url) {
    return url.rfind("https://", 0) == 0 || url.rfind("http://", 0) == 0;
}

// RAII owner for the curl handle and header list: released on every path,
// including exceptions.
struct CurlSession {
    CURL* handle = nullptr;
    struct curl_slist* headers = nullptr;
    CurlSession() : handle(curl_easy_init()) {}
    ~CurlSession() {
        if (headers) curl_slist_free_all(headers);
        if (handle) curl_easy_cleanup(handle);
    }
    CurlSession(const CurlSession&) = delete;
    CurlSession& operator=(const CurlSession&) = delete;
};

} // namespace

CurlHttpClient::CurlHttpClient() {
    std::call_once(curlGlobalInitFlag, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

HttpResponse CurlHttpClient::post(const HttpRequest& request) {
    if (!hasAllowedScheme(request.url) || hasLineBreak(request.url)) {
        throw LLMException(LLMErrorKind::Unavailable, "Refusing request: URL must be http:// or https://.");
    }

    CurlSession session;
    if (!session.handle) {
        throw LLMException(LLMErrorKind::Network, "Failed to initialize HTTP client.");
    }

    for (const auto& header : request.headers) {
        if (header.first.empty() || hasLineBreak(header.first) || hasLineBreak(header.second)
            || header.first.find(':') != std::string::npos) {
            throw LLMException(LLMErrorKind::Unavailable, "Refusing request: invalid HTTP header.");
        }
        std::string line = header.first + ": " + header.second;
        session.headers = curl_slist_append(session.headers, line.c_str());
    }

    WriteContext ctx;
    ctx.maxBytes = request.maxResponseBytes;

    CURL* curl = session.handle;
    curl_easy_setopt(curl, CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, session.headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, request.body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(request.body.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &ctx);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, request.timeoutMs);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, request.connectTimeoutMs);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);          // required for timeouts in threaded programs
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);    // never follow redirects with credentials attached

    CURLcode result = curl_easy_perform(curl);

    if (ctx.exceeded) {
        throw LLMException(LLMErrorKind::BadResponse, "Provider response exceeded the size limit.");
    }
    if (result == CURLE_OPERATION_TIMEDOUT) {
        throw LLMException(LLMErrorKind::Timeout, "Request to provider timed out.");
    }
    if (result != CURLE_OK) {
        // curl_easy_strerror text is generic (no URL, no headers).
        throw LLMException(LLMErrorKind::Network,
                           std::string("Could not reach provider: ") + curl_easy_strerror(result));
    }

    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);

    HttpResponse response;
    response.status = static_cast<int>(status);
    response.body = std::move(ctx.body);
    return response;
}
