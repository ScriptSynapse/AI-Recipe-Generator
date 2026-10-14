#ifndef SECURITY_CHECK_RESULT_H
#define SECURITY_CHECK_RESULT_H

#include <string>
#include <vector>

/*
 * CheckOutcome -- a deliberate THREE-way result, not just pass/fail.
 *
 *   Passed   the check ran against real data and found no problem.
 *   Rejected the check ran and found a specific problem; the pipeline
 *            stops here.
 *   Skipped  the check had nothing to examine at this stage (e.g. the
 *            AI-output check runs before any provider has responded
 *            yet) and did NOT run.
 *
 * The Skipped/Passed distinction matters for honesty in logging (Phase
 * M's SecurityAuditLog): a check that never ran must never be recorded
 * as having "passed", since that would misrepresent what was actually
 * verified.
 */
enum class CheckOutcome { Passed, Rejected, Skipped };

inline const char* toString(CheckOutcome outcome) {
    switch (outcome) {
        case CheckOutcome::Passed:   return "PASSED";
        case CheckOutcome::Rejected: return "REJECTED";
        case CheckOutcome::Skipped:  return "SKIPPED";
    }
    return "REJECTED";
}

/*
 * SecurityCheckResult -- what one SecurityCheck decided.
 *
 * `reason`/`details` follow the same rule as AIOutputValidationException:
 * built only from fixed, developer-written text and field names, never
 * from the user-/AI-supplied VALUES being checked, so a rejection reason
 * can safely be logged or shown without reflecting adversarial content
 * back out.
 */
struct SecurityCheckResult {
    std::string checkName;
    CheckOutcome outcome = CheckOutcome::Skipped;
    std::string code;                  // machine-readable, e.g. "EMPTY_INGREDIENTS"; empty if Passed/Skipped
    std::string riskLevel;             // "LOW" / "MEDIUM" / "HIGH" when Rejected; lets the audit log grade severity
    std::string reason;                 // human-readable summary; empty if Passed/Skipped
    std::vector<std::string> details;   // optional extra detail (e.g. every issue found, not just one)

    bool passed() const { return outcome == CheckOutcome::Passed; }
    bool rejected() const { return outcome == CheckOutcome::Rejected; }
    bool skipped() const { return outcome == CheckOutcome::Skipped; }
};

#endif // SECURITY_CHECK_RESULT_H
