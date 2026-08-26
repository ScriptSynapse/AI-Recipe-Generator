#include "AIGenerator.h"
#include "../models/AIRecipe.h"
#include <cstdlib>
#include <sstream>
#include <random>
#include <algorithm>
#include <curl/curl.h>
#include <iostream>

AIGenerator::AIGenerator() : model("claude-sonnet-4-6") {
    const char* key = std::getenv("ANTHROPIC_API_KEY");
    if (key != nullptr) apiKey = std::string(key);
}

bool AIGenerator::hasApiKey() const {
    return !apiKey.empty();
}

std::string AIGenerator::buildPrompt(const RecipePreferences& preferences) const {
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
           << "\n\nUse the listed ingredients as the base of the dish, adding a small number of "
           << "common pantry staples only if necessary. Respect the dietary preference strictly.";
    return prompt.str();
}

// libcurl write-callback: appends received bytes into a std::string buffer.
static size_t curlWriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t total = size * nmemb;
    static_cast<std::string*>(userp)->append(static_cast<char*>(contents), total);
    return total;
}

std::unique_ptr<Recipe> AIGenerator::callRealProvider(const RecipePreferences& preferences) {
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("Failed to initialize HTTP client.");

    std::string prompt = buildPrompt(preferences);

    json requestBody = {
        {"model", model},
        {"max_tokens", 1500},
        {"messages", json::array({
            json{{"role", "user"}, {"content", prompt}}
        })}
    };
    std::string requestStr = requestBody.dump();

    std::string responseBuffer;
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "content-type: application/json");
    headers = curl_slist_append(headers, ("x-api-key: " + apiKey).c_str());
    headers = curl_slist_append(headers, "anthropic-version: 2023-06-01");

    curl_easy_setopt(curl, CURLOPT_URL, "https://api.anthropic.com/v1/messages");
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, requestStr.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &responseBuffer);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("AI request failed: ") + curl_easy_strerror(res));
    }
    if (httpCode < 200 || httpCode >= 300) {
        throw std::runtime_error("AI provider returned HTTP " + std::to_string(httpCode) + ": " + responseBuffer);
    }

    json responseJson = json::parse(responseBuffer);
    if (!responseJson.contains("content") || !responseJson["content"].is_array() || responseJson["content"].empty()) {
        throw std::runtime_error("AI provider response missing content.");
    }

    std::string text = responseJson["content"][0].value("text", "");
    if (text.empty()) throw std::runtime_error("AI provider returned empty text.");

    // Strip markdown code fences defensively in case the model adds them.
    size_t fenceStart = text.find("```");
    if (fenceStart != std::string::npos) {
        size_t contentStart = text.find('\n', fenceStart);
        size_t fenceEnd = text.rfind("```");
        if (contentStart != std::string::npos && fenceEnd != std::string::npos && fenceEnd > contentStart) {
            text = text.substr(contentStart + 1, fenceEnd - contentStart - 1);
        }
    }

    json recipeJson = json::parse(text);

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
        "anthropic-claude",
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

    std::string mainIngredient = userIngredients.empty() ? "seasonal vegetables" : userIngredients[0];
    std::string title = preferences.getCuisine() + " Style " + mainIngredient + " " + preferences.getMealType();
    // Capitalize first letter of the title for presentation.
    if (!title.empty()) title[0] = static_cast<char>(std::toupper(title[0]));

    std::vector<Ingredient> ingredients;
    for (const auto& userIng : userIngredients) {
        ingredients.emplace_back(userIng, 1.0 * preferences.getServings() / 2.0, "cup");
    }
    // A handful of generic pantry staples so the recipe reads as complete.
    ingredients.emplace_back("cooking oil", 1.0, "tbsp");
    ingredients.emplace_back("salt", 0.5, "tsp");
    ingredients.emplace_back("black pepper", 0.25, "tsp");
    if (preferences.getDietaryPreference() != "Vegan" && preferences.getDietaryPreference() != "Dairy Free") {
        ingredients.emplace_back("butter", 1.0, "tbsp");
    }

    std::ostringstream ingredientList;
    for (size_t i = 0; i < userIngredients.size(); ++i) {
        ingredientList << userIngredients[i];
        if (i + 2 < userIngredients.size()) ingredientList << ", ";
        else if (i + 2 == userIngredients.size()) ingredientList << " and ";
    }

    std::vector<std::string> instructions = {
        "Prep all ingredients: wash, peel, and chop " + ingredientList.str() + " into even, bite-sized pieces.",
        "Heat the cooking oil in a pan over medium heat until shimmering.",
        "Add the main ingredients and saute for 4-5 minutes, stirring occasionally.",
        "Season with salt and black pepper, then adjust to taste with cuisine-appropriate spices for " + preferences.getCuisine() + " food.",
        "Cover and cook until everything is tender, about " + std::to_string(std::max(5, preferences.getCookingTime() - 10)) + " minutes.",
        "Taste, adjust seasoning, and plate for " + std::to_string(preferences.getServings()) + " serving(s).",
        "Serve hot as a " + preferences.getMealType() + " dish."
    };

    // Deterministic-but-varied calorie estimate so "regenerate" visibly
    // changes numbers even when using the offline fallback.
    std::random_device rd;
    std::mt19937 gen(rd());
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
        title,
        preferences.getCuisine(),
        preferences.getMealType(),
        preferences.getDietaryPreference(),
        ingredients,
        instructions,
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
    if (hasApiKey()) {
        try {
            return callRealProvider(preferences);
        } catch (const std::exception& e) {
            // Never let a provider outage crash the app -- fall through
            // to the local generator and keep serving the user.
            std::cerr << "[AIGenerator] Real provider failed, using fallback: " << e.what() << std::endl;
        }
    }
    return callFallbackProvider(preferences);
}
