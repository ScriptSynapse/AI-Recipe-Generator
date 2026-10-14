#ifndef MODEL_RESULT_H
#define MODEL_RESULT_H

#include <string>
#include "LLMProvider.h"

/*
 * ModelResult -- the outcome of one provider being asked to generate
 * text, as recorded by AIOrchestrator. Reused later by RecipeEvaluator
 * (Phase F, to score `text` once it's parsed into a recipe) and the
 * model-benchmarking engine (Phase 16, to persist `durationMs`).
 *
 * Every field is measured/observed, never fabricated: `durationMs` is a
 * real wall-clock measurement and `success` reflects what actually
 * happened, so this struct can back real benchmarks and dashboards
 * without hard-coding numbers.
 */
struct ModelResult {
    std::string providerName;
    std::string modelName;
    bool success = false;
    bool skipped = false;      // true if the provider was unavailable and never called
    std::string text;          // raw provider text; empty unless success
    std::string errorMessage;  // sanitized (no keys, no raw HTTP bodies); empty unless !success
    LLMErrorKind errorKind = LLMErrorKind::Unavailable;   // meaningful only if !success && !skipped
    long long durationMs = 0;  // 0 for skipped providers
};

#endif // MODEL_RESULT_H
