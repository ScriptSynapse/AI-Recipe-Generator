#include "IngredientConsistencyChecker.h"
#include <algorithm>
#include <cctype>
#include "RecipeEvaluator.h"

namespace {

std::string lower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

bool contains(const std::string& haystack, const std::string& needle) {
    return !needle.empty() && haystack.find(needle) != std::string::npos;
}

const std::vector<std::string>& staples() {
    static const std::vector<std::string> list = {"salt", "water", "black pepper", "pepper"};
    return list;
}

// Not food. Deliberately explicit and short; an AI that "suggests" any of
// these has produced something unsafe whatever the rest of the recipe says.
const std::vector<std::string>& nonFoodSubstances() {
    static const std::vector<std::string> list = {
        "bleach", "detergent", "antifreeze", "gasoline", "kerosene", "pesticide", "insecticide",
        "ammonia", "arsenic", "cyanide", "mercury", "rat poison", "poison", "paint", "turpentine",
        "lye", "drain cleaner", "soap"};
    return list;
}

} // namespace

ConsistencyReport IngredientConsistencyChecker::check(const Recipe& recipe, const RecipePreferences& preferences) {
    return check(recipe.getIngredients(), preferences.getIngredients(), preferences.getDietaryPreference());
}

ConsistencyReport IngredientConsistencyChecker::check(const std::vector<Ingredient>& recipeIngredients,
                                                      const std::vector<std::string>& requestedIngredients,
                                                      const std::string& dietaryPreference) {
    ConsistencyReport report;

    std::vector<std::string> recipeLower;
    for (const auto& ing : recipeIngredients) recipeLower.push_back(lower(ing.name));
    std::vector<std::string> requestedLower;
    for (const auto& r : requestedIngredients) requestedLower.push_back(lower(r));

    // Required: every ingredient the user listed should be used somewhere.
    for (size_t i = 0; i < requestedIngredients.size(); ++i) {
        const std::string& want = requestedLower[i];
        if (want.empty()) continue;
        bool used = std::any_of(recipeLower.begin(), recipeLower.end(), [&](const std::string& have) {
            return contains(have, want) || contains(want, have);
        });
        if (!used) report.missingRequired.push_back(requestedIngredients[i]);
    }

    for (size_t i = 0; i < recipeIngredients.size(); ++i) {
        const std::string& have = recipeLower[i];

        for (const auto& bad : nonFoodSubstances()) {
            if (contains(have, bad)) { report.suspicious.push_back(recipeIngredients[i].name); break; }
        }

        bool isStaple = std::any_of(staples().begin(), staples().end(), [&](const std::string& s) { return contains(have, s); });
        bool requested = std::any_of(requestedLower.begin(), requestedLower.end(), [&](const std::string& want) {
            return contains(have, want) || contains(want, have);
        });
        if (!isStaple && !requested) report.additional.push_back(recipeIngredients[i].name);
    }

    report.dietConflicts = RecipeEvaluator::findDietConflicts(recipeIngredients, dietaryPreference);
    return report;
}

std::vector<ConsistencyCheck> ConsistencyReport::checks() const {
    auto plural = [](size_t n, const std::string& word) { return std::to_string(n) + " " + word + (n == 1 ? "" : "s"); };
    std::vector<ConsistencyCheck> out;
    out.push_back({"Required ingredients respected", requiredRespected() ? "pass" : "warn",
                   requiredRespected() ? "" : plural(missingRequired.size(), "requested ingredient") + " not used"});
    out.push_back({"Dietary preference respected", dietRespected() ? "pass" : "warn",
                   dietRespected() ? "" : plural(dietConflicts.size(), "conflicting ingredient") + " found"});
    out.push_back({additional.empty() ? "No additional ingredients" : plural(additional.size(), "additional ingredient") + " detected",
                   additional.empty() ? "pass" : "warn", ""});
    out.push_back({noUnsafeIngredients() ? "No unsafe ingredient detected" : "Unsafe ingredient detected",
                   noUnsafeIngredients() ? "pass" : "warn", ""});
    return out;
}

json ConsistencyReport::toJson() const {
    json checksJson = json::array();
    for (const auto& c : checks()) checksJson.push_back(json{{"label", c.label}, {"status", c.status}, {"detail", c.detail}});
    return json{
        {"requiredRespected", requiredRespected()}, {"dietRespected", dietRespected()},
        {"noUnsafeIngredients", noUnsafeIngredients()}, {"clean", clean()},
        {"missingRequired", missingRequired}, {"additional", additional},
        {"suspicious", suspicious}, {"dietConflicts", dietConflicts},
        {"checks", checksJson}};
}
