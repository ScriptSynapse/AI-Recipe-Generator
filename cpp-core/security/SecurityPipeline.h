#ifndef SECURITY_PIPELINE_H
#define SECURITY_PIPELINE_H

#include <memory>
#include <string>
#include <vector>
#include "SecurityCheck.h"
#include "SecurityCheckResult.h"
#include "SecurityContext.h"

/*
 * SecurityPipeline -- Chain of Responsibility (Phase H).
 * -----------------------------------------------------------------------
 *      SecurityPipeline
 *          |
 *          +-- InputValidatorCheck        (Phase H -- wraps the existing
 *          |                                Validator)
 *          +-- PromptInjectionDetector    (Phase I -- not yet built)
 *          +-- XSSDetector                (Phase J -- not yet built)
 *          +-- RateLimitChecker           (Phase N -- not yet built)
 *          +-- AIOutputValidatorCheck     (Phase H -- wraps the existing,
 *          |                                already-built Phase G
 *          |                                AIOutputValidator)
 *          +-- IngredientSafetyChecker    (not yet built)
 *
 * run() executes every registered check, IN ORDER, against one
 * SecurityContext, and stops at the first Rejected outcome -- a later
 * check never runs once an earlier one has already found a reason to
 * reject the request, since there is nothing further worth checking.
 * (A Skipped outcome does NOT stop the chain; only Rejected does.)
 *
 * Deliberately NOT included here: no-op placeholder checks for
 * PromptInjectionDetector, XSSDetector, RateLimitChecker, or
 * IngredientSafetyChecker. A stub that unconditionally returns "Passed"
 * before its real logic exists would be worse than not having it at all
 * in a project about cybersecurity: it would look, to the pipeline's
 * caller, exactly like a real, working check. Each of those checks is
 * wired in -- for real, with real detection logic and real tests -- in
 * its own dedicated phase (see the comment above).
 *
 * run() returns every result gathered, not just the final verdict, so a
 * caller (or, later, SecurityAuditLog) can see exactly which checks ran
 * and what each one decided.
 */
class SecurityPipeline {
public:
    void addCheck(std::shared_ptr<SecurityCheck> check);

    std::vector<SecurityCheckResult> run(const SecurityContext& context) const;

    // Convenience: true only if every result is Passed or Skipped (no
    // Rejected present). Equivalent to checking the last result's outcome
    // given run()'s stop-on-reject semantics, but doesn't assume the
    // caller passed exactly what run() returned.
    static bool allPassed(const std::vector<SecurityCheckResult>& results);

    // The first Rejected result, or nullptr if none. Pointers are valid
    // only as long as `results` outlives them.
    static const SecurityCheckResult* firstRejection(const std::vector<SecurityCheckResult>& results);

    std::vector<std::string> getCheckNames() const;
    size_t checkCount() const { return checks.size(); }

private:
    std::vector<std::shared_ptr<SecurityCheck>> checks;
};

#endif // SECURITY_PIPELINE_H
