#ifndef SECURITY_CHECK_H
#define SECURITY_CHECK_H

#include <string>
#include "SecurityCheckResult.h"
#include "SecurityContext.h"

/*
 * SecurityCheck -- the Handler interface in the Chain of Responsibility
 * (Phase H). Every concrete check (InputValidatorCheck now;
 * PromptInjectionDetector, XSSDetector, RateLimitChecker,
 * IngredientSafetyChecker in later phases) implements this and is
 * registered with a SecurityPipeline, which runs them in order.
 */
class SecurityCheck {
public:
    virtual ~SecurityCheck() = default;

    virtual std::string getName() const = 0;
    virtual SecurityCheckResult check(const SecurityContext& context) const = 0;
};

#endif // SECURITY_CHECK_H
