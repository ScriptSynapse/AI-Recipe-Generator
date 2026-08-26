#!/usr/bin/env bash
# Compiles and runs all C++ unit tests in this directory.
# Usage: bash tests/run_tests.sh   (run from the project root)
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CORE_SRCS="cpp-core/models/Recipe.cpp cpp-core/models/TraditionalRecipe.cpp cpp-core/models/AIRecipe.cpp cpp-core/models/User.cpp cpp-core/models/RecipePreferences.cpp cpp-core/validation/Validator.cpp cpp-core/engine/RecipeMatcher.cpp cpp-core/engine/RecipeCustomizer.cpp cpp-core/generators/DatabaseGenerator.cpp cpp-core/generators/AIGenerator.cpp cpp-core/storage/RecipeStorage.cpp"

PASS=0
FAIL=0

for t in test_matcher test_generator test_customizer test_storage; do
  echo "=== Building $t ==="
  if g++ -std=c++17 -O2 tests/$t.cpp $CORE_SRCS -lcurl -o /tmp/$t; then
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
