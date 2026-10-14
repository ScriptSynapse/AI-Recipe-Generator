#ifndef PROMPT_SECURITY_SCANNER_H
#define PROMPT_SECURITY_SCANNER_H

#include <memory>
#include <string>
#include <vector>
#include "../ai/LLMProvider.h"
#include "../json.hpp"

using json = nlohmann::json;

/*
 * InjectionRiskLevel / PromptSecurityResult -- the exact shape the spec
 * asks for ({"safe", "riskLevel", "reason"}), plus `score` and
 * `matchedCategories` for debugging/testing/future audit logging.
 *
 * `reason` is always a fixed, developer-written sentence describing the
 * CATEGORY of concern (e.g. "Potential instruction override detected.") --
 * never the user's actual submitted text. Two reasons: it matches the
 * spec's own example output exactly, and it avoids telling an attacker
 * precisely which phrase tripped the detector (the same "describe the
 * category, not the trigger" discipline as AIOutputValidationException).
 */
enum class InjectionRiskLevel { Low, Medium, High };

inline const char* toString(InjectionRiskLevel level) {
    switch (level) {
        case InjectionRiskLevel::Low:    return "LOW";
        case InjectionRiskLevel::Medium: return "MEDIUM";
        case InjectionRiskLevel::High:   return "HIGH";
    }
    return "HIGH";
}

struct PromptSecurityResult {
    bool safe = true;
    InjectionRiskLevel riskLevel = InjectionRiskLevel::Low;
    std::string reason;
    double score = 0.0;
    std::vector<std::string> matchedCategories;
    bool secondaryClassifierConsulted = false;

    json toJson() const {
        return json{
            {"safe", safe},
            {"riskLevel", toString(riskLevel)},
            {"reason", reason},
            {"score", score},
            {"matchedCategories", matchedCategories},
        };
    }
};

// Declared outside PromptSecurityScanner (rather than nested) because a
// nested struct's default member initializers and the enclosing class's
// default-argument expressions would otherwise form a circular
// dependency within the same class body.
struct PromptSecurityConfig {
    double mediumThreshold = 30.0;
    double highThreshold = 60.0;
};

/*
 * PromptSecurityScanner -- Phase I.
 * -----------------------------------------------------------------------
 * Scans user-submitted text (the ingredients the user typed, which
 * buildPrompt() embeds verbatim into the LLM prompt) for prompt-injection
 * patterns BEFORE that text ever reaches a provider. Genuinely layered,
 * per the spec, not one regex dressed up as five steps:
 *
 *   1. normalize()              strips invisible/zero-width characters,
 *                                reverses common leetspeak substitutions,
 *                                and drops punctuation used to break a
 *                                keyword up (e.g. "i.g.n.o.r.e" ->
 *                                "ignore") -- this is its own pass,
 *                                separate from structural analysis (#4)
 *                                below, which needs that same punctuation
 *                                preserved.
 *   2. detectKeywordCategories() matches the normalized text against
 *                                categorized phrase lists (instruction
 *                                override, system-prompt extraction,
 *                                role manipulation, safety bypass).
 *   3. scan()'s aggregation      turns layer 2 + layer 4's raw signals
 *                                into one 0-100 score with a compounding
 *                                bonus when multiple DISTINCT signal
 *                                categories fire together (a message that
 *                                both tries an override AND fakes a
 *                                system-role delimiter is far more clearly
 *                                malicious than either alone).
 *   4. detectStructuralSignals() looks at the text's SHAPE rather than
 *                                its words: faked conversation-role
 *                                delimiters ("[system]", "###", "<|...|>"),
 *                                an unusually high ratio of punctuation to
 *                                letters, or text far longer than a
 *                                plausible ingredient name.
 *   5. an OPTIONAL secondary LLMProvider classification, consulted ONLY
 *      for a MEDIUM (ambiguous) verdict -- never for LOW (not worth the
 *      extra call) and never for HIGH (a classifier's "looks fine" should
 *      not be allowed to weaken an already-strong signal; defense in
 *      depth). If the classifier itself fails or returns something
 *      unparseable, the ORIGINAL verdict is kept rather than treated as
 *      "safe" -- a broken classifier must never make the scanner more
 *      permissive. Off by default (nullptr): enabling it costs one extra
 *      LLM call for every ambiguous request, so a caller opts in
 *      explicitly by constructing the scanner with a real LLMProvider.
 *
 * safe == true only for a LOW verdict. Per the spec ("Never send clearly
 * blocked malicious prompts to the primary LLM"), a caller should refuse
 * to proceed to generation whenever safe == false.
 */
class PromptSecurityScanner {
public:
    using Config = PromptSecurityConfig;

    // secondaryClassifier may be nullptr (layer 5 disabled, the default).
    explicit PromptSecurityScanner(std::shared_ptr<LLMProvider> secondaryClassifier = nullptr,
                                   Config config = Config{});

    PromptSecurityResult scan(const std::string& rawText) const;

    // Layers 1/2/4 are stateless and exposed statically for focused,
    // instance-free unit testing.
    static std::string normalizeForKeywords(const std::string& text);
    static std::vector<std::string> detectKeywordCategories(const std::string& normalizedText);
    static double detectStructuralSignals(const std::string& rawText, std::vector<std::string>& flagsOut);

private:
    std::shared_ptr<LLMProvider> secondaryClassifier;
    Config config;

    static double weightForCategory(const std::string& category);
    static std::string reasonForCategory(const std::string& category);

    // Returns true (and sets verdictUnsafe) only if the classifier gave a
    // CLEAR verdict; returns false if it failed or was ambiguous, in
    // which case the caller must keep the original verdict.
    bool consultSecondaryClassifier(const std::string& rawText, bool& verdictUnsafe) const;
};

#endif // PROMPT_SECURITY_SCANNER_H
