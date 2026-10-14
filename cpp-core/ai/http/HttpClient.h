#ifndef HTTP_CLIENT_H
#define HTTP_CLIENT_H

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

/*
 * HttpRequest / HttpResponse / HttpClient
 * -----------------------------------------------------------------------
 * A deliberately tiny HTTP abstraction (POST only -- all LLM APIs used
 * here are JSON POSTs). Providers depend on this interface, not on
 * libcurl (Dependency Inversion): production uses CurlHttpClient, tests
 * inject a scripted fake, and no provider test needs a network.
 *
 * post() returns the response for ANY HTTP status (a 429 is a valid
 * response, not an exception); it throws LLMException only for
 * transport-level failures (timeout, DNS/connect failure, oversized
 * response, invalid request).
 */
struct HttpRequest {
    std::string url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    long timeoutMs = 30000;                        // whole request
    long connectTimeoutMs = 10000;                 // TCP/TLS connect
    size_t maxResponseBytes = 2 * 1024 * 1024;     // abort if exceeded
};

struct HttpResponse {
    int status = 0;
    std::string body;
};

class HttpClient {
public:
    virtual ~HttpClient() = default;
    virtual HttpResponse post(const HttpRequest& request) = 0;
};

#endif // HTTP_CLIENT_H
