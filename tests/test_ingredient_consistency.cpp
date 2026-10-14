// IngredientConsistencyChecker: required / additional / suspicious / diet-conflict detection,
// the user-facing check list, and JSON shape.
#include <algorithm>
#include <cassert>
#include <iostream>
#include "../cpp-core/evaluation/IngredientConsistencyChecker.h"
#include "../cpp-core/evaluation/RecipeEvaluator.h"
#include "../cpp-core/models/RecipeBuilder.h"

namespace {

Ingredient ing(const std::string& n) { return Ingredient(n, 1, "g"); }
bool has(const std::vector<std::string>& v, const std::string& s) { return std::find(v.begin(), v.end(), s) != v.end(); }

} // namespace

int main() {
    // ---- a clean match ------------------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({ing("paneer"), ing("tomato"), ing("salt"), ing("water")}, {"paneer", "tomato"}, "Vegetarian");
        assert(r.clean() && r.requiredRespected() && r.dietRespected() && r.noUnsafeIngredients());
        assert(r.additional.empty() && "salt and water are staples, not additions");
    }
    std::cout << "ICC-01 passed: exact use of the user's ingredients is clean (staples ignored).\n";

    // ---- missing required -----------------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({ing("paneer")}, {"Paneer", "tomato", "onion"}, "No Preference");
        assert(!r.requiredRespected());
        assert(r.missingRequired.size() == 2 && has(r.missingRequired, "tomato") && has(r.missingRequired, "onion"));
        assert(!has(r.missingRequired, "Paneer") && "matching is case-insensitive");
    }
    std::cout << "ICC-02 passed: unused requested ingredients are reported, case-insensitively.\n";

    // ---- additional (unexpected) ------------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({ing("paneer"), ing("cashew paste"), ing("saffron"), ing("black pepper")}, {"paneer"}, "No Preference");
        assert(r.additional.size() == 2 && has(r.additional, "cashew paste") && has(r.additional, "saffron"));
        assert(r.requiredRespected() && !r.clean());
        auto c = r.checks();
        assert(c[2].status == "warn" && c[2].label == "2 additional ingredients detected");
    }
    std::cout << "ICC-03 passed: extra ingredients are counted; the label is pluralised correctly.\n";

    // ---- substring matching both ways ---------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({ing("diced tomatoes"), ing("red onions")}, {"tomato", "onion"}, "No Preference");
        assert(r.requiredRespected());                                   // 'tomato' is inside 'diced tomatoes'
        assert(r.additional.empty());
    }
    std::cout << "ICC-04 passed: containment matching (a short request inside a longer recipe name).\n";

    // ---- suspicious (non-food) -----------------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({ing("paneer"), ing("Bleach"), ing("liquid detergent")}, {"paneer"}, "No Preference");
        assert(!r.noUnsafeIngredients());
        assert(r.suspicious.size() == 2 && has(r.suspicious, "Bleach") && has(r.suspicious, "liquid detergent"));
        assert(r.checks()[3].status == "warn" && r.checks()[3].label == "Unsafe ingredient detected");
        // The rule is plain substring matching, and says so: a food whose name merely CONTAINS a flagged word is flagged too.
        auto ok = IngredientConsistencyChecker::check({ing("coconut milk"), ing("mercury grapes")}, {"coconut milk"}, "No Preference");
        assert(has(ok.suspicious, "mercury grapes") && ok.suspicious.size() == 1);
    }
    std::cout << "ICC-05 passed: non-food substances are flagged by name.\n";

    // ---- diet conflicts ---------------------------------------------------------------------------
    {
        auto veg = IngredientConsistencyChecker::check({ing("paneer"), ing("chicken breast")}, {"paneer"}, "Vegetarian");
        assert(!veg.dietRespected() && veg.dietConflicts.size() == 1 && has(veg.dietConflicts, "chicken breast"));
        auto vegan = IngredientConsistencyChecker::check({ing("tofu"), ing("butter"), ing("honey")}, {"tofu"}, "Vegan");
        assert(vegan.dietConflicts.size() == 2);
        auto gf = IngredientConsistencyChecker::check({ing("rice"), ing("wheat flour")}, {"rice"}, "Gluten Free");
        assert(has(gf.dietConflicts, "wheat flour"));
        auto none = IngredientConsistencyChecker::check({ing("chicken")}, {"chicken"}, "No Preference");
        assert(none.dietRespected());
        auto macro = IngredientConsistencyChecker::check({ing("chicken")}, {"chicken"}, "High Protein");
        assert(macro.dietRespected() && "macro diets have no exclusion list");
        auto c = veg.checks();
        assert(c[1].status == "warn" && c[1].detail == "1 conflicting ingredient found");
    }
    std::cout << "ICC-06 passed: diet conflicts agree with the evaluator's keyword lists.\n";

    // ---- shares the evaluator's rules -----------------------------------------------------------------
    {
        std::vector<Ingredient> ings = {ing("chicken"), ing("rice")};
        auto direct = RecipeEvaluator::findDietConflicts(ings, "Vegetarian");
        auto viaChecker = IngredientConsistencyChecker::check(ings, {"rice", "chicken"}, "Vegetarian").dietConflicts;
        assert(direct == viaChecker);
        std::vector<std::string> warnings;
        assert(RecipeEvaluator::scoreDietCompliance(ings, "Vegetarian", warnings) < 100.0 && warnings.size() == direct.size());
    }
    std::cout << "ICC-07 passed: the checker and the evaluator cannot disagree about diet conflicts.\n";

    // ---- Recipe + preferences overload, JSON, check list ---------------------------------------------------
    {
        auto recipe = RecipeBuilder().withName("Test").withIngredients({ing("paneer"), ing("saffron")})
                          .withInstructions({"Cook everything for ten minutes."}).build();
        auto prefs = RecipePreferences::fromJson(json{{"ingredients", {"paneer", "tomato"}}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
                                                       {"dietaryPreference", "Vegetarian"}, {"cookingTime", 30}, {"difficulty", "Medium"}, {"servings", 2}});
        auto r = IngredientConsistencyChecker::check(*recipe, prefs);
        assert(has(r.missingRequired, "tomato") && has(r.additional, "saffron"));
        json j = r.toJson();
        assert(j["requiredRespected"] == false && j["clean"] == false && j["dietRespected"] == true);
        assert(j["checks"].size() == 4);
        assert(j["checks"][0]["label"] == "Required ingredients respected" && j["checks"][0]["status"] == "warn");
        assert(j["missingRequired"][0] == "tomato");
    }
    std::cout << "ICC-08 passed: Recipe overload and JSON shape.\n";

    // ---- empty inputs --------------------------------------------------------------------------------------
    {
        auto r = IngredientConsistencyChecker::check({}, {}, "No Preference");
        assert(r.clean());
        auto onlyRequested = IngredientConsistencyChecker::check({}, {"rice"}, "No Preference");
        assert(!onlyRequested.requiredRespected());
        auto blank = IngredientConsistencyChecker::check({ing("rice")}, {""}, "No Preference");
        assert(blank.requiredRespected() && !blank.additional.empty());   // an empty request matches nothing and requires nothing
        for (const auto& c : r.checks()) assert(c.status == "pass");
        assert(r.checks()[0].label == "Required ingredients respected" && r.checks()[2].label == "No additional ingredients");
    }
    std::cout << "ICC-09 passed: empty inputs are handled.\n";

    std::cout << "ALL INGREDIENT CONSISTENCY TESTS PASSED\n";
    return 0;
}
