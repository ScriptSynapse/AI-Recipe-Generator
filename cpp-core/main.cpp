/*
 * main.cpp -- AI Recipe Generator C++ OOP Core, CLI entry point.
 * -----------------------------------------------------------------------
 * This binary is invoked by the Node.js/Express backend as a subprocess
 * for every recipe-related operation (see backend/services/cppBridge.js).
 * It reads one JSON command from stdin and writes one JSON response to
 * stdout, keeping the C++ <-> Node.js boundary simple, language-agnostic,
 * and easy to demonstrate step-by-step in a viva.
 *
 * Usage:
 *   ./recipe_engine <command> [dataDir]
 *   stdin: JSON payload for the command
 *   stdout: JSON response
 *
 * Commands: generate | regenerate | customize | save | list | get |
 *           delete | search | health
 *
 * This file is intentionally the "wiring" layer: it owns no business
 * logic itself, only orchestrates the classes in models/, generators/,
 * engine/, storage/, and validation/ -- keeping each concept in its own
 * translation unit as required by the assignment.
 */

#include <iostream>
#include <sstream>
#include <fstream>
#include <memory>
#include <cstdlib>

#include "json.hpp"
#include "models/Recipe.h"
#include "models/TraditionalRecipe.h"
#include "models/AIRecipe.h"
#include "models/RecipePreferences.h"
#include "models/User.h"
#include "validation/Validator.h"
#include "generators/DatabaseGenerator.h"
#include "generators/AIGenerator.h"
#include "engine/RecipeMatcher.h"
#include "engine/RecipeCustomizer.h"
#include "storage/RecipeStorage.h"

using json = nlohmann::json;

// Configurable threshold: database matches scoring at/above this value
// are considered "good enough" to serve directly; otherwise the request
// falls through to AIGenerator. Kept as a single named constant so it's
// trivial to point to during a viva.
static const double DATABASE_MATCH_THRESHOLD = 55.0;

static std::vector<json> loadDatabase(const std::string& dataDir) {
    std::ifstream in(dataDir + "/recipes.json");
    std::vector<json> db;
    if (!in.is_open()) return db;
    try {
        json data;
        in >> data;
        if (data.is_array()) {
            for (const auto& r : data) db.push_back(r);
        }
    } catch (const json::parse_error&) {
        // Corrupted seed database should not crash the whole engine;
        // treat as empty so AIGenerator can still serve requests.
        return {};
    }
    return db;
}

// Reconstructs a concrete Recipe subtype from a serialized JSON blob
// (produced earlier by Recipe::toJson()/subclass toJson()). This is the
// factory the customize/save/list commands use to turn "data coming
// back from the frontend" into a real polymorphic C++ object again.
static std::unique_ptr<Recipe> recipeFromJson(const json& r) {
    std::vector<Ingredient> ingredients;
    if (r.contains("ingredients")) {
        for (const auto& ij : r["ingredients"]) ingredients.push_back(Ingredient::fromJson(ij));
    }
    std::vector<std::string> instructions;
    if (r.contains("instructions")) {
        for (const auto& s : r["instructions"]) instructions.push_back(s.get<std::string>());
    }
    NutritionInfo nutrition;
    if (r.contains("nutrition")) {
        nutrition.calories = r["nutrition"].value("calories", 0.0);
        nutrition.proteinGrams = r["nutrition"].value("proteinGrams", 0.0);
        nutrition.carbsGrams = r["nutrition"].value("carbsGrams", 0.0);
        nutrition.fatGrams = r["nutrition"].value("fatGrams", 0.0);
        nutrition.estimated = r["nutrition"].value("estimated", true);
    }

    std::string source = r.value("source", "");
    std::unique_ptr<Recipe> recipe;

    if (source.find("AI") != std::string::npos) {
        recipe = std::make_unique<AIRecipe>(
            r.value("id", "recipe"), r.value("name", "Recipe"), r.value("cuisine", ""),
            r.value("mealType", ""), r.value("dietaryPreference", "No Preference"),
            ingredients, instructions, r.value("cookingTime", 30), r.value("difficulty", "Medium"),
            r.value("servings", 2), nutrition, r.value("aiProvider", "fallback-mock"),
            r.value("usedFallback", true)
        );
    } else {
        recipe = std::make_unique<TraditionalRecipe>(
            r.value("id", "recipe"), r.value("name", "Recipe"), r.value("cuisine", ""),
            r.value("mealType", ""), r.value("dietaryPreference", "No Preference"),
            ingredients, instructions, r.value("cookingTime", 30), r.value("difficulty", "Medium"),
            r.value("servings", 2), nutrition, r.value("matchScore", 0.0)
        );
    }

    if (r.contains("substitutionNotes")) {
        for (const auto& note : r["substitutionNotes"]) recipe->addSubstitutionNote(note.get<std::string>());
    }
    return recipe;
}

static json errorResponse(const std::string& code, const std::string& message) {
    return json{{"success", false}, {"error", {{"code", code}, {"message", message}}}};
}

static json successResponse(const json& data, const std::string& message) {
    return json{{"success", true}, {"data", data}, {"message", message}};
}

