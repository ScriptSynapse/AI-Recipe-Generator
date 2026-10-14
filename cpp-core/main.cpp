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
 *           delete | search | health | compare | models
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
#include <stdexcept>

#include "json.hpp"
#include "models/Recipe.h"
#include "models/TraditionalRecipe.h"
#include "models/AIRecipe.h"
#include "models/RecipePreferences.h"
#include "models/RecipeBuilder.h"
#include "evaluation/IngredientConsistencyChecker.h"
#include "models/User.h"
#include "validation/Validator.h"
#include "generators/DatabaseGenerator.h"
#include "generators/AIGenerator.h"
#include "ai/AIOrchestrator.h"
#include "ai/ModelComparator.h"
#include "ai/http/CurlHttpClient.h"
#include "engine/RecipeMatcher.h"
#include "engine/RecipeCustomizer.h"
#include "storage/RecipeStorage.h"
#include "security/SecurityPipeline.h"
#include "security/checks/InputValidatorCheck.h"
#include "security/checks/PromptInjectionDetectorCheck.h"
#include "security/checks/XSSDetectorCheck.h"
#include "security/XSSDetector.h"
#include "security/events/SecurityEventManager.h"
#include "security/events/SecurityEventFactory.h"
#include "security/events/ResponseEventCollector.h"

using json = nlohmann::json;

// Configurable threshold: database matches scoring at/above this value
// are considered "good enough" to serve directly; otherwise the request
// falls through to AIGenerator. Kept as a single named constant so it's
// trivial to point to during a viva.
static const double DATABASE_MATCH_THRESHOLD = 55.0;

// The user asked for recipes built ONLY from the ingredients they list --
// no surprise extras. A database recipe is only eligible to be served
// as-is if (almost) every one of ITS ingredients is something the user
// actually has (see RecipeMatcher::computeIngredientCoverage). Below this
// coverage, the request falls through to AIGenerator instead, which is
// explicitly prompted/templated to use only the given ingredients.
static const double INGREDIENT_COVERAGE_THRESHOLD = 100.0;

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

    // Built through RecipeBuilder, so a malformed recipe coming back from the
    // browser is rejected with a clear ValidationException instead of becoming
    // an object that violates the Recipe invariants.
    std::string source = r.value("source", "");
    RecipeBuilder builder;
    builder.withId(r.value("id", "recipe"))
        .withName(r.value("name", "Recipe"))
        .withCuisine(r.value("cuisine", ""))
        .withMealType(r.value("mealType", ""))
        .withDiet(r.value("dietaryPreference", "No Preference"))
        .withIngredients(ingredients)
        .withInstructions(instructions)
        .withCookingTime(r.value("cookingTime", 30))
        .withDifficulty(r.value("difficulty", "Medium"))
        .withServings(r.value("servings", 2))
        .withNutrition(nutrition);
    if (source.find("AI") != std::string::npos) {
        builder.asAI(r.value("aiProvider", "fallback-mock"), r.value("usedFallback", true));
    } else {
        builder.asTraditional(r.value("matchScore", 0.0));
    }
    if (r.contains("substitutionNotes")) {
        std::vector<std::string> notes;
        for (const auto& note : r["substitutionNotes"]) notes.push_back(note.get<std::string>());
        builder.withSubstitutionNotes(notes);
    }
    return builder.build();
}

static json errorResponse(const std::string& code, const std::string& message) {
    return json{{"success", false}, {"error", {{"code", code}, {"message", message}}}};
}

static json successResponse(const json& data, const std::string& message) {
    return json{{"success", true}, {"data", data}, {"message", message}};
}

