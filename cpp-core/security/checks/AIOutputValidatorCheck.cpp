#include "AIOutputValidatorCheck.h"
#include "../../validation/AIOutputValidator.h"

SecurityCheckResult AIOutputValidatorCheck::check(const SecurityContext& context) const {
    SecurityCheckResult result;

    if (!context.rawProviderResponse) {
        result.outcome = CheckOutcome::Skipped;
        return result;
    }

    try {
        AIOutputValidator::validateAndParse(*context.rawProviderResponse);
        result.outcome = CheckOutcome::Passed;
    } catch (const AIOutputValidationException& e) {
        result.outcome = CheckOutcome::Rejected;
        result.code = "AI_OUTPUT_INVALID";
        result.reason = e.what();
        result.details = e.getIssues();   // already value-free (Phase G's own guarantee, tested)
    }
    return result;
}
