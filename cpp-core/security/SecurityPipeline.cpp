#include "SecurityPipeline.h"
#include <stdexcept>

void SecurityPipeline::addCheck(std::shared_ptr<SecurityCheck> check) {
    if (!check) throw std::invalid_argument("SecurityPipeline::addCheck requires a non-null check.");
    checks.push_back(std::move(check));
}

std::vector<SecurityCheckResult> SecurityPipeline::run(const SecurityContext& context) const {
    std::vector<SecurityCheckResult> results;
    results.reserve(checks.size());

    for (const auto& check : checks) {
        SecurityCheckResult result = check->check(context);
        result.checkName = check->getName();   // the check itself needn't fill this in consistently
        results.push_back(result);
        if (result.rejected()) break;          // stop the chain -- nothing further to check
    }
    return results;
}

bool SecurityPipeline::allPassed(const std::vector<SecurityCheckResult>& results) {
    for (const auto& r : results) if (r.rejected()) return false;
    return true;
}

const SecurityCheckResult* SecurityPipeline::firstRejection(const std::vector<SecurityCheckResult>& results) {
    for (const auto& r : results) if (r.rejected()) return &r;
    return nullptr;
}

std::vector<std::string> SecurityPipeline::getCheckNames() const {
    std::vector<std::string> names;
    names.reserve(checks.size());
    for (const auto& c : checks) names.push_back(c->getName());
    return names;
}
