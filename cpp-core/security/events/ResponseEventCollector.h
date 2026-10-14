#ifndef RESPONSE_EVENT_COLLECTOR_H
#define RESPONSE_EVENT_COLLECTOR_H

#include <mutex>
#include <vector>
#include "SecurityEvent.h"
#include "SecurityEventObserver.h"

/*
 * ResponseEventCollector -- an Observer that remembers every event it is
 * told about, so main.cpp can attach them to the engine's response as
 * "securityEvents" for the Node layer to record and strip.
 *
 * Thread-safe: the AI Model Lab calls several providers concurrently
 * (AIOrchestrator uses std::async), and each can report a failure from its
 * own thread, so appends and reads are guarded by a mutex.
 */
class ResponseEventCollector : public SecurityEventObserver {
public:
    void onSecurityEvent(const SecurityEvent& event) override {
        std::lock_guard<std::mutex> lock(mutex);
        collected.push_back(event);
    }

    std::vector<SecurityEvent> events() const {
        std::lock_guard<std::mutex> lock(mutex);
        return collected;
    }
    bool empty() const {
        std::lock_guard<std::mutex> lock(mutex);
        return collected.empty();
    }

    json toJson() const {
        std::lock_guard<std::mutex> lock(mutex);
        json array = json::array();
        for (const auto& e : collected) array.push_back(e.toJson());
        return array;
    }

private:
    mutable std::mutex mutex;
    std::vector<SecurityEvent> collected;
};

#endif // RESPONSE_EVENT_COLLECTOR_H
