#ifndef AI_OUTPUT_VALIDATOR_H
#define AI_OUTPUT_VALIDATOR_H

#include <stdexcept>
#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * AIOutputValidationException
 * -----------------------------------------------------------------------
 * Thrown by AIOutputValidator when a provider's response does not match
 * the schema it was asked for. Carries EVERY problem found (not just the
 * first), so a caller logging this (Phase M's SecurityAuditLog) can
 * record the full reason an AI response was rejected.
 *
 * Every message in `issues` is built only from field NAMES/INDICES and
 * fixed, developer-written text -- never from the field VALUES the
 * provider returned. Those values ultimately trace back to user input
 * (the ingredients the user typed, echoed into the prompt); if a
 * jailbroken or compromised model echoed adversarial content back,
 * quoting that content into a log/error message would still propagate
 * it. Rejecting the output and saying *which field* was invalid, without
 * repeating *what* the bad value contained, avoids that.
 */
class AIOutputValidationException : public std::runtime_error {
private:
    std::vector<std::string> issues;

public:
    AIOutputValidationException(const std::string& message, std::vector<std::string> issues_)
        : std::runtime_error(message), issues(std::move(issues_)) {}

    const std::vector<std::string>& getIssues() const { return issues; }
};

/*
 * AIOutputValidator -- Phase G.
 * -----------------------------------------------------------------------
 * "Never blindly trust an LLM response." Before Phase G, AIGenerator
 * parsed a provider's JSON with lenient `.value(key, default)` calls that
 * silently substituted a default for anything missing or wrong-typed --
 * which meant a response with, say, an empty ingredients array or a
 * nonsense difficulty string would silently become a "successful"
 * recipe instead of being rejected.
 *
 * AIOutputValidator replaces that: it parses the raw text and checks it
 * against EXACTLY the schema AIGenerator::buildPrompt() asked the model
 * for (see that method for the prompt itself) --
 *
 *   name          non-blank string
 *   ingredients   non-empty array of {name: non-blank string,
 *                 quantity: non-negative number, unit: string}
 *   instructions  non-empty array of non-blank strings
 *   cookingTime   number, 1-600 (an absolute sanity bound, independent of
 *                 what the user actually asked for -- RecipeEvaluator's
 *                 cooking-time-COMPLIANCE score is what checks closeness
 *                 to the user's requested budget; this just rejects
 *                 nonsense like -5 or 999999)
 *   difficulty    one of Validator::VALID_DIFFICULTIES (reused directly,
 *                 so the two never define "a valid difficulty" differently)
 *   calories, proteinGrams, carbsGrams, fatGrams
 *                 non-negative numbers within a generous sanity ceiling.
 *                 These are TOTALS for the whole recipe (matching the
 *                 convention already used by AIGenerator's offline
 *                 fallback generator), not per-serving, so the ceiling
 *                 is set high enough for a large multi-serving recipe.
 *   substitutions optional array of strings
 *
 * No other top-level field is accepted: the schema is a closed allow-list,
 * not a block-list. The model was asked for exactly these 10 keys, so an
 * eleventh is either a formatting mistake or an attempt to smuggle extra
 * content through -- either way, the safer default is to reject it rather
 * than silently pass it through to the rest of the application.
 *
 * validateAndParse() either returns the parsed, now-trusted json, or
 * throws AIOutputValidationException listing everything wrong. It never
 * throws for anything other than genuinely invalid input (it does not,
 * itself, make network calls or depend on any provider).
 */
class AIOutputValidator {
public:
    // Removes a ```json ... ``` (or plain ``` ... ```) fence around the
    // content, if the model added one despite being asked not to.
    // Returns the input unchanged if no fence is present.
    static std::string stripCodeFences(const std::string& text);

    // Parses `text` as JSON and validates it against the schema above.
    // Throws AIOutputValidationException on any problem (collects all of
    // them, does not stop at the first).
    static json validateAndParse(const std::string& text);

    // Individual checks, exposed for focused unit testing. Each appends
    // human-readable (but value-free -- see the exception's doc comment)
    // issue descriptions to `issues`; none of them throw.
    static void validateRequiredFields(const json& recipeJson, std::vector<std::string>& issues);
    static void validateIngredients(const json& recipeJson, std::vector<std::string>& issues);
    static void validateInstructions(const json& recipeJson, std::vector<std::string>& issues);
    static void validateCookingTime(const json& recipeJson, std::vector<std::string>& issues);
    static void validateDifficulty(const json& recipeJson, std::vector<std::string>& issues);
    static void validateNutrition(const json& recipeJson, std::vector<std::string>& issues);
    static void validateSubstitutions(const json& recipeJson, std::vector<std::string>& issues);
    static void validateNoUnexpectedFields(const json& recipeJson, std::vector<std::string>& issues);

private:
    static constexpr int MIN_COOKING_TIME = 1;
    static constexpr int MAX_COOKING_TIME = 600;
    static constexpr double MAX_CALORIES = 20000.0;
    static constexpr double MAX_MACRO_GRAMS = 2000.0;
    static constexpr size_t MAX_NAME_LENGTH = 200;
    static constexpr size_t MAX_INGREDIENT_NAME_LENGTH = 100;
    static constexpr size_t MAX_UNIT_LENGTH = 30;
    static constexpr size_t MAX_INSTRUCTION_LENGTH = 1000;
    static constexpr size_t MAX_INGREDIENT_COUNT = 50;
    static constexpr size_t MAX_INSTRUCTION_COUNT = 50;
    static constexpr double MAX_INGREDIENT_QUANTITY = 10000.0;
};

#endif // AI_OUTPUT_VALIDATOR_H
