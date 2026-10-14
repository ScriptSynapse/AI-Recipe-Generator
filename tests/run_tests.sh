#!/usr/bin/env bash
# Compiles and runs all C++ unit tests in this directory.
# Usage: bash tests/run_tests.sh   (run from the project root)
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CORE_SRCS="cpp-core/models/Recipe.cpp cpp-core/models/TraditionalRecipe.cpp cpp-core/models/AIRecipe.cpp cpp-core/models/User.cpp cpp-core/models/RecipePreferences.cpp cpp-core/models/RecipeBuilder.cpp cpp-core/validation/Validator.cpp cpp-core/engine/RecipeMatcher.cpp cpp-core/engine/RecipeCustomizer.cpp cpp-core/generators/DatabaseGenerator.cpp cpp-core/generators/AIGenerator.cpp cpp-core/generators/RecipeTemplateEngine.cpp cpp-core/storage/RecipeStorage.cpp cpp-core/ai/http/CurlHttpClient.cpp cpp-core/ai/HttpLLMProvider.cpp cpp-core/ai/LLMProviderFactory.cpp cpp-core/ai/providers/ClaudeProvider.cpp cpp-core/ai/providers/GeminiProvider.cpp cpp-core/ai/providers/OpenAIProvider.cpp cpp-core/ai/providers/GroqProvider.cpp cpp-core/ai/providers/LocalProvider.cpp cpp-core/ai/ModelRouter.cpp cpp-core/ai/AIOrchestrator.cpp cpp-core/ai/ModelComparator.cpp cpp-core/evaluation/RecipeEvaluator.cpp cpp-core/evaluation/IngredientConsistencyChecker.cpp cpp-core/validation/AIOutputValidator.cpp cpp-core/security/SecurityPipeline.cpp cpp-core/security/checks/InputValidatorCheck.cpp cpp-core/security/checks/AIOutputValidatorCheck.cpp cpp-core/security/PromptSecurityScanner.cpp cpp-core/security/checks/PromptInjectionDetectorCheck.cpp cpp-core/security/XSSDetector.cpp cpp-core/security/checks/XSSDetectorCheck.cpp cpp-core/security/events/SecurityEventFactory.cpp"

PASS=0
FAIL=0

for t in test_matcher test_generator test_customizer test_storage test_storage_hardening test_llm_provider test_llm_providers_concrete test_model_router test_ai_orchestrator test_recipe_evaluator test_ai_output_validator test_security_pipeline test_prompt_security_scanner test_xss_detector test_security_events test_model_comparator test_recipe_builder test_ingredient_consistency; do
  echo "=== Building $t ==="
  if g++ -std=c++17 -O2 tests/$t.cpp $CORE_SRCS -pthread -lcurl -o /tmp/$t; then
    echo "=== Running $t ==="
    if (cd /tmp && ./$t); then
      PASS=$((PASS+1))
    else
      FAIL=$((FAIL+1))
      echo "FAILED: $t"
    fi
  else
    FAIL=$((FAIL+1))
    echo "BUILD FAILED: $t"
  fi
  echo ""
done

echo "----------------------------------------"
echo "Test suites passed: $PASS, failed: $FAIL"
[ "$FAIL" -eq 0 ]
