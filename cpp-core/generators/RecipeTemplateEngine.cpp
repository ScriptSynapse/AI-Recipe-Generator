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

namespace {

// ---- ingredient-aware helpers for the instruction builder ----------------------------
// Everything below only ever talks about the ingredients the user listed, plus salt, pepper
// and water (the pantry staples the rest of the system allows).

std::string joinAnd(const std::vector<std::string>& items) {
    if (items.empty()) return "";
    if (items.size() == 1) return items[0];
    if (items.size() == 2) return items[0] + " and " + items[1];
    std::string out;
    for (size_t i = 0; i < items.size(); ++i) {
        out += items[i];
        if (i + 2 < items.size()) out += ", ";
        else if (i + 2 == items.size()) out += ", and ";
    }
    return out;
}

bool isAny(const std::string& name, std::initializer_list<const char*> keys) {
    return containsAny(toLowerStr(name), keys);
}

bool isAromatic(const std::string& n)  { return isAny(n, {"onion", "leek", "scallion", "celery", "chili", "chilli", "shallot"}); }
bool isPungent(const std::string& n)   { return isAny(n, {"garlic", "ginger"}); }
bool isTomato(const std::string& n)    { return isAny(n, {"tomato"}); }
bool isLeafy(const std::string& n)     { return isAny(n, {"spinach", "kale", "lettuce", "cabbage", "asparagus"}); }
bool isMeat(const std::string& n)      { return isAny(n, {"chicken", "beef", "pork", "mutton", "lamb", "turkey", "mince", "sausage", "bacon", "ham"}); }
bool isDelicate(const std::string& n)  { return isAny(n, {"fish", "salmon", "tuna", "shrimp", "prawn", "crab"}); }
bool isEgg(const std::string& n)       { return isAny(n, {"egg"}); }
bool isSoftProtein(const std::string& n) { return isAny(n, {"paneer", "tofu", "tempeh", "seitan"}); }
bool isLegume(const std::string& n)    { return isAny(n, {"lentil", "chickpea", "bean", "chana"}); }
bool isPotato(const std::string& n)    { return isAny(n, {"potato"}); }
bool isBread(const std::string& n)     { return isAny(n, {"bread", "roti", "naan", "tortilla", "bun"}); }
bool isFat(const std::string& n)       { return isAny(n, {"oil", "ghee", "butter"}); }
bool isSpice(const std::string& n) {
    return isAny(n, {"masala", "powder", "cumin", "turmeric", "coriander", "cardamom", "cinnamon", "clove",
                     "paprika", "oregano", "thyme", "rosemary", "herb", "seed", "spice", "curry", "saffron",
                     "garam", "basil", "parsley", "cilantro", "mint", "flake", "peppercorn", "nutmeg"});
}

std::string prepVerb(const std::string& n) {
    std::string l = toLowerStr(n);
    if (containsAny(l, {"onion", "shallot"}))           return "peel and finely dice";
    if (containsAny(l, {"garlic"}))                      return "peel and mince";
    if (containsAny(l, {"ginger"}))                      return "peel and grate or mince";
    if (containsAny(l, {"chili", "chilli"}))             return "slice the {} thinly (remove the seeds for less heat)";
    if (containsAny(l, {"tomato"}))                      return "chop the {} roughly";
    if (containsAny(l, {"potato"}))                      return "scrub and peel the {}, then cut it into 2 cm cubes";
    if (containsAny(l, {"carrot", "beet", "radish"}))    return "peel the {} and slice into thin rounds";
    if (containsAny(l, {"capsicum", "pepper", "zucchini", "eggplant", "brinjal", "pumpkin", "cauliflower", "broccoli"}))
                                                          return "wash and cut into bite-sized pieces";
    if (containsAny(l, {"spinach", "kale", "lettuce", "cabbage"})) return "wash well, drain and roughly chop";
    if (containsAny(l, {"mushroom"}))                    return "wipe clean and slice";
    if (containsAny(l, {"peas", "corn"}))                return "measure out the {} (thaw first if frozen)";
    if (containsAny(l, {"paneer", "tofu", "tempeh"}))   return "pat the {} dry and cut into 2 cm cubes";
    if (isMeat(l))                                       return "trim the {} and cut into bite-sized pieces of even size";
    if (isDelicate(l))                                   return "pat the {} dry and cut into large chunks";
    if (isLegume(l))                                     return "drain and rinse the {} (canned; dried ones need soaking and boiling beforehand)";
    if (containsAny(l, {"rice", "quinoa", "couscous", "barley"})) return "rinse the {} under cold water until it runs clear";
    if (containsAny(l, {"apple", "pear", "mango", "peach", "papaya", "pineapple", "melon", "avocado"})) return "wash, peel and cut the {} into small pieces";
    if (containsAny(l, {"lemon", "lime", "orange"}))     return "wash the {} and cut into wedges";
    if (containsAny(l, {"banana"}))                      return "peel and slice";
    if (containsAny(l, {"berry", "strawberry", "blueberry", "grape", "cherry"})) return "rinse the {} gently and pat dry";
    return "wash and chop";
}

std::string applyPrep(const std::string& item) {
    std::string pattern = prepVerb(item);
    size_t pos = pattern.find("{}");
    if (pos == std::string::npos) return pattern + " the " + item;
    return pattern.replace(pos, 2, item);
}

std::string prepList(const std::vector<std::string>& items) {
    std::vector<std::string> parts;
    for (const auto& i : items) parts.push_back(applyPrep(i));
    return joinAnd(parts);
}

std::vector<std::string> pick(const std::vector<std::string>& items, bool (*pred)(const std::string&), bool want = true) {
    std::vector<std::string> out;
    for (const auto& i : items) if (pred(i) == want) out.push_back(i);
    return out;
}

// How to cook the grain/starch items that are not potatoes.
std::string grainCooking(const std::vector<std::string>& grains) {
    std::vector<std::string> bread, rice, pasta, other;
    for (const auto& g : grains) {
        std::string l = toLowerStr(g);
        if (isPotato(l)) continue;
        if (isBread(l)) bread.push_back(g);
        else if (containsAny(l, {"rice", "quinoa", "couscous", "barley"})) rice.push_back(g);
        else if (containsAny(l, {"pasta", "noodle", "vermicelli"})) pasta.push_back(g);
        else other.push_back(g);
    }
    std::string out;
    auto add = [&](const std::string& t) { if (!out.empty()) out += " "; out += t; };
    if (!rice.empty())  add("Cook the " + joinAnd(rice) + " in about twice its volume of lightly salted water: bring to a boil, cover, reduce to the lowest heat and cook for 12-15 minutes, then rest it covered for 5 minutes and fluff with a fork.");
    if (!pasta.empty()) add("Boil the " + joinAnd(pasta) + " in plenty of well-salted water until just tender (check the packet, usually 8-10 minutes), reserve a few spoonfuls of the cooking water, then drain.");
    if (!bread.empty()) add("Warm the " + joinAnd(bread) + " in a dry pan for about 30 seconds per side so it is soft and lightly toasted.");
    if (!other.empty()) add("Cook the " + joinAnd(other) + " with enough water to reach a soft, spoonable texture, stirring often so it does not clump.");
    return out;
}

} // namespace

