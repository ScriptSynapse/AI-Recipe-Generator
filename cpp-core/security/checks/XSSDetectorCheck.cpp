#include "XSSDetectorCheck.h"
#include "PromptInjectionDetectorCheck.h"
#include "../XSSDetector.h"

SecurityCheckResult XSSDetectorCheck::check(const SecurityContext& context) const {
    SecurityCheckResult result;

    if (!context.preferences) {
        result.outcome = CheckOutcome::Skipped;
        return result;
    }

    std::string text = PromptInjectionDetectorCheck::joinIngredients(context.preferences->getIngredients());
    XSSDetectionResult scan = XSSDetector::scan(text);

    if (scan.safe) {
        result.outcome = CheckOutcome::Passed;
    } else {
        result.outcome = CheckOutcome::Rejected;
        result.code = "XSS_SUSPECTED";
        result.riskLevel = "HIGH";   // markup in an ingredient field has no benign reading
        result.reason = scan.reason;
        result.details = scan.matchedPatterns;
    }
    return result;
}
