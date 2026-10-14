#ifndef XSS_DETECTOR_H
#define XSS_DETECTOR_H

#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * XSSDetectionResult -- what XSSDetector::scan() decided.
 *
 * `reason` and `matchedPatterns` follow the same discipline as
 * AIOutputValidationException and PromptSecurityResult: fixed,
 * developer-written category descriptions, never the attacker's actual
 * submitted markup, so a rejection can safely be logged or shown.
 */
struct XSSDetectionResult {
    bool safe = true;
    std::string reason;
    std::vector<std::string> matchedPatterns;

    json toJson() const {
        return json{{"safe", safe}, {"reason", reason}, {"matchedPatterns", matchedPatterns}};
    }
};

/*
 * XSSDetector -- Phase J.
 * -----------------------------------------------------------------------
 * Server-side defense in depth alongside the frontend's own escaping
 * (frontend/js/sanitize.js, used everywhere user/AI content is written
 * into the DOM). Unlike PromptSecurityScanner, XSS markup is much less
 * ambiguous once detected -- there's no legitimate reading of
 * "<script>" in an ingredient name -- so this is a straightforward
 * detect-and-reject, not a weighted risk score.
 *
 * Still genuinely layered, not one regex pretending to be several:
 *   1. normalize()        decodes common HTML entities (both named --
 *                          &lt; &gt; &amp; &quot; &apos; -- and numeric,
 *                          decimal and hex) so an attacker can't evade
 *                          detection by double-encoding a tag, then
 *                          lowercases the result.
 *   2. containsScriptTag / containsEventHandler / containsJavascriptUri /
 *      containsDangerousTag / containsCssExpressionOrVbscript
 *                          each a focused, independently-testable check
 *                          for one real XSS technique.
 *
 * scan() collects EVERY pattern that matched (not just the first), same
 * philosophy as AIOutputValidator, so a rejection can be fully explained.
 */
class XSSDetector {
public:
    static XSSDetectionResult scan(const std::string& rawText);

    // Decodes named and numeric HTML entities, then lowercases. Exposed
    // for isolated testing.
    static std::string normalize(const std::string& text);

    static bool containsScriptTag(const std::string& normalizedText);
    static bool containsEventHandler(const std::string& normalizedText);
    static bool containsJavascriptUri(const std::string& normalizedText);
    static bool containsDangerousTag(const std::string& normalizedText);
    static bool containsCssExpressionOrVbscript(const std::string& normalizedText);
};

#endif // XSS_DETECTOR_H
