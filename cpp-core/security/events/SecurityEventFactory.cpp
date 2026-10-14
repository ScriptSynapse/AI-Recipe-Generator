#include "SecurityEventFactory.h"
#include "../SecurityPipeline.h"

namespace {

EventSeverity severityFromRiskLevel(const std::string& riskLevel, EventSeverity fallback) {
    if (riskLevel == "HIGH") return EventSeverity::High;
    if (riskLevel == "MEDIUM") return EventSeverity::Medium;
    if (riskLevel == "LOW") return EventSeverity::Low;
    return fallback;
}

} // namespace

const char* SecurityEventFactory::kindName(LLMErrorKind kind) {
    switch (kind) {
        case LLMErrorKind::ApiKeyMissing: return "API_KEY_MISSING";
        case LLMErrorKind::Timeout:       return "TIMEOUT";
        case LLMErrorKind::RateLimited:   return "RATE_LIMITED";
        case LLMErrorKind::Network:       return "NETWORK";
        case LLMErrorKind::HttpError:     return "HTTP_ERROR";
        case LLMErrorKind::BadResponse:   return "BAD_RESPONSE";
        case LLMErrorKind::Unavailable:   return "UNAVAILABLE";
    }
    return "UNAVAILABLE";
}

std::vector<SecurityEvent> SecurityEventFactory::fromPipelineResults(const std::vector<SecurityCheckResult>& results,
                                                                     const std::string& action) {
    std::vector<SecurityEvent> events;

    if (const SecurityCheckResult* rejection = SecurityPipeline::firstRejection(results)) {
        SecurityEvent event;
        event.action = action;
        event.reason = rejection->reason;                   // fixed text from the check (never user input)
        event.details = json::object();
        event.details["check"] = rejection->checkName;
        event.details["code"] = rejection->code;

        if (rejection->checkName == "PromptInjectionDetector") {
            event.type = SecurityEventType::PromptInjection;
            event.severity = severityFromRiskLevel(rejection->riskLevel, EventSeverity::High);
            event.result = EventResult::Blocked;
            event.details["matchedCategories"] = rejection->details;      // category names only
        } else if (rejection->checkName == "XSSDetector") {
            event.type = SecurityEventType::XssAttempt;
            event.severity = severityFromRiskLevel(rejection->riskLevel, EventSeverity::High);
            event.result = EventResult::Blocked;
            event.details["matchedPatterns"] = rejection->details;        // category names only
        } else {
            // InputValidator, and -- until it has its own event type -- any
            // check added to the pipeline later: recorded as a rejected input.
            event.type = SecurityEventType::InvalidInput;
            event.severity = severityFromRiskLevel(rejection->riskLevel, EventSeverity::Low);
            event.result = EventResult::Rejected;
        }
        events.push_back(event);
        return events;
    }

    SecurityEvent scan;
    scan.type = SecurityEventType::SecurityScan;
    scan.severity = EventSeverity::Info;
    scan.action = action;
    scan.result = EventResult::Success;
    scan.reason = "Input security scan completed with no findings.";
    json checks = json::array();
    for (const auto& r : results) checks.push_back(json{{"name", r.checkName}, {"outcome", toString(r.outcome)}});
    scan.details = json{{"checks", checks}};
    events.push_back(scan);
    return events;
}

SecurityEvent SecurityEventFactory::modelFailure(const std::string& provider, LLMErrorKind kind, int httpStatus) {
    SecurityEvent event;
    event.type = SecurityEventType::ModelFailure;
    event.action = "generate";
    event.result = EventResult::Failure;
    event.provider = provider;

    // Transient conditions are routine and low-severity; a provider that
    // answers with an error or garbage is more worth a look.
    switch (kind) {
        case LLMErrorKind::HttpError:
        case LLMErrorKind::BadResponse:   event.severity = EventSeverity::Medium; break;
        default:                          event.severity = EventSeverity::Low;    break;
    }
    switch (kind) {
        case LLMErrorKind::ApiKeyMissing: event.reason = "Provider API key is not configured."; break;
        case LLMErrorKind::Timeout:       event.reason = "Provider request timed out."; break;
        case LLMErrorKind::RateLimited:   event.reason = "Provider rate limit reached."; break;
        case LLMErrorKind::Network:       event.reason = "Provider could not be reached."; break;
        case LLMErrorKind::HttpError:     event.reason = "Provider returned an error response."; break;
        case LLMErrorKind::BadResponse:   event.reason = "Provider returned an unreadable response."; break;
        case LLMErrorKind::Unavailable:   event.reason = "Provider is unavailable."; break;
    }
    event.details = json{{"kind", kindName(kind)}};
    if (httpStatus > 0) event.details["httpStatus"] = httpStatus;
    return event;
}

SecurityEvent SecurityEventFactory::aiOutputRejected(const std::string& provider, const std::vector<std::string>& issues) {
    SecurityEvent event;
    event.type = SecurityEventType::AiOutputRejected;
    event.severity = EventSeverity::Medium;
    event.action = "generate";
    event.result = EventResult::Rejected;
    event.provider = provider;
    event.reason = "Provider response failed output validation.";
    event.details = json{{"issueCount", issues.size()}, {"issues", issues}};   // value-free by AIOutputValidator's design
    return event;
}
