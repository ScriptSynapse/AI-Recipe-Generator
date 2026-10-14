#include "InputValidatorCheck.h"
#include "../../validation/Validator.h"

SecurityCheckResult InputValidatorCheck::check(const SecurityContext& context) const {
    SecurityCheckResult result;

    if (!context.preferences) {
        result.outcome = CheckOutcome::Skipped;
        return result;
    }

    try {
        Validator::validate(*context.preferences);
        result.outcome = CheckOutcome::Passed;
    } catch (const ValidationException& e) {
        result.outcome = CheckOutcome::Rejected;
        result.code = e.getCode();
        result.riskLevel = "LOW";   // malformed input: worth recording, not alarming
        result.reason = e.what();   // Validator's messages are fixed, generic text -- never raw user input
    }
    return result;
}
