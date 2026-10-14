#include "RecipeTemplateEngine.h"
#include <algorithm>
#include <cctype>
#include <sstream>
#include <cmath>

namespace {

std::string toLowerStr(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), ::tolower);
    return out;
}

bool containsAny(const std::string& haystack, std::initializer_list<const char*> needles) {
    for (const char* needle : needles) {
        if (haystack.find(needle) != std::string::npos) return true;
    }
    return false;
}

} // namespace

RecipeTemplateEngine::Category RecipeTemplateEngine::classifyIngredient(const std::string& ingredientLower) {
    // Order matters: check the more specific / compound categories first
    // so e.g. "coconut milk" lands in Liquid rather than Dairy, and
    // "paneer" (a protein source in vegetarian cooking) lands in Protein
    // rather than Dairy even though it's technically a cheese.
    if (containsAny(ingredientLower, {"coconut milk", "sauce", "stock", "broth", "vinegar", "wine",
                                       "juice", "paste", "ketchup", "mayonnaise", "mustard", "salsa",
                                       "tamarind"})) {
        return Category::Liquid;
    }
    if (containsAny(ingredientLower, {"sugar", "chocolate", "honey", "vanilla", "baking powder",
                                       "baking soda", "cocoa", "syrup", "jaggery", "caramel", "icing"})) {
        return Category::Sweet;
    }
    if (containsAny(ingredientLower, {"cheese", "yogurt", "curd", "cream", "butter", "ghee", "milk"})) {
        return Category::Dairy;
    }
    if (containsAny(ingredientLower, {"chicken", "beef", "pork", "mutton", "lamb", "turkey", "fish",
                                       "salmon", "tuna", "shrimp", "prawn", "crab", "egg", "tofu",
                                       "paneer", "tempeh", "seitan", "lentil", "chickpea", "bean",
                                       "chana", "mince", "sausage", "bacon", "ham"})) {
        return Category::Protein;
    }
    if (containsAny(ingredientLower, {"rice", "pasta", "noodle", "bread", "flour", "potato", "quinoa",
                                       "oat", "tortilla", "bun", "roti", "naan", "couscous", "barley",
                                       "cornmeal", "semolina", "vermicelli"})) {
        return Category::Grain;
    }
    if (containsAny(ingredientLower, {"onion", "tomato", "capsicum", "pepper", "carrot", "broccoli",
                                       "spinach", "cabbage", "cucumber", "garlic", "ginger", "mushroom",
                                       "corn", "peas", "zucchini", "eggplant", "brinjal", "cauliflower",
                                       "beet", "kale", "lettuce", "asparagus", "pumpkin", "celery",
                                       "okra", "radish", "leek", "scallion", "chili", "chilli"})) {
        return Category::Vegetable;
    }
    if (containsAny(ingredientLower, {"mango", "banana", "apple", "berry", "strawberry", "blueberry",
                                       "lemon", "lime", "orange", "pineapple", "grape", "peach", "pear",
                                       "melon", "avocado", "coconut", "papaya", "kiwi", "cherry", "fig",
                                       "pomegranate", "raisin", "date"})) {
        return Category::Fruit;
    }
    return Category::Other;
}

RecipeTemplateEngine::Classification RecipeTemplateEngine::classifyAll(const std::vector<std::string>& ingredients) {
    Classification c;
    for (const auto& original : ingredients) {
        switch (classifyIngredient(toLowerStr(original))) {
            case Category::Protein:   c.proteins.push_back(original); break;
            case Category::Dairy:     c.dairy.push_back(original); break;
            case Category::Grain:     c.grains.push_back(original); break;
            case Category::Vegetable: c.vegetables.push_back(original); break;
            case Category::Fruit:     c.fruits.push_back(original); break;
            case Category::Sweet:     c.sweets.push_back(original); break;
            case Category::Liquid:    c.liquids.push_back(original); break;
            case Category::Other:     c.other.push_back(original); break;
        }
    }
    return c;
}