static json handleGenerate(const json& body, const std::string& dataDir, bool forceAi, const std::string& excludeId) {
    RecipePreferences prefs = RecipePreferences::fromJson(body.value("preferences", json::object()));

    // 1. Validate input -- throws ValidationException on failure, caught
    //    by the top-level dispatcher below.
    Validator::validate(prefs);

    std::vector<json> database = loadDatabase(dataDir);
    DatabaseGenerator dbGenerator(database);
    AIGenerator aiGenerator;

    MatchResult best = dbGenerator.bestMatchFor(prefs);

    // On regenerate, skip the recipe we already showed so the user
    // actually sees something different.
    if (!excludeId.empty() && best.recipeJson.value("id", "") == excludeId) {
        RecipeMatcher matcher(database);
        auto all = matcher.findMatches(prefs);
        best.score = -1;
        for (const auto& m : all) {
            if (m.recipeJson.value("id", "") != excludeId) { best = m; break; }
        }
    }

    std::unique_ptr<Recipe> recipe;
    bool usedDatabase = false;

    if (!forceAi && best.score >= DATABASE_MATCH_THRESHOLD) {
        // Use the (possibly exclusion-adjusted) match chosen above rather
        // than letting DatabaseGenerator re-run its own matcher, which
        // would ignore the excludeId and hand back the same recipe.
        recipe = dbGenerator.generateFromMatch(prefs, best);
        usedDatabase = true;
    } else {
        recipe = aiGenerator.generateRecipe(prefs);
    }

    json response = recipe->toJson();
    json matchInfo = {
        {"usedDatabase", usedDatabase},
        {"bestDatabaseScore", best.score < 0 ? 0.0 : best.score},
        {"threshold", DATABASE_MATCH_THRESHOLD}
    };

    return successResponse(json{{"recipe", response}, {"matchInfo", matchInfo}},
                            usedDatabase ? "Recipe matched from database." : "Recipe generated by AI.");
}

static json handleCustomize(const json& body) {
    if (!body.contains("recipe")) throw std::invalid_argument("Missing 'recipe' in request body.");
    auto recipe = recipeFromJson(body["recipe"]);

    RecipeCustomizer customizer;
    std::string action = body.value("action", "");
    std::string argument = body.value("argument", "");
    customizer.modifyRecipe(*recipe, action, argument);

    return successResponse(json{{"recipe", recipe->toJson()}}, "Recipe customized successfully.");
}

static json handleSave(const json& body, const std::string& dataDir) {
    if (!body.contains("recipe")) throw std::invalid_argument("Missing 'recipe' in request body.");
    RecipeStorage storage(dataDir + "/saved_recipes.json");
    json saved = storage.save(body["recipe"]);
    return successResponse(json{{"recipe", saved}}, "Recipe saved successfully.");
}

static json handleList(const std::string& dataDir) {
    RecipeStorage storage(dataDir + "/saved_recipes.json");
    auto recipes = storage.loadRecipes();
    return successResponse(json{{"recipes", recipes}}, "Saved recipes retrieved.");
}

static json handleGet(const json& body, const std::string& dataDir) {
    RecipeStorage storage(dataDir + "/saved_recipes.json");
    std::string id = body.value("id", "");
    json recipe = storage.findById(id);
    if (recipe.empty()) return errorResponse("NOT_FOUND", "No saved recipe with that id.");
    return successResponse(json{{"recipe", recipe}}, "Recipe retrieved.");
}

static json handleDelete(const json& body, const std::string& dataDir) {
    RecipeStorage storage(dataDir + "/saved_recipes.json");
    std::string id = body.value("id", "");
    bool removed = storage.remove(id);
    if (!removed) return errorResponse("NOT_FOUND", "No saved recipe with that id.");
    return successResponse(json{{"id", id}}, "Recipe deleted.");
}

static json handleHealth(const std::string& dataDir) {
    std::vector<json> db = loadDatabase(dataDir);
    AIGenerator aiGenerator;
    return successResponse(json{
        {"status", "ok"},
        {"databaseRecipeCount", db.size()},
        {"aiApiKeyConfigured", aiGenerator.hasApiKey()}
    }, "C++ recipe engine is healthy.");
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cout << errorResponse("MISSING_COMMAND", "No command provided to recipe_engine.").dump() << std::endl;
        return 1;
    }

    std::string command = argv[1];
    std::string dataDir = argc >= 3 ? argv[2] : "data";

    // Read the full JSON payload from stdin.
    std::ostringstream stdinBuffer;
    stdinBuffer << std::cin.rdbuf();
    std::string inputStr = stdinBuffer.str();

    json body = json::object();
    try {
        if (!inputStr.empty()) body = json::parse(inputStr);
    } catch (const json::parse_error& e) {
        std::cout << errorResponse("INVALID_JSON", std::string("Malformed input JSON: ") + e.what()).dump() << std::endl;
        return 1;
    }

    try {
        json response;

        if (command == "generate") {
            response = handleGenerate(body, dataDir, false, "");
        } else if (command == "regenerate") {
            std::string excludeId = body.value("previousRecipeId", "");
            response = handleGenerate(body, dataDir, body.value("forceAi", false), excludeId);
        } else if (command == "customize") {
            response = handleCustomize(body);
        } else if (command == "save") {
            response = handleSave(body, dataDir);
        } else if (command == "list") {
            response = handleList(dataDir);
        } else if (command == "get") {
            response = handleGet(body, dataDir);
        } else if (command == "delete") {
            response = handleDelete(body, dataDir);
        } else if (command == "health") {
            response = handleHealth(dataDir);
        } else {
            response = errorResponse("UNKNOWN_COMMAND", "Unknown command: " + command);
        }

        std::cout << response.dump() << std::endl;
        return response.value("success", false) ? 0 : 2;

    } catch (const ValidationException& e) {
        std::cout << errorResponse(e.getCode(), e.what()).dump() << std::endl;
        return 2;
    } catch (const StorageException& e) {
        std::cout << errorResponse("STORAGE_ERROR", e.what()).dump() << std::endl;
        return 2;
    } catch (const std::invalid_argument& e) {
        std::cout << errorResponse("INVALID_ARGUMENT", e.what()).dump() << std::endl;
        return 2;
    } catch (const std::exception& e) {
        std::cout << errorResponse("INTERNAL_ERROR", e.what()).dump() << std::endl;
        return 2;
    }
}
