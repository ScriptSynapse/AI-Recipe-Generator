#ifndef CURL_HTTP_CLIENT_H
#define CURL_HTTP_CLIENT_H

#include "HttpClient.h"

/*
 * CurlHttpClient -- libcurl implementation of HttpClient.
 *
 * Stateless: every post() uses its own curl handle, so one instance can
 * be shared by providers running on different threads (Phase E).
 *
 * Safety properties (all covered by tests/test_curl_http_client.cpp):
 *  - connect and total timeouts on every request
 *  - response size cap enforced while streaming (not after the fact)
 *  - redirects are NOT followed (a redirect could carry credentials to
 *    another host)
 *  - only http:// and https:// URLs are accepted
 *  - header names/values containing CR or LF are rejected (header
 *    injection)
 *  - header values (which carry API keys) and URLs never appear in
 *    exception messages
 */
class CurlHttpClient : public HttpClient {
public:
    CurlHttpClient();
    HttpResponse post(const HttpRequest& request) override;
};

#endif // CURL_HTTP_CLIENT_H
