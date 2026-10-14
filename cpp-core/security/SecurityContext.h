#ifndef SECURITY_CONTEXT_H
#define SECURITY_CONTEXT_H

#include <string>
#include "../models/RecipePreferences.h"

/*
 * SecurityContext -- everything a SecurityCheck might need to examine, for
 * ONE pass through the pipeline. Fields are pointers/optional because
 * different stages of the generation flow populate different subsets:
 *
 *   - Validating an incoming generate request populates `preferences`
 *     only; `rawProviderResponse` is null, so AIOutputValidatorCheck
 *     reports Skipped (nothing to check yet).
 *   - Validating a provider's response (after Phase G's AIOutputValidator
 *     normally runs) populates `rawProviderResponse`; checks that only
 *     examine the request (InputValidatorCheck) simply have nothing new
 *     to say about data they already saw, which is fine -- re-running a
 *     pure function against the same preferences is harmless.
 *
 * This struct is intentionally minimal -- it holds only what the checks
 * built so far (Phase H) actually need. Later phases (prompt injection,
 * XSS, rate limiting, auth) will extend it with whatever new data their
 * checks need (free-text fields to scan, a client IP, a user/session),
 * rather than guessing those requirements now.
 */
struct SecurityContext {
    const RecipePreferences* preferences = nullptr;
    const std::string* rawProviderResponse = nullptr;
};

#endif // SECURITY_CONTEXT_H