// The input security pipeline (Phase H/I/J), shared by every command that
// sends user text toward an LLM (generate, regenerate, compare). Runs the
// registered checks in order, stopping at the first rejection:
// InputValidatorCheck (cheap structural checks), then PromptInjectionDetector
// and XSSDetector, which scan the ingredient text that is about to be
// embedded in the LLM prompt. What the scan found (a block, or a clean pass)
// is reported to the audit trail BEFORE a rejection is thrown, so blocks are
// always recorded. A rejection is re-thrown as the ValidationException the
// rest of main.cpp already turns into a clean API error.
static void runInputSecurity(RecipePreferences& prefs, const std::string& action, SecurityEventManager& events) {
    static SecurityPipeline inputPipeline = [] {
        SecurityPipeline p;
        p.addCheck(std::make_shared<InputValidatorCheck>());
        p.addCheck(std::make_shared<PromptInjectionDetectorCheck>());
        p.addCheck(std::make_shared<XSSDetectorCheck>());
        return p;
    }();
    SecurityContext secContext;
    secContext.preferences = &prefs;
    auto secResults = inputPipeline.run(secContext);
    for (const SecurityEvent& event : SecurityEventFactory::fromPipelineResults(secResults, action)) {
        events.emit(event);
    }
    if (const SecurityCheckResult* rejection = SecurityPipeline::firstRejection(secResults)) {
        throw ValidationException(rejection->code, rejection->reason);
    }
}

static json handleGenerate(const json& body, const std::string& dataDir, bool forceAi, const std::string& excludeId,
                           const std::string& action, SecurityEventManager& events) {
    RecipePreferences prefs = RecipePreferences::fromJson(body.value("preferences", json::object()));

    runInputSecurity(prefs, action, events);

    std::vector<json> database = loadDatabase(dataDir);
    DatabaseGenerator dbGenerator(database);
    AIGenerator aiGenerator;
    aiGenerator.setEventManager(&events);   // provider failures and rejected AI output get reported
    RecipeMatcher matcher(database);

    // Find the best-scoring candidate that ALSO has full ingredient
    // coverage (every one of ITS ingredients is something the user
    // listed, give or take a few universal staples) -- a recipe the
    // user could make from exactly what they have, not just a recipe
    // that happens to use a lot of their ingredients among others.
    auto allMatches = matcher.findMatches(prefs);
    MatchResult best;
    best.score = -1;
    for (const auto& m : allMatches) {
        if (!excludeId.empty() && m.recipeJson.value("id", "") == excludeId) continue;
        if (m.ingredientCoverage < INGREDIENT_COVERAGE_THRESHOLD) continue;
        best = m;
        break; // allMatches is already sorted by score descending
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
        {"threshold", DATABASE_MATCH_THRESHOLD},
        {"ingredientCoverageRequired", INGREDIENT_COVERAGE_THRESHOLD},
        {"strictIngredientsOnly", true}
    };

    // Did the recipe respect what the user asked for? (user-facing "AI SAFETY CHECK")
    json consistency = IngredientConsistencyChecker::check(*recipe, prefs).toJson();

    return successResponse(json{{"recipe", response}, {"matchInfo", matchInfo}, {"consistency", consistency}},
                            usedDatabase ? "Recipe matched from database." : "Recipe generated by AI.");
}

// Recipes the browser sends back (customize, save) are not an LLM input, but
// their text is stored and later shown, so markup in ANY text field is refused.
// Every string anywhere in the payload is scanned (not just the known fields),
// so an extra, unexpected field cannot carry markup past the check. Depth is
// bounded so a deeply nested payload cannot exhaust the stack. The scan is
// reported to the audit trail before the rejection is thrown; the event
// carries pattern CATEGORIES only, never the offending text.
static void collectStrings(const json& value, std::string& out, int depth) {
    if (depth > 8) throw ValidationException("INVALID_RECIPE_SHAPE", "Recipe data is nested too deeply.");
    if (value.is_string()) { out += value.get<std::string>(); out += '\n'; return; }
    if (value.is_array()) { for (const auto& v : value) collectStrings(v, out, depth + 1); return; }
    if (value.is_object()) {
        for (auto it = value.begin(); it != value.end(); ++it) {
            out += it.key(); out += '\n';
            collectStrings(it.value(), out, depth + 1);
        }
    }
}

