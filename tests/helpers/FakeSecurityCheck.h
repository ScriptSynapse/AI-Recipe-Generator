#ifndef FAKE_SECURITY_CHECK_H
#define FAKE_SECURITY_CHECK_H
// Test double for SecurityCheck: a scripted outcome, plus a call counter
// so Chain-of-Responsibility short-circuit behavior (a check after a
// rejection must never run) can be verified directly, not just inferred
// from the returned results.
#include "../../cpp-core/security/SecurityCheck.h"

class FakeSecurityCheck : public SecurityCheck {
public:
    std::string name;
    CheckOutcome scriptedOutcome;
    std::string code;
    std::string reason;
    mutable int calls = 0;

    explicit FakeSecurityCheck(std::string name_, CheckOutcome outcome = CheckOutcome::Passed,
                               std::string code_ = "", std::string reason_ = "")
        : name(std::move(name_)), scriptedOutcome(outcome), code(std::move(code_)), reason(std::move(reason_)) {}

    std::string getName() const override { return name; }

    SecurityCheckResult check(const SecurityContext&) const override {
        ++calls;
        SecurityCheckResult result;
        result.outcome = scriptedOutcome;
        result.code = code;
        result.reason = reason;
        return result;
    }
};

#endif
