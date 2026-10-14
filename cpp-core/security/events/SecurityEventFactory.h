#ifndef SECURITY_EVENT_FACTORY_H
#define SECURITY_EVENT_FACTORY_H

#include <string>
#include <vector>
#include "SecurityEvent.h"
#include "../SecurityCheckResult.h"
#include "../../ai/LLMProvider.h"

/*
 * SecurityEventFactory -- turns things that happened into SecurityEvents.
 * Keeping this mapping in one testable place (rather than inline in
 * main.cpp or in each provider) is what lets the tests prove two things
 * for every event it can produce: the severity is graded sensibly, and
 * nothing user- or model-supplied ever ends up in the event text.
 */
class SecurityEventFactory {
public:
    // Pipeline outcome:
    //  - a rejection -> ONE event describing the threat (INVALID_INPUT,
    //    PROMPT_INJECTION or XSS_ATTEMPT, severity from the check's risk level);
    //  - no rejection -> ONE SECURITY_SCAN event (INFO) listing the checks that ran.
    // A blocked scan deliberately does NOT also produce a SECURITY_SCAN
    // event: the threat event already says so, and emitting both would make
    // every dashboard count a single blocked request twice.
    static std::vector<SecurityEvent> fromPipelineResults(const std::vector<SecurityCheckResult>& results,
                                                          const std::string& action);

    // An LLM provider call that failed (timeout, rate limit, bad HTTP status, ...).
    static SecurityEvent modelFailure(const std::string& provider, LLMErrorKind kind, int httpStatus);

    // A provider answered, but the answer failed schema validation. `issues`
    // are AIOutputValidator's value-free field descriptions.
    static SecurityEvent aiOutputRejected(const std::string& provider, const std::vector<std::string>& issues);

    // Stable name for an LLMErrorKind, e.g. "RATE_LIMITED".
    static const char* kindName(LLMErrorKind kind);
};

#endif // SECURITY_EVENT_FACTORY_H