static void scanRecipePayload(const json& recipe, const std::string& extraText, const std::string& action,
                              SecurityEventManager& events) {
    std::string text;
    collectStrings(recipe, text, 0);
    text += extraText;
    XSSDetectionResult scan = XSSDetector::scan(text);
    if (scan.safe) return;
    SecurityEvent event;
    event.type = SecurityEventType::XssAttempt;
    event.severity = EventSeverity::High;
    event.result = EventResult::Blocked;
    event.action = action;
    event.reason = scan.reason;                 // fixed text from the detector
    event.details = json::object();
    event.details["check"] = "XSSDetector";
    event.details["code"] = "XSS_SUSPECTED";
    event.details["matchedPatterns"] = scan.matchedPatterns;
    events.emit(event);
    throw ValidationException("XSS_SUSPECTED", scan.reason);
}

// AI Model Lab: ask every configured model (or one) the same question and
// compare the validated, evaluated results. Input goes through the same
// security pipeline as generation.
static OrchestrationMode parseCompareMode(const std::string& m) {
    if (m == "all" || m.empty()) return OrchestrationMode::CompareAll;
    if (m == "fastest") return OrchestrationMode::Fastest;
    if (m == "best") return OrchestrationMode::BestQuality;
    if (m == "single") return OrchestrationMode::SingleModel;
    throw ValidationException("INVALID_MODE", "mode must be one of: all, fastest, best, single.");
}

static json handleCompare(const json& body, SecurityEventManager& events) {
    RecipePreferences prefs = RecipePreferences::fromJson(body.value("preferences", json::object()));
    OrchestrationMode mode = parseCompareMode(body.value("mode", std::string("all")));
    std::string provider = body.value("provider", std::string());
    if (mode == OrchestrationMode::SingleModel && provider.empty()) {
        throw ValidationException("INVALID_PROVIDER", "mode 'single' requires a provider.");
    }

    runInputSecurity(prefs, "compare", events);

    AIOrchestrator orchestrator(AIOrchestrator::buildDefaultProviders(std::make_shared<CurlHttpClient>()));
    orchestrator.setEventManager(&events);
    ModelComparator comparator(orchestrator);
    ComparisonReport report;
    try {
        report = comparator.compare(prefs, mode, provider, &events);
    } catch (const std::invalid_argument&) {
        // Unknown provider name: the registered list is not echoed back.
        throw ValidationException("INVALID_PROVIDER", "Unknown provider.");
    }
    return successResponse(json{{"comparison", report.toJson()}}, "Models compared.");
}

// Which models exist and whether each is usable -- names and state only.
static json handleModels() {
    AIOrchestrator orchestrator(AIOrchestrator::buildDefaultProviders(std::make_shared<CurlHttpClient>()));
    json models = json::array();
    for (const auto& info : orchestrator.providerInfo()) {
        models.push_back(json{{"provider", info.name}, {"model", info.model}, {"status", info.status}, {"available", info.available}});
    }
    return successResponse(json{{"models", models}}, "Model list.");
}

static json handleCustomize(const json& body, SecurityEventManager& events) {
    if (!body.contains("recipe")) throw std::invalid_argument("Missing 'recipe' in request body.");
    std::string action = body.value("action", "");
    std::string argument = body.value("argument", "");
    scanRecipePayload(body["recipe"], action + "\n" + argument, "customize", events);
    auto recipe = recipeFromJson(body["recipe"]);

    RecipeCustomizer customizer;
    customizer.modifyRecipe(*recipe, action, argument);

    return successResponse(json{{"recipe", recipe->toJson()}}, "Recipe customized successfully.");
}

