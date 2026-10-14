#ifndef AI_OUTPUT_VALIDATOR_CHECK_H
#define AI_OUTPUT_VALIDATOR_CHECK_H

#include "../SecurityCheck.h"

/*
 * AIOutputValidatorCheck -- adapts the existing (Phase G) AIOutputValidator
 * into the SecurityCheck interface, as the pipeline's post-generation
 * node. Demonstrates that the same Chain-of-Responsibility machinery
 * covers both a pre-generation check (InputValidatorCheck, above) and a
 * post-generation one, using a component that already has full test
 * coverage from Phase G -- nothing new is approximated here.
 *
 * Reports Skipped if `context.rawProviderResponse` is null -- this check
 * has nothing to examine before a provider has actually responded.
 */
class AIOutputValidatorCheck : public SecurityCheck {
public:
    std::string getName() const override { return "AIOutputValidator"; }
    SecurityCheckResult check(const SecurityContext& context) const override;
};

#endif // AI_OUTPUT_VALIDATOR_CHECK_H
