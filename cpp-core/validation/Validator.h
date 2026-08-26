#ifndef VALIDATOR_H
#define VALIDATOR_H

#include <stdexcept>
#include <string>
#include "../models/RecipePreferences.h"

/*
 * ValidationException
 * -----------------------------------------------------------------------
 * Custom exception type deriving from std::runtime_error. Carries a
 * machine-readable error `code` (mirrored into the API's JSON error
 * envelope) in addition to the human-readable message from what().
 */
class ValidationException : public std::runtime_error {
private:
    std::string code;

public:
    ValidationException(const std::string& code_, const std::string& message)
        : std::runtime_error(message), code(code_) {}

    std::string getCode() const { return code; }
};

/*
 * Validator
 * -----------------------------------------------------------------------
 * Centralizes all input-validation rules so RecipeMatcher/generators can
 * assume they always receive sane RecipePreferences. Every check throws
 * a ValidationException with a specific code on failure; main.cpp
 * catches these and converts them into the API's error JSON shape.
 */
class Validator {
public:
    static const std::vector<std::string> VALID_CUISINES;
    static const std::vector<std::string> VALID_MEAL_TYPES;
    static const std::vector<std::string> VALID_DIFFICULTIES;
    static const std::vector<std::string> VALID_DIETS;

    // Throws ValidationException on the first rule violated.
    static void validate(const RecipePreferences& prefs);

    static bool isValidCuisine(const std::string& cuisine);
    static bool isValidMealType(const std::string& mealType);
    static bool isValidDifficulty(const std::string& difficulty);
    static bool isValidDiet(const std::string& diet);
};

#endif // VALIDATOR_H
