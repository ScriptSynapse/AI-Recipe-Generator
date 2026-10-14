#include "AIOutputValidator.h"
#include "Validator.h"
#include <algorithm>
#include <set>

namespace {

bool isBlank(const std::string& s) {
    return s.find_first_not_of(" \t\r\n") == std::string::npos;
}

bool isNumber(const json& v) { return v.is_number(); }

} // namespace

std::string AIOutputValidator::stripCodeFences(const std::string& text) {
    size_t fenceStart = text.find("```");
    if (fenceStart == std::string::npos) return text;

    size_t contentStart = text.find('\n', fenceStart);
    size_t fenceEnd = text.rfind("```");
    if (contentStart == std::string::npos || fenceEnd == std::string::npos || fenceEnd <= contentStart) {
        return text;
    }
    return text.substr(contentStart + 1, fenceEnd - contentStart - 1);
}

void AIOutputValidator::validateRequiredFields(const json& j, std::vector<std::string>& issues) {
    struct Field { const char* key; bool (*check)(const json&); const char* typeName; };
    static const Field required[] = {
        {"name", [](const json& v) { return v.is_string(); }, "a string"},
        {"ingredients", [](const json& v) { return v.is_array(); }, "an array"},
        {"instructions", [](const json& v) { return v.is_array(); }, "an array"},
        {"cookingTime", isNumber, "a number"},
        {"difficulty", [](const json& v) { return v.is_string(); }, "a string"},
        {"calories", isNumber, "a number"},
        {"proteinGrams", isNumber, "a number"},
        {"carbsGrams", isNumber, "a number"},
        {"fatGrams", isNumber, "a number"},
    };
    for (const auto& field : required) {
        if (!j.contains(field.key)) {
            issues.push_back(std::string("Missing required field '") + field.key + "'.");
        } else if (!field.check(j[field.key])) {
            issues.push_back(std::string("Field '") + field.key + "' must be " + field.typeName + ".");
        }
    }

    if (j.contains("name") && j["name"].is_string()) {
        const std::string& name = j["name"].get_ref<const std::string&>();
        if (isBlank(name)) issues.push_back("Field 'name' must not be blank.");
        else if (name.size() > MAX_NAME_LENGTH) issues.push_back("Field 'name' is too long.");
    }
}

void AIOutputValidator::validateIngredients(const json& j, std::vector<std::string>& issues) {
    if (!j.contains("ingredients") || !j["ingredients"].is_array()) return;   // already reported above
    const json& ingredients = j["ingredients"];

    if (ingredients.empty()) {
        issues.push_back("Field 'ingredients' must not be empty.");
        return;
    }
    if (ingredients.size() > MAX_INGREDIENT_COUNT) {
        issues.push_back("Field 'ingredients' has too many entries.");
    }

    for (size_t i = 0; i < ingredients.size(); ++i) {
        const json& item = ingredients[i];
        std::string where = "ingredients[" + std::to_string(i) + "]";
        if (!item.is_object()) {
            issues.push_back(where + " must be an object.");
            continue;
        }
        if (!item.contains("name") || !item["name"].is_string() || isBlank(item["name"].get<std::string>())) {
            issues.push_back(where + ".name must be a non-blank string.");
        } else if (item["name"].get_ref<const std::string&>().size() > MAX_INGREDIENT_NAME_LENGTH) {
            issues.push_back(where + ".name is too long.");
        }
        if (!item.contains("quantity") || !isNumber(item["quantity"])) {
            issues.push_back(where + ".quantity must be a number.");
        } else {
            double qty = item["quantity"].get<double>();
            if (qty < 0.0) issues.push_back(where + ".quantity must not be negative.");
            else if (qty > MAX_INGREDIENT_QUANTITY) issues.push_back(where + ".quantity is unrealistically large.");
        }
        if (!item.contains("unit") || !item["unit"].is_string()) {
            issues.push_back(where + ".unit must be a string.");
        } else if (item["unit"].get_ref<const std::string&>().size() > MAX_UNIT_LENGTH) {
            issues.push_back(where + ".unit is too long.");
        }
    }
}

void AIOutputValidator::validateInstructions(const json& j, std::vector<std::string>& issues) {
    if (!j.contains("instructions") || !j["instructions"].is_array()) return;   // already reported above
    const json& instructions = j["instructions"];

    if (instructions.empty()) {
        issues.push_back("Field 'instructions' must not be empty.");
        return;
    }
    if (instructions.size() > MAX_INSTRUCTION_COUNT) {
        issues.push_back("Field 'instructions' has too many entries.");
    }

    for (size_t i = 0; i < instructions.size(); ++i) {
        const json& step = instructions[i];
        std::string where = "instructions[" + std::to_string(i) + "]";
        if (!step.is_string()) {
            issues.push_back(where + " must be a string.");
            continue;
        }
        const std::string& text = step.get_ref<const std::string&>();
        if (isBlank(text)) issues.push_back(where + " must not be blank.");
        else if (text.size() > MAX_INSTRUCTION_LENGTH) issues.push_back(where + " is too long.");
    }
}

