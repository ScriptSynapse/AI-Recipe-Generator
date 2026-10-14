// Phase F tests: each RecipeEvaluator sub-score in isolation (so a future
// change to one rubric can't silently break another), plus full
// evaluate() runs against realistic good/bad recipes, confirming no score
// is ever fabricated -- every number traces back to an inspectable
// property of the recipe.
#include <cassert>
#include <iostream>
#include "../cpp-core/evaluation/RecipeEvaluator.h"
#include "../cpp-core/models/AIRecipe.h"
#include "../cpp-core/models/RecipePreferences.h"

namespace {

Ingredient ing(const std::string& name, double qty = 1, const std::string& unit = "g") {
    return Ingredient(name, qty, unit);
}

RecipePreferences prefsFor(std::vector<std::string> ingredients, const std::string& diet, int cookingTime) {
    return RecipePreferences::fromJson(json{
        {"ingredients", ingredients}, {"cuisine", "Indian"}, {"mealType", "Dinner"},
        {"dietaryPreference", diet}, {"cookingTime", cookingTime}, {"difficulty", "Medium"}, {"servings", 2}});
}

AIRecipe makeRecipe(std::vector<Ingredient> ingredients, std::vector<std::string> instructions,
                    int cookingTime, NutritionInfo nutrition) {
    return AIRecipe("id-1", "Test Recipe", "Indian", "Dinner", "No Preference",
                    std::move(ingredients), std::move(instructions), cookingTime, "Medium", 2,
                    nutrition, "test-provider", false);
}

bool anyWarningContains(const std::vector<std::string>& warnings, const std::string& needle) {
    for (const auto& w : warnings) if (w.find(needle) != std::string::npos) return true;
    return false;
}

} // namespace

