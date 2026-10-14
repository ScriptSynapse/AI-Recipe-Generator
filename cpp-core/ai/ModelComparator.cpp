#include "ModelComparator.h"
#include "../generators/AIGenerator.h"
#include "../evaluation/RecipeEvaluator.h"
#include "../validation/AIOutputValidator.h"
#include "../security/events/SecurityEventFactory.h"
#include <chrono>

const char* toString(ComparedStatus status) {
    switch (status) {
        case ComparedStatus::Success:  return "SUCCESS";
        case ComparedStatus::Failed:   return "FAILED";
        case ComparedStatus::Skipped:  return "SKIPPED";
        case ComparedStatus::Rejected: return "REJECTED";
        case ComparedStatus::Baseline: return "BASELINE";
    }
    return "FAILED";
}

json ComparedModel::toJson() const {
    json j = {
        {"provider", provider}, {"model", model}, {"status", toString(status)},
        {"durationMs", durationMs}, {"isBaseline", status == ComparedStatus::Baseline},
    };
    if (!error.empty()) j["error"] = error;
    if (!errorKind.empty()) j["errorKind"] = errorKind;
    if (hasRecipe) {
        j["recipe"] = recipe;
        j["evaluation"] = evaluation.toJson();
    }
    return j;
}

json ComparisonReport::toJson() const {
    json array = json::array();
    for (const auto& m : models) array.push_back(m.toJson());
    return json{
        {"mode", toString(mode)}, {"models", array},
        {"fastest", fastest.empty() ? json(nullptr) : json(fastest)},
        {"best", best.empty() ? json(nullptr) : json(best)},
        {"recommended", recommended.empty() ? json(nullptr) : json(recommended)},
    };
}

void ModelComparator::selectWinners(ComparisonReport& report) {
    const ComparedModel* fastest = nullptr;
    const ComparedModel* best = nullptr;
    for (const auto& m : report.models) {
        if (m.status != ComparedStatus::Success || !m.hasRecipe) continue;   // baseline & failures never win
        if (!fastest || m.durationMs < fastest->durationMs) fastest = &m;
        if (!best || m.evaluation.overallScore > best->evaluation.overallScore ||
            (m.evaluation.overallScore == best->evaluation.overallScore && m.durationMs < best->durationMs)) {
            best = &m;
        }
    }
    report.fastest = fastest ? fastest->provider : "";
    report.best = best ? best->provider : "";
    report.recommended = report.mode == OrchestrationMode::Fastest ? report.fastest
                       : report.mode == OrchestrationMode::BestQuality ? report.best : "";
}

ComparisonReport ModelComparator::compare(const RecipePreferences& preferences, OrchestrationMode mode,
                                          const std::string& singleProviderName, SecurityEventManager* events) {
    ComparisonReport report;
    report.mode = mode;

    const std::string prompt = AIGenerator::buildPrompt(preferences);
    for (const ModelResult& r : orchestrator.run(mode, prompt, singleProviderName)) {
        ComparedModel m;
        m.provider = r.providerName;
        m.model = r.modelName;
        m.durationMs = r.durationMs;

        if (r.skipped) {
            m.status = ComparedStatus::Skipped;
            m.error = r.errorMessage;
        } else if (!r.success) {
            m.status = ComparedStatus::Failed;
            m.error = r.errorMessage;
            m.errorKind = SecurityEventFactory::kindName(r.errorKind);
        } else {
            try {
                std::unique_ptr<Recipe> recipe = AIGenerator::parseRecipeResponse(r.text, preferences, r.providerName);
                m.recipe = recipe->toJson();
                m.evaluation = RecipeEvaluator::evaluate(*recipe, preferences);
                m.hasRecipe = true;
                m.status = ComparedStatus::Success;
            } catch (const AIOutputValidationException& e) {
                m.status = ComparedStatus::Rejected;
                m.error = "The model's reply did not pass output validation.";   // never the reply itself
                if (events) events->emit(SecurityEventFactory::aiOutputRejected(r.providerName, e.getIssues()));
            } catch (const std::exception&) {
                m.status = ComparedStatus::Rejected;
                m.error = "The model's reply could not be read as a recipe.";
            }
        }
        report.models.push_back(std::move(m));
    }

    if (mode != OrchestrationMode::SingleModel) {
        // Reference point: the offline template generator, timed like any other.
        ComparedModel baseline;
        baseline.provider = "offline-template";
        baseline.model = "built-in templates";
        baseline.status = ComparedStatus::Baseline;
        auto start = std::chrono::steady_clock::now();
        std::unique_ptr<Recipe> recipe = AIGenerator::callFallbackProvider(preferences);
        baseline.durationMs = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count();
        baseline.recipe = recipe->toJson();
        baseline.evaluation = RecipeEvaluator::evaluate(*recipe, preferences);
        baseline.hasRecipe = true;
        report.models.push_back(std::move(baseline));
    }

    selectWinners(report);
    return report;
}
