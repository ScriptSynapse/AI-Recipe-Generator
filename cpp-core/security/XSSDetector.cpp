#include "XSSDetector.h"
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <regex>

namespace {

// Case-insensitive literal replacement. Browsers accept uppercase named
// entities too (&LT; &GT; &AMP; &QUOT;), so a case-sensitive decode would
// miss "&LT;script&GT;".
void replaceAllIgnoreCase(std::string& text, const std::string& entity, const std::string& replacement) {
    std::regex pattern(entity, std::regex::icase);
    // regex_replace's default format treats '$' specially; none of our
    // replacement strings contain it, so they are inserted literally.
    text = std::regex_replace(text, pattern, replacement);
}

// One pass of named + numeric HTML entity decoding. Only printable ASCII
// codepoints are substituted (tag names/keywords are always ASCII, and
// this avoids any UTF-8 encoding complexity for the rest).
std::string decodeEntitiesOnePass(const std::string& text) {
    std::string out = text;
    replaceAllIgnoreCase(out, "&lt;", "<");
    replaceAllIgnoreCase(out, "&gt;", ">");
    replaceAllIgnoreCase(out, "&quot;", "\"");
    replaceAllIgnoreCase(out, "&apos;", "'");
    replaceAllIgnoreCase(out, "&amp;", "&");

    static const std::regex numericEntity(R"(&#(x[0-9a-fA-F]+|[0-9]+);)");
    std::string result;
    result.reserve(out.size());
    auto begin = std::sregex_iterator(out.begin(), out.end(), numericEntity);
    auto end = std::sregex_iterator();
    size_t lastPos = 0;
    for (auto it = begin; it != end; ++it) {
        const std::smatch& m = *it;
        result.append(out, lastPos, m.position(0) - lastPos);
        std::string digits = m[1].str();
        long codepoint = (digits[0] == 'x' || digits[0] == 'X')
            ? std::strtol(digits.c_str() + 1, nullptr, 16)
            : std::strtol(digits.c_str(), nullptr, 10);
        if (codepoint >= 0x20 && codepoint <= 0x7E) {
            result.push_back(static_cast<char>(codepoint));
        } else {
            result.append(m.str(0));   // leave non-ASCII entities untouched
        }
        lastPos = m.position(0) + m.length(0);
    }
    result.append(out, lastPos, out.size() - lastPos);
    return result;
}

} // namespace

std::string XSSDetector::normalize(const std::string& text) {
    std::string decoded = text;
    // Bounded fixpoint loop so a double-encoded payload (e.g.
    // "&amp;lt;script&amp;gt;" -> "&lt;script&gt;" -> "<script>") is still
    // caught, without risking an unbounded loop.
    for (int i = 0; i < 3; ++i) {
        std::string next = decodeEntitiesOnePass(decoded);
        if (next == decoded) break;
        decoded = next;
    }
    std::transform(decoded.begin(), decoded.end(), decoded.begin(),
                   [](unsigned char c) { return std::tolower(c); });
    return decoded;
}

bool XSSDetector::containsScriptTag(const std::string& normalizedText) {
    // Whitespace tolerated between every letter of "script" too, e.g.
    // "<scr\tipt>".
    static const std::regex pattern(R"(<\s*/?\s*s\s*c\s*r\s*i\s*p\s*t\b)");
    return std::regex_search(normalizedText, pattern);
}

bool XSSDetector::containsEventHandler(const std::string& normalizedText) {
    static const std::regex pattern(R"(\bon[a-z]+\s*=)");
    return std::regex_search(normalizedText, pattern);
}

bool XSSDetector::containsJavascriptUri(const std::string& normalizedText) {
    // Whitespace (including tabs/newlines) tolerated BETWEEN EVERY LETTER,
    // not just before the colon -- "java\tscript:" is a well-known evasion
    // of a naive "javascript:" substring/regex check.
    static const std::regex pattern(
        R"(j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:|)"
        R"(data\s*:\s*text\s*/\s*html)");
    return std::regex_search(normalizedText, pattern);
}

bool XSSDetector::containsDangerousTag(const std::string& normalizedText) {
    static const std::regex pattern(R"(<\s*/?\s*(iframe|object|embed|link|meta|base|form|style|svg)\b)");
    return std::regex_search(normalizedText, pattern);
}

bool XSSDetector::containsCssExpressionOrVbscript(const std::string& normalizedText) {
    static const std::regex pattern(R"(expression\s*\()");
    return std::regex_search(normalizedText, pattern);
}

XSSDetectionResult XSSDetector::scan(const std::string& rawText) {
    XSSDetectionResult result;
    std::string normalized = normalize(rawText);

    struct Check {
        bool (*fn)(const std::string&);
        const char* category;
        const char* reason;
    };
    static const Check checks[] = {
        {containsScriptTag, "SCRIPT_TAG", "Potential script tag injection detected."},
        {containsEventHandler, "EVENT_HANDLER", "Potential HTML event-handler injection detected."},
        {containsJavascriptUri, "JAVASCRIPT_URI", "Potential javascript:/vbscript: URI injection detected."},
        {containsDangerousTag, "DANGEROUS_TAG", "Potential malicious HTML markup detected."},
        {containsCssExpressionOrVbscript, "CSS_EXPRESSION", "Potential CSS expression injection detected."},
    };

    for (const auto& check : checks) {
        if (check.fn(normalized)) {
            result.matchedPatterns.push_back(check.category);
            if (result.reason.empty()) result.reason = check.reason;   // first match sets the headline reason
        }
    }

    result.safe = result.matchedPatterns.empty();
    return result;
}