int main() {
    // ---- scoreIngredientCompatibility --------------------------------------
    {
        std::vector<Ingredient> recipeIngs = {ing("paneer"), ing("tomato"), ing("onion")};
        assert(RecipeEvaluator::scoreIngredientCompatibility(recipeIngs, {"paneer", "tomato"}) == 100.0);
        assert(RecipeEvaluator::scoreIngredientCompatibility(recipeIngs, {"paneer", "chicken"}) == 50.0);
        assert(RecipeEvaluator::scoreIngredientCompatibility(recipeIngs, {}) == 100.0);
        assert(RecipeEvaluator::scoreIngredientCompatibility({}, {"paneer"}) == 0.0);
    }
    std::cout << "EVAL-ING-01 passed: ingredient compatibility is a real fraction match.\n";

    // ---- scoreDietCompliance ------------------------------------------------
    {
        std::vector<std::string> warnings;
        std::vector<Ingredient> veggie = {ing("paneer"), ing("tomato")};
        assert(RecipeEvaluator::scoreDietCompliance(veggie, "Vegetarian", warnings) == 100.0);
        assert(warnings.empty());
    }
    {
        std::vector<std::string> warnings;
        std::vector<Ingredient> withMeat = {ing("chicken"), ing("rice")};
        double score = RecipeEvaluator::scoreDietCompliance(withMeat, "Vegetarian", warnings);
        assert(score <= 50.0);
        assert(anyWarningContains(warnings, "chicken"));
    }
    {
        // Vegan is stricter than vegetarian: dairy also conflicts.
        std::vector<std::string> warnings;
        std::vector<Ingredient> withDairy = {ing("paneer"), ing("rice")};
        assert(RecipeEvaluator::scoreDietCompliance(withDairy, "Vegetarian", warnings) == 100.0);
        std::vector<std::string> warnings2;
        assert(RecipeEvaluator::scoreDietCompliance(withDairy, "Vegan", warnings2) < 100.0);
    }
    {
        // High Protein has no ingredient-exclusion list -- honestly scores 100, not fabricated.
        std::vector<std::string> warnings;
        std::vector<Ingredient> anything = {ing("chicken"), ing("rice"), ing("butter")};
        assert(RecipeEvaluator::scoreDietCompliance(anything, "High Protein", warnings) == 100.0);
        assert(warnings.empty());
    }
    {
        // Multiple violations compound.
        std::vector<std::string> w1, w2;
        std::vector<Ingredient> oneViolation = {ing("chicken"), ing("rice")};
        std::vector<Ingredient> twoViolations = {ing("chicken"), ing("beef")};
        double s1 = RecipeEvaluator::scoreDietCompliance(oneViolation, "Vegetarian", w1);
        double s2 = RecipeEvaluator::scoreDietCompliance(twoViolations, "Vegetarian", w2);
        assert(s2 < s1);
        assert(w2.size() == 2);
    }
    std::cout << "EVAL-DIET-01..05 passed: diet compliance scans actual ingredients, not a label.\n";

    // ---- scoreCookingTimeCompliance (delegates to ScoringUtil) -------------
    {
        assert(RecipeEvaluator::scoreCookingTimeCompliance(30, 25) == 100.0);
        assert(RecipeEvaluator::scoreCookingTimeCompliance(30, 30) == 100.0);
        assert(RecipeEvaluator::scoreCookingTimeCompliance(30, 60) < 100.0);
        assert(RecipeEvaluator::scoreCookingTimeCompliance(30, 60) >= 0.0);
    }
    std::cout << "EVAL-TIME-01 passed: cooking-time compliance matches the shared formula.\n";

    // ---- scoreInstructionCompleteness ---------------------------------------
    {
        std::vector<std::string> w;
        assert(RecipeEvaluator::scoreInstructionCompleteness({}, w) == 0.0);
        assert(anyWarningContains(w, "no instructions"));
    }
    {
        std::vector<std::string> w;
        double oneStep = RecipeEvaluator::scoreInstructionCompleteness({"Cook it well for ten minutes."}, w);
        std::vector<std::string> w2;
        double fiveSteps = RecipeEvaluator::scoreInstructionCompleteness(
            {"Chop the vegetables finely.", "Heat oil in a large pan.", "Add the spices and stir.",
             "Cook until tender and fragrant.", "Serve hot with rice."}, w2);
        assert(fiveSteps > oneStep);
        assert(fiveSteps == 100.0);
    }
    {
        std::vector<std::string> w;
        double score = RecipeEvaluator::scoreInstructionCompleteness({"Mix.", "Cook.", "Serve hot immediately."}, w);
        assert(score < 60.0);   // two very short steps penalized
        assert(anyWarningContains(w, "too short"));
    }
    std::cout << "EVAL-INSTR-01..03 passed: instruction completeness reflects real step count/quality.\n";

    // ---- scoreNutritionConsistency ------------------------------------------
    {
        std::vector<std::string> w;
        NutritionInfo consistent{500, 25, 50, 25, true};   // 25*4+50*4+25*9 = 100+200+225=525, diff ~5%
        assert(RecipeEvaluator::scoreNutritionConsistency(consistent, w) == 100.0);
    }
    {
        std::vector<std::string> w;
        NutritionInfo wild{100, 50, 50, 50, true};   // computed = 200+200+450=850 vs 100 -> huge mismatch
        double score = RecipeEvaluator::scoreNutritionConsistency(wild, w);
        assert(score <= 40.0);
        assert(!w.empty());
    }
    {
        std::vector<std::string> w;
        NutritionInfo negative{500, -5, 50, 25, true};
        assert(RecipeEvaluator::scoreNutritionConsistency(negative, w) == 0.0);
        assert(anyWarningContains(w, "negative"));
    }
    {
        std::vector<std::string> w;
        NutritionInfo zero{0, 0, 0, 0, true};
        assert(RecipeEvaluator::scoreNutritionConsistency(zero, w) == 0.0);
    }
    std::cout << "EVAL-NUTR-01..04 passed: nutrition consistency checks real macro math, not ground truth.\n";

    // ---- scoreSafety ----------------------------------------------------------
    {
        std::vector<std::string> w;
        std::vector<Ingredient> withChicken = {ing("chicken"), ing("rice")};
        double safe = RecipeEvaluator::scoreSafety(
            withChicken, {"Marinate the chicken.", "Cook the chicken thoroughly in a pan.", "Serve with rice."}, w);
        assert(safe == 100.0);
    }
    {
        std::vector<std::string> w;
        std::vector<Ingredient> withChicken = {ing("chicken"), ing("rice")};
        double unsafe = RecipeEvaluator::scoreSafety(
            withChicken, {"Mix the chicken with rice.", "Add some spices.", "Serve immediately."}, w);
        assert(unsafe < 100.0);
        assert(anyWarningContains(w, "raw animal-protein"));
    }
    {
        std::vector<std::string> w;
        std::vector<Ingredient> vegOnly = {ing("tomato"), ing("onion")};
        double score = RecipeEvaluator::scoreSafety(vegOnly, {"Mix everything together.", "Serve cold."}, w);
        assert(score == 100.0);   // no raw protein, no cooking verb needed
    }
    {
        std::vector<std::string> w;
        std::vector<Ingredient> withChicken = {ing("chicken")};
        double score = RecipeEvaluator::scoreSafety(withChicken, {}, w);
        assert(score < 100.0);
        assert(anyWarningContains(w, "Cannot verify"));
    }
    std::cout << "EVAL-SAFE-01..04 passed: safety flag triggers only on a real, checkable condition.\n";

    // ---- Full evaluate(): realistic GOOD recipe scores high across the board.
    {
        auto prefs = prefsFor({"paneer", "tomato"}, "Vegetarian", 30);
        auto recipe = makeRecipe(
            {ing("paneer", 200, "g"), ing("tomato", 2, "whole"), ing("onion", 1, "whole")},
            {"Cube the paneer into bite-sized pieces.", "Saute the onion until golden brown.",
             "Add chopped tomato and cook until soft.", "Stir in the paneer and simmer for five minutes.",
             "Serve hot with rice or naan."},
            25, NutritionInfo{520, 28, 30, 32, true});
        auto eval = RecipeEvaluator::evaluate(recipe, prefs);
        assert(eval.ingredientScore == 100.0);
        assert(eval.dietScore == 100.0);
        assert(eval.instructionScore == 100.0);
        assert(eval.safetyScore == 100.0);
        assert(eval.overallScore > 85.0);
        json j = eval.toJson();
        assert(j.contains("overallScore") && j.contains("warnings"));
        assert(j["ingredientScore"].is_number_integer());   // rounded for display, per the spec's JSON example
    }
    std::cout << "EVAL-FULL-01 passed: a genuinely good recipe scores high across every criterion.\n";

    // ---- Full evaluate(): realistic BAD recipe (diet violation + unsafe +
    // sparse instructions + nutrition mismatch) scores low overall, with
    // warnings explaining exactly why.
    {
        auto prefs = prefsFor({"paneer", "tomato"}, "Vegetarian", 20);
        auto recipe = makeRecipe(
            {ing("chicken", 200, "g"), ing("tomato", 2, "whole")},
            {"Mix.", "Serve."},
            90,   // way over the 20-minute budget
            NutritionInfo{50, 80, 80, 80, true});   // wildly inconsistent macros
        auto eval = RecipeEvaluator::evaluate(recipe, prefs);
        assert(eval.dietScore <= 50.0);
        assert(eval.instructionScore < 50.0);
        assert(eval.nutritionScore <= 40.0);
        assert(eval.overallScore < 50.0);
        assert(eval.warnings.size() >= 3);   // diet + instructions + nutrition + time, at least 3
    }
    std::cout << "EVAL-FULL-02 passed: a genuinely bad recipe scores low, with explanatory warnings.\n";

    // ---- evaluate() never crashes on a degenerate/empty recipe. ------------
    {
        auto prefs = prefsFor({"paneer"}, "Vegan", 30);
        auto recipe = makeRecipe({}, {}, 0, NutritionInfo{0, 0, 0, 0, true});
        auto eval = RecipeEvaluator::evaluate(recipe, prefs);
        assert(eval.overallScore >= 0.0 && eval.overallScore <= 100.0);
        assert(!eval.warnings.empty());
    }
    std::cout << "EVAL-FULL-03 passed: evaluate() degrades gracefully on an empty/degenerate recipe.\n";

    // ---- evaluate() works through the abstract Recipe& base (polymorphism),
    // not just when the concrete type happens to be AIRecipe.
    {
        auto prefs = prefsFor({"paneer"}, "No Preference", 30);
        AIRecipe concrete = makeRecipe({ing("paneer")}, {"Cook the paneer well in a pan."}, 20,
                                       NutritionInfo{400, 20, 20, 20, true});
        const Recipe& asBase = concrete;
        auto eval = RecipeEvaluator::evaluate(asBase, prefs);
        assert(eval.overallScore > 0.0);
    }
    std::cout << "EVAL-FULL-04 passed: evaluate() takes the abstract Recipe base, works polymorphically.\n";

    std::cout << "All RecipeEvaluator tests passed.\n";
    return 0;
}
