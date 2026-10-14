#ifndef FAKE_PROVIDER_H
#define FAKE_PROVIDER_H
// Test double for LLMProvider: scripted responses/failures, call counting,
// and prompt capture. Reused by the orchestrator/router tests in later phases.
#include <chrono>
#include <string>
#include <thread>
#include "../../cpp-core/ai/LLMProvider.h"

class FakeProvider : public LLMProvider {
public:
    std::string name;
    std::string model;
    bool available = true;
    std::string response;                 // returned when no failure is scripted
    bool shouldThrow = false;
    LLMErrorKind failureKind = LLMErrorKind::Network;
    int failureHttpStatus = 0;
    int calls = 0;
    std::string lastPrompt;
    int delayMs = 0;   // simulated latency, for concurrency tests

    FakeProvider(std::string n, std::string m, std::string r = "")
        : name(std::move(n)), model(std::move(m)), response(std::move(r)) {}

    std::string generate(const std::string& prompt) override {
        ++calls;
        lastPrompt = prompt;
        if (delayMs > 0) std::this_thread::sleep_for(std::chrono::milliseconds(delayMs));
        if (shouldThrow) {
            LLMException e(failureKind, "scripted failure", failureHttpStatus);
            recordFailure(e);
            throw e;
        }
        recordSuccess();
        return response;
    }
    std::string getProviderName() const override { return name; }
    std::string getModelName() const override { return model; }
    bool isAvailable() const override { return available; }
};

#endif
