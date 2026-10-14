// RecipeBuilder (Builder pattern): fluent construction, defaults, both concrete types,
// and that build() refuses every invalid combination with a specific, value-free error.
#include <cassert>
#include <iostream>
#include <typeinfo>
#include "../cpp-core/models/RecipeBuilder.h"
#include "../cpp-core/models/AIRecipe.h"
#include "../cpp-core/models/TraditionalRecipe.h"
#include "../cpp-core/validation/Validator.h"

namespace {

RecipeBuilder valid() {
    RecipeBuilder b;
    b.withName("Kadai Paneer")
        .withIngredients({Ingredient("paneer", 200, "g"), Ingredient("tomato", 2, "")})
        .withInstructions({"Heat the oil in a pan.", "Add paneer and tomato and cook for ten minutes."})
        .withCookingTime(30);
    return b;
}

std::string codeOf(const RecipeBuilder& b) {
    try { b.build(); } catch (const ValidationException& e) { return e.getCode(); }
    return "";
}

} // namespace

int main() {
    // ---- defaults, and the default concrete type -------------------------------------------
    {
        auto r = valid().build();
        assert(r->getName() == "Kadai Paneer");
        assert(r->getDietaryPreference() == "No Preference");
        assert(r->getDifficulty() == "Medium");
        assert(r->getServings() == 2);
        assert(r->getNutrition().estimated);
        assert(r->getId().rfind("recipe-", 0) == 0);
        assert(dynamic_cast<TraditionalRecipe*>(r.get()) != nullptr);
        assert(dynamic_cast<AIRecipe*>(r.get()) == nullptr);
        auto r2 = valid().build();
        assert(r->getId() != r2->getId());
    }
    std::cout << "BLD-01 passed: defaults applied, TraditionalRecipe by default, ids unique.\n";

    // ---- every field is carried through ----------------------------------------------------
    {
        NutritionInfo n; n.calories = 400; n.proteinGrams = 20; n.carbsGrams = 40; n.fatGrams = 15; n.estimated = false;
        auto r = valid().withId("fixed-id").withCuisine("Indian").withMealType("Dinner").withDiet("Vegetarian")
                     .withDifficulty("Hard").withServings(4).withCookingTime(45).withNutrition(n)
                     .withSubstitutionNotes({"cream -> yogurt"}).build();
        assert(r->getId() == "fixed-id");
        assert(r->getCuisine() == "Indian" && r->getMealType() == "Dinner");
        assert(r->getDietaryPreference() == "Vegetarian" && r->getDifficulty() == "Hard");
        assert(r->getServings() == 4 && r->getCookingTime() == 45);
        assert(r->getNutrition().calories == 400 && !r->getNutrition().estimated);
        assert(r->getSubstitutionNotes().size() == 1);
        assert(r->getIngredients().size() == 2 && r->getInstructions().size() == 2);
    }
    std::cout << "BLD-02 passed: every with*() value reaches the Recipe.\n";

    // ---- AI and traditional variants ---------------------------------------------------------
    {
        auto ai = valid().asAI("claude", false).build();
        auto* air = dynamic_cast<AIRecipe*>(ai.get());
        assert(air != nullptr);
        assert(air->getAiProvider() == "claude" && !air->didUseFallback());
        auto fb = valid().asAI("fallback-mock", true).build();
        assert(dynamic_cast<AIRecipe*>(fb.get())->didUseFallback());
        auto trad = valid().asAI("x", false).asTraditional(77.5).build();
        auto* tr = dynamic_cast<TraditionalRecipe*>(trad.get());
        assert(tr != nullptr && tr->getMatchScore() == 77.5);
        assert(codeOf(valid().asAI("  ", false)) == "RECIPE_PROVIDER");
        assert(ai->getSourceLabel() != trad->getSourceLabel());   // polymorphism survives construction via the builder
    }
    std::cout << "BLD-03 passed: asAI()/asTraditional() choose the concrete type.\n";

    // ---- validation ---------------------------------------------------------------------------
    {
        assert(codeOf(RecipeBuilder()) == "RECIPE_NAME");
        assert(codeOf(valid().withName("   ")) == "RECIPE_NAME");
        assert(codeOf(valid().withIngredients({})) == "RECIPE_INGREDIENTS");
        assert(codeOf(valid().withIngredients({Ingredient("", 1, "g")})) == "RECIPE_INGREDIENTS");
        assert(codeOf(valid().withIngredients({Ingredient("salt", -1, "g")})) == "RECIPE_INGREDIENTS");
        assert(codeOf(valid().withInstructions({})) == "RECIPE_INSTRUCTIONS");
        assert(codeOf(valid().withInstructions({"ok step", "  "})) == "RECIPE_INSTRUCTIONS");
        assert(codeOf(valid().withCookingTime(0)) == "RECIPE_TIME");
        assert(codeOf(valid().withCookingTime(481)) == "RECIPE_TIME");
        assert(codeOf(valid().withServings(0)) == "RECIPE_SERVINGS");
        assert(codeOf(valid().withServings(13)) == "RECIPE_SERVINGS");
        assert(codeOf(valid().withDifficulty("Impossible")) == "RECIPE_DIFFICULTY");
        assert(codeOf(valid().withDiet("Carnivore")) == "RECIPE_DIET");
        assert(codeOf(valid().withCuisine("Martian")) == "RECIPE_CUISINE");
        assert(codeOf(valid().withMealType("Brunch")) == "RECIPE_MEAL_TYPE");
        assert(codeOf(valid()) == "");
    }
    std::cout << "BLD-04 passed: invalid recipes cannot be built.\n";

    // ---- boundaries ------------------------------------------------------------------------------
    {
        assert(codeOf(valid().withCookingTime(1)) == "");
        assert(codeOf(valid().withCookingTime(480)) == "");
        assert(codeOf(valid().withServings(1)) == "");
        assert(codeOf(valid().withServings(12)) == "");
        assert(codeOf(valid().withDifficulty("easy")) == "");           // case-insensitive, like Validator
        assert(codeOf(valid().withIngredients({Ingredient("salt", 0, "")})) == "");
    }
    std::cout << "BLD-05 passed: boundaries are exactly 1..480 minutes and 1..12 servings.\n";

    // ---- errors never echo input ------------------------------------------------------------------
    {
        try { valid().withCuisine("<script>alert(1)</script>").build(); assert(false); }
        catch (const ValidationException& e) { assert(std::string(e.what()).find("script") == std::string::npos); }
        try { valid().withDiet("sk-ant-secretkey").build(); assert(false); }
        catch (const ValidationException& e) { assert(std::string(e.what()).find("sk-ant") == std::string::npos); }
    }
    std::cout << "BLD-06 passed: error messages are fixed text.\n";

    // ---- builder reuse -------------------------------------------------------------------------------
    {
        RecipeBuilder b = valid();
        auto first = b.build();
        b.withName("Second");
        auto second = b.build();
        assert(first->getName() == "Kadai Paneer" && second->getName() == "Second");
    }
    std::cout << "BLD-07 passed: a builder can be reused without affecting recipes already built.\n";

    std::cout << "ALL RECIPE BUILDER TESTS PASSED\n";
    return 0;
}
