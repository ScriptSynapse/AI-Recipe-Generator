#ifndef SCORING_UTIL_H
#define SCORING_UTIL_H

#include <algorithm>

/*
 * ScoringUtil -- small, shared scoring formulas.
 * -----------------------------------------------------------------------
 * Extracted from RecipeMatcher so that "how much do we penalize going
 * over the requested cooking time" means exactly the same thing
 * everywhere it's checked -- RecipeMatcher (scoring curated database
 * recipes) and RecipeEvaluator (scoring AI-generated recipes) both call
 * this, instead of two copies of the same formula quietly drifting apart
 * over time.
 */
namespace ScoringUtil {

// 100 if the recipe is within budget; otherwise a linear penalty
// proportional to how far over budget it is, floored at 0.
inline double cookingTimeComplianceScore(int requestedMinutes, int actualMinutes) {
    if (actualMinutes <= requestedMinutes) return 100.0;
    int over = actualMinutes - requestedMinutes;
    double penalty = (static_cast<double>(over) / std::max(requestedMinutes, 1)) * 100.0;
    return std::max(0.0, 100.0 - penalty);
}

} // namespace ScoringUtil

#endif // SCORING_UTIL_H
