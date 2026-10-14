#ifndef INPUT_VALIDATOR_CHECK_H
#define INPUT_VALIDATOR_CHECK_H

#include "../SecurityCheck.h"

/*
 * InputValidatorCheck -- adapts the existing Validator (ingredients,
 * cuisine, meal type, diet, cooking time, difficulty, servings) into the
 * SecurityCheck interface, so it runs as the first node of the
 * SecurityPipeline instead of being called ad hoc. Validator's own logic
 * is unchanged; this class only translates its ValidationException into
 * a SecurityCheckResult.
 *
 * Reports Skipped (not Passed) if `context.preferences` is null -- this
 * check has nothing to examine without a request to validate.
 */
class InputValidatorCheck : public SecurityCheck {
public:
    std::string getName() const override { return "InputValidator"; }
    SecurityCheckResult check(const SecurityContext& context) const override;
};

#endif // INPUT_VALIDATOR_CHECK_H