RecipeTemplateEngine::DishMode RecipeTemplateEngine::determineDishMode(const Classification& c,
                                                                        const RecipePreferences& preferences) {
    std::string meal = toLowerStr(preferences.getMealType());
    std::string cuisine = toLowerStr(preferences.getCuisine());
    std::string difficulty = toLowerStr(preferences.getDifficulty());

    bool hasProtein = !c.proteins.empty();
    bool hasGrain = !c.grains.empty();
    bool hasSweet = !c.sweets.empty();
    bool hasLiquid = !c.liquids.empty();
    bool hasRaw = !c.vegetables.empty() || !c.fruits.empty();

    if (meal == "dessert" || (hasSweet && !hasProtein)) return DishMode::Dessert;
    if (meal == "breakfast") return DishMode::Breakfast;

    if (!hasProtein && !hasGrain && hasRaw && preferences.getCookingTime() <= 20 && difficulty == "easy") {
        return DishMode::Salad;
    }
    if ((cuisine == "chinese" || cuisine == "thai" || cuisine == "japanese") && preferences.getCookingTime() <= 40) {
        return DishMode::StirFry;
    }
    if (hasLiquid || cuisine == "indian" || cuisine == "mexican" || cuisine == "mediterranean") {
        return DishMode::Simmer;
    }
    return DishMode::General;
}

std::string RecipeTemplateEngine::joinWithAnd(const std::vector<std::string>& items) {
    if (items.empty()) return "";
    if (items.size() == 1) return items[0];
    if (items.size() == 2) return items[0] + " and " + items[1];
    std::ostringstream out;
    for (size_t i = 0; i < items.size(); ++i) {
        out << items[i];
        if (i + 2 < items.size()) out << ", ";
        else if (i + 2 == items.size()) out << ", and ";
    }
    return out.str();
}

std::string RecipeTemplateEngine::pickOne(const std::vector<std::string>& options, std::mt19937& rng) {
    if (options.empty()) return "";
    std::uniform_int_distribution<size_t> dist(0, options.size() - 1);
    return options[dist(rng)];
}

std::string RecipeTemplateEngine::buildTitle(DishMode mode, const Classification& c, const RecipePreferences& preferences) {
    std::string headline;
    switch (mode) {
        case DishMode::Dessert:
            headline = !c.sweets.empty() ? c.sweets[0] : (!c.fruits.empty() ? c.fruits[0] : (!c.dairy.empty() ? c.dairy[0] : "Sweet Treat"));
            break;
        case DishMode::Breakfast:
            headline = !c.proteins.empty() ? c.proteins[0] : (!c.grains.empty() ? c.grains[0] : "Morning");
            break;
        case DishMode::Salad:
            headline = !c.vegetables.empty() ? c.vegetables[0] : (!c.fruits.empty() ? c.fruits[0] : "Garden");
            break;
        case DishMode::StirFry:
            headline = !c.proteins.empty() ? c.proteins[0] : (!c.vegetables.empty() ? c.vegetables[0] : "Vegetable");
            break;
        case DishMode::Simmer:
            headline = !c.proteins.empty() ? c.proteins[0] : (!c.vegetables.empty() ? c.vegetables[0] : "Garden");
            break;
        default:
            headline = !preferences.getIngredients().empty() ? preferences.getIngredients()[0] : "Kitchen";
            break;
    }
    if (!headline.empty()) headline[0] = static_cast<char>(std::toupper(headline[0]));

    std::string cuisine = preferences.getCuisine();
    std::string dishWord;
    switch (mode) {
        case DishMode::Dessert:  dishWord = "Dessert"; break;
        case DishMode::Breakfast: dishWord = "Breakfast Bowl"; break;
        case DishMode::Salad:    dishWord = "Salad"; break;
        case DishMode::StirFry:  dishWord = "Stir-Fry"; break;
        case DishMode::Simmer:
            if (toLowerStr(cuisine) == "indian" || toLowerStr(cuisine) == "thai") dishWord = "Curry";
            else if (toLowerStr(cuisine) == "mexican") dishWord = "Stew";
            else if (toLowerStr(cuisine) == "mediterranean") dishWord = "Braise";
            else dishWord = "Simmer";
            break;
        default: dishWord = preferences.getMealType(); break;
    }

    return cuisine + " " + headline + " " + dishWord;
}

