#include "AIGenerator.h"
#include "../models/AIRecipe.h"
#include "RecipeTemplateEngine.h"
#include "../ai/LLMProviderFactory.h"
#include "../ai/ModelRouter.h"
#include "../ai/http/CurlHttpClient.h"
#include "../validation/AIOutputValidator.h"
#include "../security/events/SecurityEventFactory.h"
#include <sstream>
#include <random>
#include <algorithm>
#include <iostream>

// Default: a ModelRouter over every configured provider, in factory order
// (claude -> gemini -> openai -> groq -> local; Phase 21 failover chain).
// A provider with no key configured is skipped automatically (isAvailable()
// == false), so this is a strict superset of the pre-Phase-C behavior: with
// only ANTHROPIC_API_KEY set, it behaves exactly as before (tries Claude,
// falls through to the offline template on any failure). ModelRouter IS-A
// LLMProvider, so no other change to AIGenerator was needed for this.
AIGenerator::AIGenerator()
    : provider(ModelRouter::buildDefaultChain(std::make_shared<CurlHttpClient>())) {}

AIGenerator::AIGenerator(std::unique_ptr<LLMProvider> injectedProvider)
    : provider(std::move(injectedProvider)) {}

void AIGenerator::setEventManager(SecurityEventManager* manager) {
    events = manager;
    if (provider) provider->setEventManager(manager);
}

bool AIGenerator::hasApiKey() const {
    return provider && provider->isAvailable();
}

std::string AIGenerator::getModel() const {
    return provider ? provider->getModelName() : "";
}

std::vector<std::pair<std::string, std::string>> AIGenerator::getProviderStatuses() const {
    if (!provider) return {};
    if (auto* router = dynamic_cast<ModelRouter*>(provider.get())) return router->chainStatuses();
    return {{provider->getProviderName(), toString(provider->getStatus())}};
}

std::string AIGenerator::buildPrompt(const RecipePreferences& preferences) {
    std::ostringstream prompt;
    prompt << "You are a professional recipe developer. Create ONE original recipe using the "
           << "following constraints and respond with ONLY a single JSON object, no markdown "
           << "fences, no preamble, matching exactly this schema:\n"
           << "{\n"
           << "  \"name\": string,\n"
           << "  \"ingredients\": [{\"name\": string, \"quantity\": number, \"unit\": string}],\n"
           << "  \"instructions\": [string, ...],\n"
           << "  \"cookingTime\": number (minutes),\n"
           << "  \"difficulty\": \"Easy\"|\"Medium\"|\"Hard\",\n"
           << "  \"calories\": number (total for all servings),\n"
           << "  \"proteinGrams\": number, \"carbsGrams\": number, \"fatGrams\": number,\n"
           << "  \"substitutions\": [string, ...]\n"
           << "}\n\n"
           << "Constraints:\n"
           << "- Available ingredients: ";
    const auto& ing = preferences.getIngredients();
    for (size_t i = 0; i < ing.size(); ++i) {
        prompt << ing[i];
        if (i + 1 < ing.size()) prompt << ", ";
    }
    prompt << "\n- Cuisine: " << preferences.getCuisine()
           << "\n- Meal type: " << preferences.getMealType()
           << "\n- Dietary preference: " << preferences.getDietaryPreference()
           << "\n- Maximum cooking time: " << preferences.getCookingTime() << " minutes"
           << "\n- Difficulty: " << preferences.getDifficulty()
           << "\n- Servings: " << preferences.getServings()
           << "\n\nSTRICT RULE: use ONLY the ingredients listed above in the \"ingredients\" array "
           << "of your response -- do not add any ingredient the user did not list, including "
           << "extra vegetables, proteins, dairy, sauces, or garnishes. The only exceptions are "
           << "salt, black pepper, and water, which may be used for seasoning/cooking even though "
           << "they weren't listed, since almost every kitchen already has them. Do not invent a "
           << "need for oil, butter, or any other ingredient beyond those two exceptions -- if the "
           << "dish would normally need something else, choose a preparation method or instruction "
           << "that works without it instead. Respect the dietary preference strictly.";
    return prompt.str();
}