std::vector<std::string> RecipeTemplateEngine::buildInstructions(DishMode mode, const Classification& c,
                                                                   const RecipePreferences& preferences,
                                                                   std::mt19937& rng) {
    const std::string servingsStr = std::to_string(preferences.getServings());
    const std::string cuisine = preferences.getCuisine();
    const int totalTime = preferences.getCookingTime();
    const int simmerTime = std::max(5, totalTime - 10);
    const bool hard = toLowerStr(preferences.getDifficulty()) == "hard";

    const std::vector<std::string> all = preferences.getIngredients();
    const std::string allList = joinWithAnd(all);

    // Cooking fat: only if the user actually listed one.
    std::string fat;
    for (const auto& i : all) if (isFat(i)) { fat = i; break; }
    auto heatStep = [&](const std::string& vessel, const std::string& heat) {
        if (!fat.empty()) {
            std::string l = toLowerStr(fat);
            return "Set " + vessel + " over " + heat + " heat and add the " + fat +
                   (l.find("oil") != std::string::npos ? "; wait until it shimmers (about 1 minute)." : "; let it melt and foam, then settle.");
        }
        return "Set " + vessel + " over " + heat + " heat for about 1 minute. You did not list a cooking fat, so cook without one and add a splash of water (1-2 tablespoons) whenever food begins to stick.";
    };

    // Split the list once, ignoring fats, which are used as cooking fat rather than as food.
    auto noFat = [&](const std::vector<std::string>& v) { return pick(v, isFat, false); };
    std::vector<std::string> veg = c.vegetables;
    std::vector<std::string> aromatics = pick(veg, isAromatic);
    std::vector<std::string> pungent = pick(veg, isPungent);
    std::vector<std::string> tomatoes = pick(veg, isTomato);
    std::vector<std::string> leafy = pick(veg, isLeafy);
    std::vector<std::string> bodyVeg;
    for (const auto& v : veg)
        if (!isAromatic(v) && !isPungent(v) && !isTomato(v) && !isLeafy(v)) bodyVeg.push_back(v);
    std::vector<std::string> potatoes = pick(c.grains, isPotato);
    bodyVeg.insert(bodyVeg.begin(), potatoes.begin(), potatoes.end());   // firmest items first
    const std::string grainStep = grainCooking(c.grains);

    std::vector<std::string> meats = pick(c.proteins, isMeat);
    std::vector<std::string> softs = pick(c.proteins, isSoftProtein);
    std::vector<std::string> delicates = pick(c.proteins, isDelicate);
    std::vector<std::string> eggs = pick(c.proteins, isEgg);
    std::vector<std::string> legumes = pick(c.proteins, isLegume);
    std::vector<std::string> dairy = noFat(c.dairy);
    std::vector<std::string> spices, otherFood;
    for (const auto& o : noFat(c.other)) (isSpice(o) ? spices : otherFood).push_back(o);
    std::vector<std::string> liquids = c.liquids;

    std::vector<std::string> steps;

    // Shared prep steps (grouped so each is a single sitting at the cutting board).
    auto prepSteps = [&]() {
        std::vector<std::string> prep;
        std::vector<std::string> produce = veg;
        produce.insert(produce.end(), potatoes.begin(), potatoes.end());
        produce.insert(produce.end(), c.fruits.begin(), c.fruits.end());
        if (!produce.empty())
            prep.push_back("Start with the vegetables. On a clean board, " + prepList(produce) +
                           ". Keep each cut a similar size so the pieces cook at the same speed, and keep the aromatics (onion, garlic, ginger, chili) in a separate pile from the rest.");
        std::vector<std::string> prot = c.proteins;
        if (!prot.empty()) {
            std::string extra = (!meats.empty() || !delicates.empty())
                ? " Use a separate board and wash your hands afterwards, since raw meat and fish can spread bacteria."
                : "";
            std::vector<std::string> parts;
            for (const auto& p : prot) parts.push_back(isEgg(p) ? "crack the " + p + " into a bowl" : applyPrep(p));
            prep.push_back("Prepare the protein: " + joinAnd(parts) + ". Season lightly with salt and pepper." + extra);
        }
        std::vector<std::string> rinse;
        for (const auto& g : c.grains) if (!isPotato(g) && !isBread(g) && isAny(g, {"rice", "quinoa", "couscous", "barley"})) rinse.push_back(g);
        if (!rinse.empty()) prep.push_back("Rinse the " + joinAnd(rinse) + " in a sieve under cold water until the water runs clear, then drain.");
        return prep;
    };
    auto aromaticSteps = [&](std::vector<std::string>& out) {
        if (!aromatics.empty())
            out.push_back("Add the " + joinAnd(aromatics) + " and cook, stirring, until soft and translucent with the edges just turning golden, about 4-5 minutes.");
        if (!pungent.empty())
            out.push_back("Stir in the " + joinAnd(pungent) + " and cook for only 30-60 seconds, until fragrant. Do not let it brown, which turns it bitter.");
    };
    auto spiceStep = [&](std::vector<std::string>& out) {
        if (!spices.empty())
            out.push_back("Add the " + joinAnd(spices) + " and stir for 20-30 seconds, just until the aroma rises. If it sticks, add a spoonful of water.");
    };
    auto proteinSear = [&](std::vector<std::string>& out) {
        if (!meats.empty())
            out.push_back("Add the " + joinAnd(meats) + " in a single layer without crowding, and brown for 4-5 minutes, turning occasionally, until no longer pink on the outside.");
        if (!softs.empty())
            out.push_back("Add the " + joinAnd(softs) + " and let each side sit for 2-3 minutes until golden, turning gently so the pieces stay whole.");
    };
    auto finishFoods = [&](std::vector<std::string>& out) {
        if (!dairy.empty())
            out.push_back("Turn the heat to low and let the pan stop bubbling, then stir in the " + joinAnd(dairy) + ". Adding it off the boil keeps it smooth instead of splitting.");
        if (!otherFood.empty())
            out.push_back("Stir in the " + joinAnd(otherFood) + " and warm everything through for 1-2 minutes.");
        if (!c.fruits.empty() && mode != DishMode::Dessert && mode != DishMode::Salad)
            out.push_back("Fold in the " + joinAnd(c.fruits) + " at the very end so it keeps its shape and freshness.");
    };

    switch (mode) {
        case DishMode::Dessert: {
            std::vector<std::string> sweetFruit = c.sweets;
            sweetFruit.insert(sweetFruit.end(), c.fruits.begin(), c.fruits.end());
            std::string sweetAndFruit = sweetFruit.empty() ? "your sweet ingredients" : joinWithAnd(sweetFruit);
            std::vector<std::string> fruitOnly = c.fruits;
            steps.push_back("Set everything out before you start: measure " + allList + ". Desserts are unforgiving, so work with exact amounts and bring cold ingredients to room temperature for about 10 minutes.");
            if (!fruitOnly.empty()) steps.push_back("Prepare the fruit: " + prepList(fruitOnly) + ". Mash half of it with a fork for flavor and keep the rest in pieces for texture.");
            if (!eggs.empty() || !c.proteins.empty()) {
                steps.push_back("In a large bowl, whisk the " + joinWithAnd(c.proteins) + " with the " + joinWithAnd(c.sweets.empty() ? sweetFruit : c.sweets) + " for 2-3 minutes until pale, thick and smooth, with no grains of sweetener left at the bottom.");
            } else {
                steps.push_back("In a mixing bowl, stir " + sweetAndFruit + " with " + (dairy.empty() ? std::string("a few spoonfuls of water") : joinWithAnd(dairy)) + " until evenly blended and smooth.");
            }
            if (!c.grains.empty()) steps.push_back("Sift or sprinkle in the " + joinWithAnd(c.grains) + " a little at a time, folding with a spatula until no dry streaks remain. Stop as soon as it comes together, because overmixing makes it tough.");
            steps.push_back("Pour the mixture into a lightly greased or lined dish and level the top. Cook it gently -- bake, steam, or chill, whichever suits this mix -- for about " + std::to_string(simmerTime) + " minutes, until the center is just set and a skewer comes out clean.");
            steps.push_back("Let it cool for 10 minutes so it firms up, then cut or spoon it into " + servingsStr + " even portion(s).");
            steps.push_back("Serve as a sweet treat in the " + cuisine + " style. Leftovers keep covered in the fridge for up to 2 days.");
            break;
        }

        case DishMode::Breakfast: {
            for (auto& st : prepSteps()) steps.push_back(st);
            steps.push_back(heatStep("a non-stick pan", "medium"));
            if (!veg.empty() || !potatoes.empty()) {
                std::vector<std::string> firm = bodyVeg;
                if (!potatoes.empty()) steps.push_back("Add the " + joinAnd(potatoes) + " first and cook for 8-10 minutes, turning now and then, until golden and fork-tender -- they are the slowest item.");
                aromaticSteps(steps);
                std::vector<std::string> softVeg;
                for (const auto& v : bodyVeg) if (!isPotato(v)) softVeg.push_back(v);
                softVeg.insert(softVeg.end(), tomatoes.begin(), tomatoes.end());
                if (!softVeg.empty()) steps.push_back("Add the " + joinAnd(softVeg) + " and cook for 3-4 minutes, until just softened but still bright.");
                if (!leafy.empty()) steps.push_back("Add the " + joinAnd(leafy) + " and toss for 1 minute until wilted.");
            }
            proteinSear(steps);
            if (!legumes.empty()) steps.push_back("Add the " + joinAnd(legumes) + " and heat through for 3-4 minutes, mashing a few with the spoon so the mixture binds.");
            if (!delicates.empty()) steps.push_back("Add the " + joinAnd(delicates) + " and cook for 2-3 minutes per side until opaque and flaking.");
            if (!eggs.empty()) steps.push_back("Reduce the heat to low and pour in the " + joinAnd(eggs) + ". Stir slowly, pushing from the edges to the center, for 2-3 minutes until softly set and still glossy. Take it off the heat just before it looks done, since it keeps cooking in the pan.");
            spiceStep(steps);
            if (!grainStep.empty()) steps.push_back(grainStep);
            finishFoods(steps);
            steps.push_back("Taste and adjust with salt and pepper, then plate warm for " + servingsStr + " serving(s) as a quick " + cuisine + "-style breakfast.");
            break;
        }

        case DishMode::Salad: {
            std::vector<std::string> produce = veg;
            produce.insert(produce.end(), c.fruits.begin(), c.fruits.end());
            std::string produceList = produce.empty() ? "your vegetables and fruit" : joinWithAnd(produce);
            steps.push_back("Wash everything under cold running water and dry it thoroughly with a clean towel or salad spinner. Wet leaves dilute the seasoning and turn limp.");
            if (!produce.empty()) steps.push_back("Cut the produce: " + prepList(produce) + ". Slice firm items thinner than soft ones so every forkful has the same bite.");
            steps.push_back("Put " + produceList + " in a large bowl, keeping softer items (tomato, fruit) for the top so they do not get crushed.");
            std::string acid;
            for (const auto& fruit : c.fruits) {
                std::string lower = toLowerStr(fruit);
                if (lower.find("lemon") != std::string::npos || lower.find("lime") != std::string::npos) { acid = fruit; break; }
            }
            if (!acid.empty()) steps.push_back("Squeeze the " + acid + " over the top, add a pinch of salt and a few grinds of pepper, and toss gently with your hands or two spoons until everything is lightly coated.");
            else steps.push_back("Add a pinch of salt and a few grinds of pepper and toss gently until everything is lightly coated. Taste a leaf and adjust.");
            if (!spices.empty()) steps.push_back("Sprinkle over the " + joinAnd(spices) + " and toss once more.");
            std::vector<std::string> extras = c.proteins;
            extras.insert(extras.end(), dairy.begin(), dairy.end());
            extras.insert(extras.end(), otherFood.begin(), otherFood.end());
            extras.insert(extras.end(), liquids.begin(), liquids.end());
            extras.insert(extras.end(), c.grains.begin(), c.grains.end());
            if (!extras.empty()) steps.push_back("Fold in the " + joinAnd(extras) + " just before serving so the textures stay distinct.");
            steps.push_back("Chill for 10 minutes if you have time, toss again, and serve fresh as a light " + cuisine + "-style salad for " + servingsStr + " serving(s). Eat the same day for the best crunch.");
            break;
        }

        case DishMode::StirFry: {
            for (auto& st : prepSteps()) steps.push_back(st);
            if (!grainStep.empty()) steps.push_back(grainStep + " Do this first so it is ready when the stir-fry finishes.");
            steps.push_back("Line everything up next to the stove in the order it goes in. Stir-frying takes only a few minutes and you will not have time to chop once the pan is hot.");
            steps.push_back(heatStep("a wok or your widest pan", "high"));
            proteinSear(steps);
            if (!delicates.empty()) steps.push_back("Add the " + joinAnd(delicates) + " and stir-fry for 1-2 minutes until just opaque, then move to the side or take it out and return it at the end so it does not overcook.");
            aromaticSteps(steps);
            std::vector<std::string> hardVeg;
            for (const auto& v : bodyVeg) hardVeg.push_back(v);
            if (!hardVeg.empty()) steps.push_back("Add the " + joinAnd(hardVeg) + " and stir-fry for 3-4 minutes, keeping everything moving so it browns rather than steams. Add a tablespoon of water if the pan looks dry.");
            if (!tomatoes.empty()) steps.push_back("Add the " + joinAnd(tomatoes) + " and toss for 1-2 minutes, just until they start to soften.");
            if (!leafy.empty()) steps.push_back("Add the " + joinAnd(leafy) + " and toss for about 1 minute, until wilted but still bright green.");
            if (!eggs.empty()) steps.push_back("Push everything to one side, pour the beaten " + joinAnd(eggs) + " into the space and scramble for 1 minute, then toss it through.");
            if (!legumes.empty()) steps.push_back("Add the " + joinAnd(legumes) + " and toss for 2 minutes until hot.");
            spiceStep(steps);
            if (!liquids.empty()) steps.push_back("Pour the " + joinAnd(liquids) + " around the edge of the pan so it sizzles, then toss for 1 minute until everything is glossy and lightly coated.");
            finishFoods(steps);
            if (!c.grains.empty() && !grainStep.empty()) steps.push_back("Add the cooked " + joinAnd(pick(c.grains, isPotato, false)) + " and toss over high heat for 1 minute so it picks up the flavors.");
            steps.push_back("Taste and finish with salt, pepper and a splash of water if it needs loosening, for a " + cuisine + "-style result.");
            steps.push_back("Serve immediately while hot, for " + servingsStr + " serving(s). Stir-fries lose their crunch quickly, so do not let it sit.");
            break;
        }

        case DishMode::Simmer: {
            for (auto& st : prepSteps()) steps.push_back(st);
            steps.push_back(heatStep("a heavy-bottomed pot or deep pan", "medium"));
            spiceStep(steps);
            aromaticSteps(steps);
            if (!tomatoes.empty()) steps.push_back("Add the " + joinAnd(tomatoes) + " with a pinch of salt and cook for 5-6 minutes, pressing with the back of the spoon, until they collapse into a thick, jammy base that leaves the sides of the pan.");
            proteinSear(steps);
            if (!bodyVeg.empty()) {
                std::string tail = potatoes.empty() ? "" : " The " + joinAnd(potatoes) + " is the slowest to cook, so it goes in at this stage.";
                steps.push_back("Add the " + joinAnd(bodyVeg) + " and stir for 2-3 minutes to coat everything in the base." + tail);
            }
            if (!legumes.empty()) steps.push_back("Stir in the " + joinAnd(legumes) + " so they absorb the flavors as they heat.");
            if (!liquids.empty()) steps.push_back("Pour in the " + joinAnd(liquids) + " and scrape up any browned bits from the bottom of the pan, since they carry a lot of flavor. Bring to a gentle simmer.");
            else steps.push_back("Pour in about 1 cup (250 ml) of water, enough to just cover the base, scrape up any browned bits, and bring to a gentle simmer.");
            steps.push_back("Reduce the heat to low, partly cover, and simmer for about " + std::to_string(simmerTime) + " minutes, stirring every few minutes. It is ready when the thickest piece breaks easily when pressed with a spoon" + (meats.empty() ? "." : " and the meat shows no pink inside."));
            if (!grainStep.empty()) steps.push_back("While that simmers, " + std::string(1, static_cast<char>(std::tolower(static_cast<unsigned char>(grainStep[0])))) + grainStep.substr(1));
            if (!delicates.empty()) steps.push_back("Nestle the " + joinAnd(delicates) + " into the sauce for the last 4-5 minutes, just until opaque and flaking. It overcooks quickly.");
            if (!eggs.empty()) steps.push_back("Crack or pour the " + joinAnd(eggs) + " into the simmering sauce and cook, covered, for 3-4 minutes until the whites are set.");
            if (!leafy.empty()) steps.push_back("Stir in the " + joinAnd(leafy) + " for the final 2 minutes, until wilted.");
            steps.push_back("Uncover for the last 3-5 minutes if it is thinner than you like, and let it bubble gently until it coats the back of a spoon. Add a splash of hot water if it is too thick.");
            finishFoods(steps);
            std::vector<std::string> servers = pick(c.grains, isPotato, false);
            steps.push_back("Taste, then adjust with salt and pepper a little at a time. Let it rest off the heat for 2 minutes so the flavors settle.");
            steps.push_back("Serve hot" + std::string(servers.empty() ? "" : " with the " + joinAnd(servers)) + " for " + servingsStr + " serving(s), " + cuisine + "-style." + (hard ? " For a deeper flavor, make it a few hours ahead and reheat gently." : " Leftovers keep in the fridge for 2 days."));
            break;
        }

        default: {
            for (auto& st : prepSteps()) steps.push_back(st);
            steps.push_back(heatStep("a wide pan", "medium"));
            spiceStep(steps);
            aromaticSteps(steps);
            proteinSear(steps);
            if (!bodyVeg.empty()) steps.push_back("Add the " + joinAnd(bodyVeg) + " and cook for 4-5 minutes, stirring occasionally, until the edges start to color.");
            if (!tomatoes.empty()) steps.push_back("Add the " + joinAnd(tomatoes) + " and cook for 3-4 minutes until softened.");
            if (!legumes.empty()) steps.push_back("Add the " + joinAnd(legumes) + " and stir until heated through, about 3 minutes.");
            if (!liquids.empty()) steps.push_back("Add the " + joinAnd(liquids) + " and stir, scraping the bottom of the pan.");
            if (!delicates.empty()) steps.push_back("Add the " + joinAnd(delicates) + " and cook for 3-4 minutes until opaque.");
            if (!eggs.empty()) steps.push_back("Stir in the beaten " + joinAnd(eggs) + " and cook gently for 2 minutes until set.");
            if (!leafy.empty()) steps.push_back("Add the " + joinAnd(leafy) + " and toss until wilted, about 1-2 minutes.");
            steps.push_back("Add 2-3 tablespoons of water, cover, and cook on low for about " + std::to_string(simmerTime) + " minutes, until everything is tender when pierced with a fork.");
            if (!grainStep.empty()) steps.push_back(grainStep);
            finishFoods(steps);
            steps.push_back("Taste, adjust with salt and pepper for a " + cuisine + " flavor profile, and rest for 2 minutes.");
            steps.push_back("Plate for " + servingsStr + " serving(s) and serve hot as a " + preferences.getMealType() + " dish.");
            break;
        }
    }

    // Safety net: every listed ingredient must be mentioned at least once (fats count as used
    // in the heating step; spices etc. are covered above). Anything missed gets a short step.
    std::string joined = toLowerStr([&] { std::string j; for (auto& st : steps) j += st + " "; return j; }());
    std::vector<std::string> missed;
    for (const auto& i : all) if (joined.find(toLowerStr(i)) == std::string::npos) missed.push_back(i);
    if (!missed.empty()) {
        auto at = steps.end() - (steps.size() > 1 ? 1 : 0);   // before the serving step
        steps.insert(at, "Add the " + joinAnd(missed) + " near the end and warm through for 1-2 minutes, tasting as you go.");
    }

    (void)pickOne;
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
