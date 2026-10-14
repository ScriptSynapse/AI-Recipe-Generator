#ifndef XSS_DETECTOR_CHECK_H
#define XSS_DETECTOR_CHECK_H

#include "../SecurityCheck.h"

/*
 * XSSDetectorCheck -- the SecurityPipeline node (per the spec's Chain-of-
 * Responsibility diagram) wrapping XSSDetector. Scans the same joined
 * ingredient text as PromptInjectionDetectorCheck (reuses its exact join
 * logic, so both checks see precisely the text that reaches the prompt).
 *
 * Skipped if `context.preferences` is null.
 */
class XSSDetectorCheck : public SecurityCheck {
public:
    std::string getName() const override { return "XSSDetector"; }
    SecurityCheckResult check(const SecurityContext& context) const override;
};

#endif // XSS_DETECTOR_CHECK_H