void AIOutputValidator::validateCookingTime(const json& j, std::vector<std::string>& issues) {
    if (!j.contains("cookingTime") || !isNumber(j["cookingTime"])) return;   // already reported above
    double minutes = j["cookingTime"].get<double>();
    if (minutes < MIN_COOKING_TIME || minutes > MAX_COOKING_TIME) {
        issues.push_back("Field 'cookingTime' is out of the allowed range.");
    }
}

void AIOutputValidator::validateDifficulty(const json& j, std::vector<std::string>& issues) {
    if (!j.contains("difficulty") || !j["difficulty"].is_string()) return;   // already reported above
    if (!Validator::isValidDifficulty(j["difficulty"].get<std::string>())) {
        issues.push_back("Field 'difficulty' is not one of the allowed values.");
    }
}

void AIOutputValidator::validateNutrition(const json& j, std::vector<std::string>& issues) {
    struct Field { const char* key; double maxValue; };
    static const Field fields[] = {
        {"calories", MAX_CALORIES},
        {"proteinGrams", MAX_MACRO_GRAMS},
        {"carbsGrams", MAX_MACRO_GRAMS},
        {"fatGrams", MAX_MACRO_GRAMS},
    };
    for (const auto& field : fields) {
        if (!j.contains(field.key) || !isNumber(j[field.key])) continue;   // already reported above
        double value = j[field.key].get<double>();
        if (value < 0.0) issues.push_back(std::string("Field '") + field.key + "' must not be negative.");
        else if (value > field.maxValue) issues.push_back(std::string("Field '") + field.key + "' is unrealistically large.");
    }
}

void AIOutputValidator::validateSubstitutions(const json& j, std::vector<std::string>& issues) {
    if (!j.contains("substitutions")) return;   // optional field
    if (!j["substitutions"].is_array()) {
        issues.push_back("Field 'substitutions' must be an array.");
        return;
    }
    const json& subs = j["substitutions"];
    if (subs.size() > MAX_INGREDIENT_COUNT) issues.push_back("Field 'substitutions' has too many entries.");
    for (size_t i = 0; i < subs.size(); ++i) {
        if (!subs[i].is_string()) issues.push_back("substitutions[" + std::to_string(i) + "] must be a string.");
    }
}

void AIOutputValidator::validateNoUnexpectedFields(const json& j, std::vector<std::string>& issues) {
    static const std::set<std::string> allowed = {
        "name", "ingredients", "instructions", "cookingTime", "difficulty",
        "calories", "proteinGrams", "carbsGrams", "fatGrams", "substitutions",
    };
    for (auto it = j.begin(); it != j.end(); ++it) {
        if (allowed.find(it.key()) == allowed.end()) {
            // The key name itself is developer-controlled/expected vocabulary
            // from our own schema, not provider-supplied free text, so it is
            // safe to include -- unlike any field VALUE, which never appears
            // in an issue message (see AIOutputValidationException's comment).
            issues.push_back("Unexpected field '" + it.key() + "' is not part of the recipe schema.");
        }
    }
}

json AIOutputValidator::validateAndParse(const std::string& rawText) {
    std::string text = stripCodeFences(rawText);

    json parsed;
    try {
        parsed = json::parse(text);
    } catch (const json::parse_error&) {
        throw AIOutputValidationException("AI response was not valid JSON.", {"Response is not valid JSON."});
    }

    if (!parsed.is_object()) {
        throw AIOutputValidationException(
            "AI response must be a JSON object.", {"Response must be a JSON object, not an array or primitive."});
    }

    std::vector<std::string> issues;
    validateRequiredFields(parsed, issues);
    validateIngredients(parsed, issues);
    validateInstructions(parsed, issues);
    validateCookingTime(parsed, issues);
    validateDifficulty(parsed, issues);
    validateNutrition(parsed, issues);
    validateSubstitutions(parsed, issues);
    validateNoUnexpectedFields(parsed, issues);

    if (!issues.empty()) {
        throw AIOutputValidationException(
            std::to_string(issues.size()) + " AI output validation issue(s) found.", issues);
    }

    return parsed;
}
