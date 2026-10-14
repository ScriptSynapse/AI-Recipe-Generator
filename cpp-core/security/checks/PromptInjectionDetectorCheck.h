#ifndef PROMPT_INJECTION_DETECTOR_CHECK_H
#define PROMPT_INJECTION_DETECTOR_CHECK_H

#include <memory>
#include "../PromptSecurityScanner.h"
#include "../SecurityCheck.h"

/*
 * PromptInjectionDetectorCheck -- the SecurityPipeline node (per the
 * spec's Chain-of-Responsibility diagram) wrapping PromptSecurityScanner.
 *
 * Scans the user's ingredient list -- joined exactly the way
 * AIGenerator::buildPrompt() joins it ("paneer, tomato, ...") -- since
 * that joined text is exactly what reaches the LLM prompt. Any other
 * free-text field a future phase adds to RecipePreferences should be
 * scanned the same way.
 *
 * Skipped if `context.preferences` is null (nothing to scan yet).
 */
class PromptInjectionDetectorCheck : public SecurityCheck {
public:
    explicit PromptInjectionDetectorCheck(std::shared_ptr<PromptSecurityScanner> scanner = nullptr);

    std::string getName() const override { return "PromptInjectionDetector"; }
    SecurityCheckResult check(const SecurityContext& context) const override;

    // Builds the exact joined text AIGenerator::buildPrompt() embeds for
    // the ingredients list, so what is scanned matches what is sent.
    static std::string joinIngredients(const std::vector<std::string>& ingredients);

private:
    std::shared_ptr<PromptSecurityScanner> scanner;
};

#endif // PROMPT_INJECTION_DETECTOR_CHECK_H
