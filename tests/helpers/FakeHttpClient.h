#ifndef FAKE_HTTP_CLIENT_H
#define FAKE_HTTP_CLIENT_H
// Test double for HttpClient: scripts a response (or throws), and
// captures the exact request each provider built, so provider tests never
// touch the network.
#include "../../cpp-core/ai/http/HttpClient.h"
#include "../../cpp-core/ai/LLMProvider.h"

class FakeHttpClient : public HttpClient {
public:
    HttpResponse scriptedResponse{200, "{}"};
    bool shouldThrow = false;
    LLMException throwException{LLMErrorKind::Network, "scripted transport failure"};
    HttpRequest lastRequest;
    int callCount = 0;

    HttpResponse post(const HttpRequest& request) override {
        ++callCount;
        lastRequest = request;
        if (shouldThrow) throw throwException;
        return scriptedResponse;
    }
};

#endif