std::unique_ptr<Recipe> AIGenerator::parseRecipeResponse(std::string text,
                                                         const RecipePreferences& preferences,
                                                         const std::string& providerLabel) {
    // Phase G: never blindly trust an LLM response. AIOutputValidator
    // strips any markdown fence, parses the JSON, and checks it against
    // the exact schema buildPrompt() asked for (required fields, correct
    // types, sane ranges, no unexpected fields). It throws
    // AIOutputValidationException -- a std::exception -- on any problem,
    // which generateRecipe()'s existing catch-all turns into a clean
    // fallback to the offline generator, exactly like a provider/network
    // failure. Only JSON that has already passed every check reaches the
    // construction logic below.
    json recipeJson = AIOutputValidator::validateAndParse(text);

    std::vector<Ingredient> ingredients;
    for (const auto& ij : recipeJson.value("ingredients", json::array())) {
        ingredients.push_back(Ingredient::fromJson(ij));
    }
    std::vector<std::string> instructions;
    for (const auto& s : recipeJson.value("instructions", json::array())) {
        instructions.push_back(s.get<std::string>());
    }

    NutritionInfo nutrition;
    nutrition.calories = recipeJson.value("calories", 0.0);
    nutrition.proteinGrams = recipeJson.value("proteinGrams", 0.0);
    nutrition.carbsGrams = recipeJson.value("carbsGrams", 0.0);
    nutrition.fatGrams = recipeJson.value("fatGrams", 0.0);
    nutrition.estimated = true;

    auto recipe = std::make_unique<AIRecipe>(
        "ai-" + std::to_string(std::hash<std::string>{}(recipeJson.value("name", "recipe"))),
        recipeJson.value("name", "AI Generated Recipe"),
        preferences.getCuisine(),
        preferences.getMealType(),
        preferences.getDietaryPreference(),
        ingredients,
        instructions,
        recipeJson.value("cookingTime", preferences.getCookingTime()),
        recipeJson.value("difficulty", preferences.getDifficulty()),
        preferences.getServings(),
        nutrition,
        providerLabel,
        false
    );

    for (const auto& sub : recipeJson.value("substitutions", json::array())) {
        recipe->addSubstitutionNote(sub.get<std::string>());
    }

    recipe->generateInstructions();
    return recipe;
}

// -----------------------------------------------------------------------
// Local, offline fallback generator. Builds a plausible recipe purely
// from templates so the application keeps working with zero network
// access or API key configured — required by the "AI Fallback" spec.
// -----------------------------------------------------------------------
std::unique_ptr<Recipe> AIGenerator::callFallbackProvider(const RecipePreferences& preferences) {
    const auto& userIngredients = preferences.getIngredients();

    // Deterministic-but-varied RNG, shared with RecipeTemplateEngine so
    // both the calorie estimate and any future phrasing variation stay
    // in sync across a single fallback generation call.
    std::random_device rd;
    std::mt19937 gen(rd());

    // RecipeTemplateEngine classifies the actual ingredients (protein,
    // vegetable, grain, dairy, sweet, liquid, ...) and the dish context
    // (dessert / breakfast / salad / stir-fry / curry-style simmer /
    // general) to build a title and instruction sequence that actually
    // fits the dish being made, instead of one fixed template reused
    // for every request regardless of what's in it.
    RecipeTemplateEngine::GeneratedContent generated = RecipeTemplateEngine::generate(preferences, gen);

    // STRICT INGREDIENTS ONLY: the recipe's ingredient list is exactly
    // what the user provided, scaled to servings -- nothing added. Salt,
    // pepper, and water are allowed in the *instructions* as seasoning
    // steps (almost every kitchen has them) but are deliberately NOT
    // added as extra ingredient-list entries, so what's shown to the
    // user always matches what they said they have.
    std::vector<Ingredient> ingredients;
    for (const auto& userIng : userIngredients) {
        ingredients.emplace_back(userIng, 1.0 * preferences.getServings() / 2.0, "cup");
    }

    std::uniform_int_distribution<> calorieJitter(-40, 60);
    double baseCalories = 320.0 * preferences.getServings() + calorieJitter(gen);

    NutritionInfo nutrition;
    nutrition.calories = baseCalories;
    nutrition.proteinGrams = baseCalories * 0.12 / 4.0;
    nutrition.carbsGrams = baseCalories * 0.5 / 4.0;
    nutrition.fatGrams = baseCalories * 0.3 / 9.0;
    nutrition.estimated = true;

    auto recipe = std::make_unique<AIRecipe>(
        "ai-fallback-" + std::to_string(gen()),
        generated.title,
        preferences.getCuisine(),
        preferences.getMealType(),
        preferences.getDietaryPreference(),
        ingredients,
        generated.instructions,
        preferences.getCookingTime(),
        preferences.getDifficulty(),
        preferences.getServings(),
        nutrition,
        "fallback-mock",
        true
    );

    if (!userIngredients.empty()) {
        recipe->addSubstitutionNote("No " + userIngredients[0] + "? Try a similar-textured vegetable or protein you have on hand.");
    }

    recipe->generateInstructions();
    return recipe;
}

std::unique_ptr<Recipe> AIGenerator::generateRecipe(const RecipePreferences& preferences) {
    if (provider && provider->isAvailable()) {
        try {
            std::string text = provider->generate(buildPrompt(preferences));
            return parseRecipeResponse(text, preferences, provider->getProviderName());
        } catch (const AIOutputValidationException& e) {
            // The provider answered, but not with a valid recipe. Report it
            // (value-free: field names only) and fall back like any failure.
            if (events) events->emit(SecurityEventFactory::aiOutputRejected(provider->getProviderName(), e.getIssues()));
            std::cerr << "[AIGenerator] provider '" << provider->getProviderName()
                      << "' response rejected, using fallback: " << e.what() << std::endl;
        } catch (const std::exception& e) {
            // LLMException (missing key, timeout, rate limit, network,
            // bad HTTP status, malformed body) or a parsing failure below
            // -- every case degrades to the local generator; nothing
            // escapes and the app never crashes because a provider is down.
            std::cerr << "[AIGenerator] provider '" << provider->getProviderName()
                      << "' failed, using fallback: " << e.what() << std::endl;
        }
    }
    return callFallbackProvider(preferences);
}
