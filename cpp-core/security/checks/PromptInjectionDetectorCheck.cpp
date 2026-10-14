#include "PromptInjectionDetectorCheck.h"

PromptInjectionDetectorCheck::PromptInjectionDetectorCheck(std::shared_ptr<PromptSecurityScanner> scanner_)
    : scanner(scanner_ ? std::move(scanner_) : std::make_shared<PromptSecurityScanner>()) {}

std::string PromptInjectionDetectorCheck::joinIngredients(const std::vector<std::string>& ingredients) {
    std::string joined;
    for (size_t i = 0; i < ingredients.size(); ++i) {
        joined += ingredients[i];
        if (i + 1 < ingredients.size()) joined += ", ";
    }
    return joined;
}

SecurityCheckResult PromptInjectionDetectorCheck::check(const SecurityContext& context) const {
    SecurityCheckResult result;

    if (!context.preferences) {
        result.outcome = CheckOutcome::Skipped;
        return result;
    }

    std::string text = joinIngredients(context.preferences->getIngredients());
    PromptSecurityResult scan = scanner->scan(text);

    if (scan.safe) {
        result.outcome = CheckOutcome::Passed;
    } else {
        result.outcome = CheckOutcome::Rejected;
        result.code = "PROMPT_INJECTION_SUSPECTED";
        result.riskLevel = toString(scan.riskLevel);   // the scanner's own verdict (MEDIUM or HIGH here)
        result.reason = scan.reason;
        result.details = scan.matchedCategories;
    }
    return result;
}