static json handleSave(const json& body, const std::string& dataDir, SecurityEventManager& events) {
    if (!body.contains("recipe")) throw std::invalid_argument("Missing 'recipe' in request body.");
    const json& incoming = body["recipe"];
    scanRecipePayload(incoming, "", "save", events);
    RecipeStorage::validateRecord(incoming);     // same shape/size rules as before: object, named, bounded

    // Store the recipe REBUILT from its known fields (RecipeBuilder enforces the
    // Recipe invariants), not the raw browser JSON: unknown or forged extra
    // fields are dropped. ownerId is the Node layer's own stamp, so it is the
    // one extra field carried over (and only if it is text).
    json canonical = recipeFromJson(incoming)->toJson();
    if (!incoming.contains("id")) canonical.erase("id");   // let storage generate one rather than keep a placeholder
    if (incoming.is_object() && incoming.contains("ownerId") && incoming["ownerId"].is_string()) {
        canonical["ownerId"] = incoming["ownerId"];
    }
    RecipeStorage storage(dataDir + "/saved_recipes.json");
    json saved = storage.save(canonical);
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

    // Per-model status (Phase 20 groundwork): every configured provider's
    // OWN state, not just whichever one most recently happened to succeed.
    json providers = json::array();
    for (const auto& entry : aiGenerator.getProviderStatuses()) {
        providers.push_back(json{{"provider", entry.first}, {"status", entry.second}});
    }

    return successResponse(json{
        {"status", "ok"},
        {"databaseRecipeCount", db.size()},
        {"aiApiKeyConfigured", aiGenerator.hasApiKey()},
        {"aiModel", aiGenerator.getModel()},
        {"aiProviders", providers}
    }, "C++ recipe engine is healthy.");
}

// Prints a response, adding the security events collected while handling the
// request. The Node layer records them in the audit log and REMOVES them
// before anything is sent to a client.
static void printResponse(json response, const ResponseEventCollector& collector) {
    if (!collector.empty()) response["securityEvents"] = collector.toJson();
    std::cout << response.dump() << std::endl;
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
        std::cerr << "[engine] input JSON parse error: " << e.what() << std::endl;
        std::cout << errorResponse("INVALID_JSON", "Malformed input JSON.").dump() << std::endl;
        return 1;
    }

    SecurityEventManager eventManager;
    auto collector = std::make_shared<ResponseEventCollector>();
    eventManager.attach(collector);

    try {
        json response;

        if (command == "generate") {
            response = handleGenerate(body, dataDir, false, "", "generate", eventManager);
        } else if (command == "regenerate") {
            std::string excludeId = body.value("previousRecipeId", "");
            response = handleGenerate(body, dataDir, body.value("forceAi", false), excludeId, "regenerate", eventManager);
        } else if (command == "customize") {
            response = handleCustomize(body, eventManager);
        } else if (command == "save") {
            response = handleSave(body, dataDir, eventManager);
        } else if (command == "list") {
            response = handleList(dataDir);
        } else if (command == "get") {
            response = handleGet(body, dataDir);
        } else if (command == "delete") {
            response = handleDelete(body, dataDir);
        } else if (command == "compare") {
            response = handleCompare(body, eventManager);
        } else if (command == "models") {
            response = handleModels();
        } else if (command == "health") {
            response = handleHealth(dataDir);
        } else {
            response = errorResponse("UNKNOWN_COMMAND", "Unknown command: " + command);
        }

        printResponse(response, *collector);
        return response.value("success", false) ? 0 : 2;

    } catch (const ValidationException& e) {
        printResponse(errorResponse(e.getCode(), e.what()), *collector);
        return 2;
    } catch (const StorageException& e) {
        // Detail (may contain filesystem paths) goes to stderr for the
        // server log only; the API client gets a generic message.
        std::cerr << "[engine] storage error: " << e.what() << std::endl;
        printResponse(errorResponse("STORAGE_ERROR", "Recipe storage is temporarily unavailable."), *collector);
        return 2;
    } catch (const std::invalid_argument& e) {
        // Thrown deliberately with user-safe messages (missing fields,
        // InvalidRecipeException, unknown customize action, ...).
        printResponse(errorResponse("INVALID_ARGUMENT", e.what()), *collector);
        return 2;
    } catch (const json::exception& e) {
        // A field had an unexpected type/shape. Library text stays in the log.
        std::cerr << "[engine] malformed request data: " << e.what() << std::endl;
        printResponse(errorResponse("INVALID_ARGUMENT", "Request contained data of an unexpected shape."), *collector);
        return 2;
    } catch (const std::exception& e) {
        std::cerr << "[engine] internal error: " << e.what() << std::endl;
        printResponse(errorResponse("INTERNAL_ERROR", "The recipe engine hit an unexpected error."), *collector);
        return 2;
    }
}
