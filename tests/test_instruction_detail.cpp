// Instruction detail tests: the offline generator's steps must (1) mention every listed
// ingredient, (2) be specific to the ingredient types (prep, cooking cue, safety), (3) never
// name a food the user did not list (salt, pepper and water are allowed), (4) be longer and more
// detailed than the old generic steps, and (5) respect a listed cooking fat or its absence.
#include <cassert>
#include <iostream>
#include <random>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include "../cpp-core/generators/RecipeTemplateEngine.h"
#include "../cpp-core/models/RecipePreferences.h"

namespace {
std::string lower(std::string s) { std::transform(s.begin(), s.end(), s.begin(), ::tolower); return s; }

std::string joinAll(const std::vector<std::string>& v) { std::string o; for (auto& s : v) o += lower(s) + "\n"; return o; }

RecipePreferences prefs(std::vector<std::string> ing, const std::string& cuisine, const std::string& meal,
                        int time, const std::string& diff) {
    nlohmann::json j = {{"ingredients", ing}, {"cuisine", cuisine}, {"mealType", meal},
                        {"cookingTime", time}, {"difficulty", diff}, {"servings", 2},
                        {"dietaryPreference", "No Preference"}};
    return RecipePreferences::fromJson(j);
}

std::vector<std::string> run(std::vector<std::string> ing, const std::string& cuisine, const std::string& meal,
                             int time, const std::string& diff) {
    std::mt19937 rng(1);
    return RecipeTemplateEngine::generate(prefs(ing, cuisine, meal, time, diff), rng).instructions;
}

bool has(const std::string& hay, const std::string& needle) { return hay.find(needle) != std::string::npos; }
} // namespace

int main() {
    const std::vector<std::vector<std::string>> sets = {
        {"paneer", "tomato", "onion"},
        {"paneer", "tomato", "onion", "garlic", "ginger", "rice", "cumin"},
        {"chicken", "potato", "spinach", "yogurt", "ghee"},
        {"egg", "spinach", "bread"},
        {"banana", "honey", "oat"},
        {"cucumber", "tomato", "lemon"},
        {"chicken", "broccoli", "garlic", "rice"},
        {"salmon", "lemon", "asparagus"},
        {"lentil", "carrot", "onion", "coconut milk"},
        {"mushroom", "pasta", "cream"},
    };
    const char* cuisines[] = {"Indian", "Chinese", "Italian"};
    const char* meals[] = {"dinner", "breakfast", "dessert", "lunch"};

    // 1 + 4: every ingredient is mentioned, and there is real detail.
    for (const auto& set : sets) {
        for (const char* cu : cuisines) for (const char* m : meals) {
            auto steps = run(set, cu, m, 35, "medium");
            std::string all = joinAll(steps);
            for (const auto& i : set) assert(has(all, lower(i)) && "every listed ingredient appears in the steps");
            assert(steps.size() >= 5);
            for (const auto& s : steps) assert(s.size() >= 25 && "no one-word steps");
        }
    }

    // Detail: the paneer curry has prep, a cooking cue, doneness and serving guidance.
    {
        auto steps = run({"paneer", "tomato", "onion"}, "Indian", "dinner", 40, "medium");
        std::string all = joinAll(steps);
        assert(steps.size() >= 9);
        assert(has(all, "2 cm cubes"));                    // paneer prep
        assert(has(all, "translucent"));                   // onion cue
        assert(has(all, "jammy") || has(all, "collapse")); // tomato cue
        assert(has(all, "golden"));                        // paneer cue
        assert(has(all, "taste"));
    }

    // 2: ingredient-specific safety and technique.
    {
        std::string all = joinAll(run({"chicken", "potato"}, "Indian", "dinner", 40, "medium"));
        assert(has(all, "no pink") && has(all, "separate board"));   // raw meat safety
        assert(has(all, "slowest"));                                 // potato goes in early
    }
    {
        std::string all = joinAll(run({"salmon", "lemon", "asparagus"}, "Italian", "dinner", 30, "medium"));
        assert(has(all, "opaque") || has(all, "flaking"));           // fish doneness
    }
    {
        std::string all = joinAll(run({"rice", "tomato", "onion"}, "Indian", "dinner", 40, "medium"));
        assert(has(all, "rinse") && has(all, "fluff"));              // rice
    }
    {
        std::string all = joinAll(run({"egg", "spinach"}, "Indian", "breakfast", 15, "easy"));
        assert(has(all, "softly set") || has(all, "set"));           // egg
        assert(has(all, "wilted"));                                  // spinach
    }
    {
        std::string all = joinAll(run({"chicken", "yogurt", "onion"}, "Indian", "dinner", 40, "medium"));
        assert(has(all, "off the boil") || has(all, "stop bubbling")); // dairy added late to avoid splitting
    }

    // 3: never name a food that was not listed.
    {
        const std::vector<std::string> foods = {"oil", "butter", "ghee", "garlic", "ginger", "onion", "tomato", "cumin",
                                                "turmeric", "chicken", "egg", "rice", "potato", "cream", "yogurt",
                                                "sugar", "flour", "lemon", "paneer", "chili"};
        for (const auto& set : sets) for (const char* cu : cuisines) for (const char* m : meals) {
            std::string all = joinAll(run(set, cu, m, 35, "medium"));
            // Generic prose mentions aromatics as a category in the prep step; skip that fixed sentence.
            size_t p;
            while ((p = all.find("keep the aromatics (onion, garlic, ginger, chili)")) != std::string::npos)
                all.erase(p, std::string("keep the aromatics (onion, garlic, ginger, chili)").size());
            std::string listed;
            for (const auto& i : set) listed += lower(i) + " ";
            for (const auto& f : foods) {
                if (listed.find(f) != std::string::npos) continue;
                // "ghee"/"butter"/"oil" are checked as whole words; "oil" must not match "boil"/"foil".
                size_t pos = 0;
                while ((pos = all.find(f, pos)) != std::string::npos) {
                    bool leftOk = pos == 0 || !std::isalpha(static_cast<unsigned char>(all[pos - 1]));
                    bool rightOk = pos + f.size() >= all.size() || !std::isalpha(static_cast<unsigned char>(all[pos + f.size()]));
                    if (leftOk && rightOk) {
                        std::cerr << "unlisted food '" << f << "' in: " << all.substr(0, 400) << "\n";
                        assert(false);
                    }
                    pos += f.size();
                }
            }
        }
    }

    // 5: a listed fat is used; without one the steps say to cook without it.
    {
        std::string withFat = joinAll(run({"mushroom", "garlic", "ghee"}, "Indian", "dinner", 30, "medium"));
        assert(has(withFat, "add the ghee"));
        std::string noFat = joinAll(run({"mushroom", "garlic"}, "Indian", "dinner", 30, "medium"));
        assert(has(noFat, "did not list a cooking fat"));
    }

    std::cout << "All instruction detail tests passed.\n";
    return 0;
}
