#ifndef MODEL_COMPARATOR_H
#define MODEL_COMPARATOR_H

#include <memory>
#include <string>
#include <vector>
#include "AIOrchestrator.h"
#include "../evaluation/RecipeEvaluation.h"
#include "../models/RecipePreferences.h"
#include "../security/events/SecurityEventManager.h"

/*
 * ModelComparator -- Phase O (AI Model Lab).
 * -----------------------------------------------------------------------
 * Asks every registered model the SAME question (AIGenerator::buildPrompt),
 * then treats each answer exactly as normal generation would:
 *
 *   raw reply --> AIOutputValidator (closed schema) --> Recipe
 *             --> RecipeEvaluator (ingredients, diet, time, steps,
 *                                  nutrition, safety)  --> scores
 *
 * so what is compared is the quality of VALIDATED recipes, scored by the
 * same rubric, not raw text. Nothing is invented:
 *   - latency is the measured wall-clock time of each provider call;
 *   - a provider with no key is reported as SKIPPED, never faked;
 *   - a reply that fails validation is REJECTED (and reported to the audit
 *     trail); its text is never returned;
 *   - the offline template generator is added as a clearly-labelled
 *     BASELINE (so there is always a reference point, even with no keys),
 *     but it is never named the fastest or best "model".
 *
 * Winners: `fastest` = lowest latency among validated model replies;
 * `best` = highest overall evaluator score among them (ties go to the
 * faster one). Both are empty when no model produced a valid recipe.
 */
enum class ComparedStatus { Success, Failed, Skipped, Rejected, Baseline };
const char* toString(ComparedStatus status);

struct ComparedModel {
    std::string provider;
    std::string model;
    ComparedStatus status = ComparedStatus::Failed;
    long long durationMs = 0;
    std::string error;                 // sanitized; empty on success
    std::string errorKind;             // e.g. "TIMEOUT"; empty unless Failed
    bool hasRecipe = false;
    json recipe;                       // validated recipe JSON (only if hasRecipe)
    RecipeEvaluation evaluation;       // meaningful only if hasRecipe

    json toJson() const;
};

struct ComparisonReport {
    OrchestrationMode mode = OrchestrationMode::CompareAll;
    std::vector<ComparedModel> models;
    std::string fastest;               // provider name, or ""
    std::string best;                  // provider name, or ""
    std::string recommended;           // fastest in FASTEST mode, best in BEST_QUALITY mode, else ""

    json toJson() const;
};

class ModelComparator {
public:
    explicit ModelComparator(AIOrchestrator& orchestrator) : orchestrator(orchestrator) {}

    // `events` is optional and not owned.
    ComparisonReport compare(const RecipePreferences& preferences, OrchestrationMode mode,
                             const std::string& singleProviderName = "",
                             SecurityEventManager* events = nullptr);

    // Pure selection logic, public so it can be tested without any provider.
    static void selectWinners(ComparisonReport& report);

private:
    AIOrchestrator& orchestrator;
};

#endif // MODEL_COMPARATOR_H
