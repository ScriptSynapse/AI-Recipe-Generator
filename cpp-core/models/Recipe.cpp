#include "Recipe.h"
#include <sstream>

json Ingredient::toJson() const {
    return json{{"name", name}, {"quantity", quantity}, {"unit", unit}};
}

Ingredient Ingredient::fromJson(const json& j) {
    Ingredient i;
    i.name = j.value("name", "");
    i.quantity = j.value("quantity", 0.0);
    i.unit = j.value("unit", "");
    return i;
}

json NutritionInfo::toJson() const {
    return json{
        {"calories", calories},
        {"proteinGrams", proteinGrams},
        {"carbsGrams", carbsGrams},
        {"fatGrams", fatGrams},
        {"estimated", estimated}
    };
}

Recipe::Recipe(const std::string& id_,
               const std::string& name_,
               const std::string& cuisine_,
               const std::string& mealType_,
               const std::string& dietaryPreference_,
               std::vector<Ingredient> ingredients_,
               std::vector<std::string> instructions_,
               int cookingTimeMinutes_,
               const std::string& difficulty_,
               int servings_,
               NutritionInfo nutrition_)
    : id(id_), name(name_), cuisine(cuisine_), mealType(mealType_),
      dietaryPreference(dietaryPreference_), ingredients(std::move(ingredients_)),
      instructions(std::move(instructions_)), cookingTimeMinutes(cookingTimeMinutes_),
      difficulty(difficulty_), servings(servings_), nutrition(nutrition_) {}

// Destructor is virtual (declared in header) — base implementation is
// trivial since Recipe owns no raw resources, only STL containers that
// clean up themselves.
Recipe::~Recipe() {}

std::string Recipe::getId() const { return id; }
std::string Recipe::getName() const { return name; }
std::string Recipe::getCuisine() const { return cuisine; }
std::string Recipe::getMealType() const { return mealType; }
std::string Recipe::getDietaryPreference() const { return dietaryPreference; }
const std::vector<Ingredient>& Recipe::getIngredients() const { return ingredients; }
const std::vector<std::string>& Recipe::getInstructions() const { return instructions; }
int Recipe::getCookingTime() const { return cookingTimeMinutes; }
std::string Recipe::getDifficulty() const { return difficulty; }
int Recipe::getServings() const { return servings; }
const NutritionInfo& Recipe::getNutrition() const { return nutrition; }
const std::vector<std::string>& Recipe::getSubstitutionNotes() const { return substitutionNotes; }

void Recipe::setName(const std::string& n) { name = n; }

void Recipe::setServings(int s) {
    // Basic invariant enforced at the setter, not left to callers.
    if (s < 1) s = 1;
    if (s > 12) s = 12;
    servings = s;
}

void Recipe::setIngredients(const std::vector<Ingredient>& ing) { ingredients = ing; }
void Recipe::setInstructions(const std::vector<std::string>& instr) { instructions = instr; }
void Recipe::setNutrition(const NutritionInfo& n) { nutrition = n; }
void Recipe::addSubstitutionNote(const std::string& note) { substitutionNotes.push_back(note); }

// Default textual rendering; subclasses inherit this unless they need
// something different (none currently override it, showing that virtual
// functions are used purposefully rather than decoratively).
std::string Recipe::displayRecipe() const {
    std::ostringstream out;
    out << name << " (" << cuisine << ", " << getSourceLabel() << ")\n";
    out << "Serves " << servings << " | " << cookingTimeMinutes << " min | " << difficulty << "\n";
    out << "Ingredients:\n";
    for (const auto& ing : ingredients) {
        out << "  - " << ing.quantity << " " << ing.unit << " " << ing.name << "\n";
    }
    out << "Instructions:\n";
    int step = 1;
    for (const auto& instr : instructions) {
        out << "  " << step++ << ". " << instr << "\n";
    }
    return out.str();
}

json Recipe::toJson() const {
    json ingArr = json::array();
    for (const auto& ing : ingredients) ingArr.push_back(ing.toJson());

    return json{
        {"id", id},
        {"name", name},
        {"cuisine", cuisine},
        {"mealType", mealType},
        {"dietaryPreference", dietaryPreference},
        {"ingredients", ingArr},
        {"instructions", instructions},
        {"cookingTime", cookingTimeMinutes},
        {"difficulty", difficulty},
        {"servings", servings},
        {"nutrition", nutrition.toJson()},
        {"substitutionNotes", substitutionNotes},
        {"source", getSourceLabel()}
    };
}
