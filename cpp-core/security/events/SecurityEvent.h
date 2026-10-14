#ifndef SECURITY_EVENT_H
#define SECURITY_EVENT_H

#include <string>
#include "../../json.hpp"

using json = nlohmann::json;

/*
 * SecurityEvent -- one thing the audit log should know about.
 *
 * The engine emits these while handling a request; Node adds what only
 * Node knows (request id, user id, client IP) and writes them to the
 * SecurityAuditLog. The engine itself has no notion of users or requests.
 *
 * Content rule (same discipline as AIOutputValidationException and
 * PromptSecurityResult): `reason` and `details` are built ONLY from fixed,
 * developer-written text, field names and category names -- never from
 * what the user typed or what a model returned. An audit log that echoed
 * attacker-controlled text would become a vehicle for log injection and
 * could capture secrets a user pasted into a form by mistake.
 */
enum class SecurityEventType {
    PromptInjection, XssAttempt, InvalidInput, AiOutputRejected, ModelFailure, SecurityScan
};

enum class EventSeverity { Info, Low, Medium, High };

enum class EventResult { Success, Failure, Blocked, Rejected };

inline const char* toString(SecurityEventType t) {
    switch (t) {
        case SecurityEventType::PromptInjection:   return "PROMPT_INJECTION";
        case SecurityEventType::XssAttempt:        return "XSS_ATTEMPT";
        case SecurityEventType::InvalidInput:      return "INVALID_INPUT";
        case SecurityEventType::AiOutputRejected:  return "AI_OUTPUT_REJECTED";
        case SecurityEventType::ModelFailure:      return "MODEL_FAILURE";
        case SecurityEventType::SecurityScan:      return "SECURITY_SCAN";
    }
    return "SECURITY_SCAN";
}

inline const char* toString(EventSeverity s) {
    switch (s) {
        case EventSeverity::Info:   return "INFO";
        case EventSeverity::Low:    return "LOW";
        case EventSeverity::Medium: return "MEDIUM";
        case EventSeverity::High:   return "HIGH";
    }
    return "INFO";
}

inline const char* toString(EventResult r) {
    switch (r) {
        case EventResult::Success:  return "SUCCESS";
        case EventResult::Failure:  return "FAILURE";
        case EventResult::Blocked:  return "BLOCKED";
        case EventResult::Rejected: return "REJECTED";
    }
    return "FAILURE";
}

struct SecurityEvent {
    SecurityEventType type = SecurityEventType::SecurityScan;
    EventSeverity severity = EventSeverity::Info;
    std::string action;          // what was being attempted, e.g. "generate"
    EventResult result = EventResult::Success;
    std::string reason;          // fixed text describing the outcome
    std::string provider;        // LLM provider involved, if any
    json details = json::object();

    json toJson() const {
        json j{
            {"type", toString(type)},
            {"severity", toString(severity)},
            {"action", action},
            {"result", toString(result)},
            {"reason", reason},
            {"details", details},
        };
        if (!provider.empty()) j["provider"] = provider;
        return j;
    }
};

#endif // SECURITY_EVENT_H
