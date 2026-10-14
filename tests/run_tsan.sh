#!/bin/bash
# ThreadSanitizer check for the code that runs providers concurrently
# (AIOrchestrator, ModelComparator, ResponseEventCollector). A data race is
# non-deterministic, so an ordinary test run can pass over one; TSan reports it
# whenever two threads touch the same memory without synchronisation.
#   Usage (from the project root):  bash tests/run_tsan.sh
set -e
CORE_SRCS=$(grep -o 'cpp-core/[A-Za-z/]*\.cpp' tests/run_tests.sh | sort -u | tr '\n' ' ')
OUT=$(mktemp -d)
g++ -std=c++17 -O1 -g -fsanitize=thread -pthread tests/test_model_comparator.cpp $CORE_SRCS -lcurl -o "$OUT/t"
if "$OUT/t" 2>&1 | tee "$OUT/log" | grep -q "WARNING: ThreadSanitizer"; then
  echo "THREAD SANITIZER FOUND A DATA RACE"; grep -A12 "WARNING: ThreadSanitizer" "$OUT/log" | head -40; exit 1
fi
echo "ThreadSanitizer: no data races."