std::vector<std::string> RecipeTemplateEngine::buildInstructions(DishMode mode, const Classification& c,
                                                                   const RecipePreferences& preferences,
                                                                   std::mt19937& rng) {
    const std::string servingsStr = std::to_string(preferences.getServings());
    const std::string cuisine = preferences.getCuisine();
    const int trimmedTime = std::max(5, preferences.getCookingTime() - 10);

    auto namesOr = [](const std::vector<std::string>& items, const std::string& fallback) {
        return items.empty() ? fallback : joinWithAnd(items);
    };

    std::vector<std::string> allIngredients = preferences.getIngredients();
    std::string allList = joinWithAnd(allIngredients);

    std::vector<std::string> steps;

    switch (mode) {
        case DishMode::Dessert: {
            std::vector<std::string> sweetFruit = c.sweets;
            sweetFruit.insert(sweetFruit.end(), c.fruits.begin(), c.fruits.end());
            std::string sweetAndFruit = namesOr(sweetFruit, "your sweet ingredients");
            steps.push_back("Measure out " + sweetAndFruit + " for your dessert, and prep any other ingredients you're using.");
            if (!c.proteins.empty()) {
                steps.push_back("Whisk " + joinWithAnd(c.proteins) + " together with " + sweetAndFruit + " until smooth and well combined.");
            } else {
                steps.push_back("In a mixing bowl, combine " + sweetAndFruit + " with " + namesOr(c.dairy, "your dairy ingredients") + " until evenly blended.");
            }
            if (!c.grains.empty()) {
                steps.push_back("Gently fold in " + joinWithAnd(c.grains) + " until just incorporated -- avoid overmixing.");
            }
            steps.push_back("Transfer the mixture to a suitable dish and cook it gently (bake, steam, or chill, whichever suits what you're making) for about " + std::to_string(trimmedTime) + " minutes, until set.");
            steps.push_back("Let it cool slightly, then portion into " + servingsStr + " serving(s).");
            steps.push_back("Serve as a " + cuisine + "-style sweet treat made only from what you listed.");
            break;
        }

        case DishMode::Breakfast: {
            steps.push_back("Prep your ingredients: wash and chop " + allList + " as needed.");
            bool hasEggLike = std::any_of(c.proteins.begin(), c.proteins.end(), [](const std::string& p) {
                return toLowerStr(p).find("egg") != std::string::npos;
            });
            if (hasEggLike) {
                steps.push_back("Whisk " + joinWithAnd(c.proteins) + " in a bowl with a pinch of salt and pepper.");
            } else if (!c.proteins.empty()) {
                steps.push_back("Slice or dice " + joinWithAnd(c.proteins) + " into small, quick-cooking pieces.");
            }
            steps.push_back("Heat a lightly oiled or non-stick pan over medium heat.");
            if (!c.vegetables.empty()) {
                steps.push_back("Add " + joinWithAnd(c.vegetables) + " and cook for 2-3 minutes until just softened.");
            }
            std::string mainCook = !c.proteins.empty() ? joinWithAnd(c.proteins) : namesOr(c.grains, "your remaining ingredients");
            steps.push_back("Add " + mainCook + " and cook, stirring gently, until cooked through, about 4-6 minutes.");
            steps.push_back("Season with salt and pepper to taste, then plate warm for " + servingsStr + " serving(s) as a quick " + cuisine + "-style breakfast.");
            break;
        }

        case DishMode::Salad: {
            std::vector<std::string> produceList = c.vegetables;
            produceList.insert(produceList.end(), c.fruits.begin(), c.fruits.end());
            std::string produce = namesOr(produceList, "your vegetables and fruit");
            steps.push_back("Wash and prep " + produce + ", cutting everything into bite-sized pieces.");
            steps.push_back("Combine " + produce + " in a large bowl.");
            std::string acid;
            for (const auto& fruit : c.fruits) {
                std::string lower = toLowerStr(fruit);
                if (lower.find("lemon") != std::string::npos || lower.find("lime") != std::string::npos) { acid = fruit; break; }
            }
            if (!acid.empty()) {
                steps.push_back("Squeeze the " + acid + " over the top, season with salt and pepper, and toss to coat evenly.");
            } else {
                steps.push_back("Season lightly with salt and pepper, tossing to coat evenly.");
            }
            steps.push_back("Chill for a few minutes if you have time, then toss again just before serving.");
            steps.push_back("Serve fresh as a light " + cuisine + "-style salad for " + servingsStr + " serving(s), made only from what you listed.");
            break;
        }

        case DishMode::StirFry: {
            steps.push_back("Prep all ingredients: slice " + namesOr(c.proteins, "your protein") + " and chop " + namesOr(c.vegetables, "your vegetables") + " into similar-sized, quick-cooking pieces.");
            steps.push_back("Heat a wok or wide pan over high heat until very hot.");
            if (!c.proteins.empty()) {
                steps.push_back("Add " + joinWithAnd(c.proteins) + " and stir-fry for 2-3 minutes until sealed on the outside.");
            }
            if (!c.vegetables.empty()) {
                steps.push_back("Add " + joinWithAnd(c.vegetables) + " and stir-fry for another 2-3 minutes, keeping everything moving so it cooks quickly rather than stews.");
            }
            if (!c.grains.empty() || !c.liquids.empty()) {
                std::vector<std::string> finishers = c.grains;
                finishers.insert(finishers.end(), c.liquids.begin(), c.liquids.end());
                steps.push_back("Add " + joinWithAnd(finishers) + " and toss everything together over high heat for 1-2 minutes.");
            }
            steps.push_back("Season with salt, pepper, and a splash of water as needed for a " + cuisine + "-style finish.");
            steps.push_back("Serve immediately while hot, for " + servingsStr + " serving(s).");
            break;
        }

        case DishMode::Simmer: {
            std::string prepLine = "Prep your ingredients: chop " + namesOr(c.vegetables, "your vegetables");
            if (!c.proteins.empty()) prepLine += " and cut " + joinWithAnd(c.proteins) + " into bite-sized pieces";
            prepLine += ".";
            steps.push_back(prepLine);
            steps.push_back("Heat a pan or pot over medium heat (dry, or with a splash of water if needed).");
            if (!c.vegetables.empty()) {
                steps.push_back("Cook " + joinWithAnd(c.vegetables) + " for 3-4 minutes until they begin to soften.");
            }
            if (!c.proteins.empty()) {
                steps.push_back("Add " + joinWithAnd(c.proteins) + " and cook until sealed on all sides.");
            }
            if (!c.liquids.empty()) {
                steps.push_back("Pour in " + joinWithAnd(c.liquids) + " and bring to a gentle simmer.");
            } else {
                steps.push_back("Add a splash of water and bring to a gentle simmer.");
            }
            steps.push_back("Cover and simmer until everything is tender and cooked through, about " + std::to_string(trimmedTime) + " minutes.");
            std::string serveWith = !c.grains.empty() ? "over " + joinWithAnd(c.grains) : "as is";
            steps.push_back("Season with salt and pepper to taste, then serve hot " + serveWith + " for " + servingsStr + " serving(s), " + cuisine + "-style.");
            break;
        }

        default: {
            steps.push_back("Prep your ingredients: wash, peel, and chop " + allList + " into even, bite-sized pieces.");
            steps.push_back("Heat a pan over medium heat (a dry non-stick pan works, or use a splash of water to prevent sticking if needed).");
            steps.push_back("Add " + allList + " and cook for 4-5 minutes, stirring occasionally.");
            steps.push_back("Season with salt, pepper, and water as needed, adjusting for a " + cuisine + " flavor profile using only what you have.");
            steps.push_back("Cover and cook until everything is tender, about " + std::to_string(trimmedTime) + " minutes.");
            steps.push_back("Taste, adjust seasoning, and plate for " + servingsStr + " serving(s).");
            steps.push_back("Serve hot as a " + preferences.getMealType() + " dish, made only from what you listed.");
            break;
        }
    }

    (void)pickOne; // reserved for future phrasing-variant expansion
    (void)rng;
    return steps;
}

RecipeTemplateEngine::GeneratedContent RecipeTemplateEngine::generate(const RecipePreferences& preferences, std::mt19937& rng) {
    Classification c = classifyAll(preferences.getIngredients());
    DishMode mode = determineDishMode(c, preferences);

    GeneratedContent result;
    result.title = buildTitle(mode, c, preferences);
    result.instructions = buildInstructions(mode, c, preferences, rng);
    return result;
}
