// Phase J tests: XSSDetector's normalization (entity decoding, including
// double-encoded evasion), each individual pattern check, realistic
// attack payloads, benign false-positive guards, and the pipeline
// adapter end to end.
#include <cassert>
#include <iostream>
#include "../cpp-core/security/XSSDetector.h"
#include "../cpp-core/security/checks/XSSDetectorCheck.h"

namespace {
bool containsPattern(const std::vector<std::string>& patterns, const std::string& needle) {
    for (const auto& p : patterns) if (p == needle) return true;
    return false;
}
} // namespace

int main() {
    // ---- Realistic attack payloads, all detected -----------------------------
    {
        auto r = XSSDetector::scan("<script>alert(document.cookie)</script>");
        assert(!r.safe);
        assert(containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        auto r = XSSDetector::scan("</script><script>alert(1)</script>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        auto r = XSSDetector::scan("javascript:alert(document.cookie)");
        assert(!r.safe && containsPattern(r.matchedPatterns, "JAVASCRIPT_URI"));
    }
    {
        auto r = XSSDetector::scan("<img src=x onerror=alert(1)>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "EVENT_HANDLER"));
    }
    {
        auto r = XSSDetector::scan("<svg onload=alert(1)>");
        assert(!r.safe);   // caught by EVENT_HANDLER and/or DANGEROUS_TAG
    }
    {
        auto r = XSSDetector::scan("<iframe src=\"evil.com\"></iframe>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "DANGEROUS_TAG"));
    }
    {
        auto r = XSSDetector::scan("<object data=\"evil.swf\"></object>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "DANGEROUS_TAG"));
    }
    {
        auto r = XSSDetector::scan("background:url('javascript:alert(1)')");
        assert(!r.safe && containsPattern(r.matchedPatterns, "JAVASCRIPT_URI"));
    }
    {
        auto r = XSSDetector::scan("width:expression(alert('xss'))");
        assert(!r.safe && containsPattern(r.matchedPatterns, "CSS_EXPRESSION"));
    }
    {
        auto r = XSSDetector::scan("<a href=\"vbscript:msgbox(1)\">click</a>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "JAVASCRIPT_URI"));
    }
    std::cout << "XSS-01 passed: every realistic attack payload is detected with the right category.\n";

    // ---- Evasion techniques ---------------------------------------------------
    {
        // Whitespace/tab split inside "javascript:" -- a real, documented evasion.
        auto r = XSSDetector::scan("java\tscript:alert(1)");
        assert(!r.safe && containsPattern(r.matchedPatterns, "JAVASCRIPT_URI"));
    }
    {
        auto r = XSSDetector::scan("<scr\tipt>alert(1)</scr\tipt>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        // Single HTML-entity encoding.
        auto r = XSSDetector::scan("&lt;script&gt;alert(1)&lt;/script&gt;");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        // Double HTML-entity encoding (&amp;lt; -> &lt; -> <).
        auto r = XSSDetector::scan("&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        // Numeric hex entity encoding of '<' and '>'.
        auto r = XSSDetector::scan("&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        // Numeric decimal entity encoding.
        auto r = XSSDetector::scan("&#60;script&#62;alert(1)&#60;/script&#62;");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    {
        // Case variation.
        auto r = XSSDetector::scan("<ScRiPt>alert(1)</ScRiPt>");
        assert(!r.safe && containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
    }
    std::cout << "XSS-02 passed: entity-encoding (single + double + numeric), whitespace, and case evasions defeated.\n";

    // ---- Benign input is never flagged (false-positive guard) ---------------
    {
        auto r = XSSDetector::scan("paneer, tomato, onion, garlic");
        assert(r.safe && r.reason.empty() && r.matchedPatterns.empty());
    }
    {
        auto r = XSSDetector::scan("2 cups rice, cook at 350 degrees");
        assert(r.safe);
    }
    {
        // A literal '<' in ordinary (non-tag) text must not trip the detector.
        auto r = XSSDetector::scan("simmer for < 10 minutes on low heat");
        assert(r.safe);
    }
    {
        auto r = XSSDetector::scan("5 & dime spice mix");
        assert(r.safe);
    }
    std::cout << "XSS-03 passed: ordinary ingredient text, including stray '<' and '&', is never flagged.\n";

    // ---- Multiple distinct patterns are ALL collected, not just the first ---
    {
        auto r = XSSDetector::scan("<script>alert(1)</script><img src=x onerror=alert(2)>");
        assert(!r.safe);
        assert(containsPattern(r.matchedPatterns, "SCRIPT_TAG"));
        assert(containsPattern(r.matchedPatterns, "EVENT_HANDLER"));
        assert(r.matchedPatterns.size() >= 2);
    }
    std::cout << "XSS-04 passed: every matched pattern is collected, not just the first.\n";

    // ---- normalize() is directly testable and composes as documented --------
    {
        std::string normalized = XSSDetector::normalize("&LT;SCRIPT&GT;");
        assert(normalized.find("<script>") != std::string::npos);
    }
    std::cout << "XSS-05 passed: normalize() decodes entities and lowercases correctly.\n";

    // ---- XSSDetectorCheck (pipeline adapter) ----------------------------------
    {
        XSSDetectorCheck check;
        auto result = check.check(SecurityContext{});
        assert(result.outcome == CheckOutcome::Skipped);
        assert(check.getName() == "XSSDetector");
    }
    {
        auto prefs = RecipePreferences::fromJson(json{
            {"ingredients", {"paneer", "tomato"}}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
            {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2}});
        SecurityContext ctx; ctx.preferences = &prefs;
        XSSDetectorCheck check;
        assert(check.check(ctx).outcome == CheckOutcome::Passed);
    }
    {
        auto prefs = RecipePreferences::fromJson(json{
            {"ingredients", {"paneer", "<script>alert(1)</script>"}}, {"cuisine", "Indian"},
            {"mealType", "Dinner"}, {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30},
            {"difficulty", "Medium"}, {"servings", 2}});
        SecurityContext ctx; ctx.preferences = &prefs;
        XSSDetectorCheck check;
        auto result = check.check(ctx);
        assert(result.outcome == CheckOutcome::Rejected);
        assert(result.code == "XSS_SUSPECTED");
        assert(!result.reason.empty());
        assert(!result.details.empty());
    }
    std::cout << "XSS-06 passed: XSSDetectorCheck adapts the detector correctly into the pipeline.\n";

    std::cout << "All XSSDetector tests passed.\n";
    return 0;
}
