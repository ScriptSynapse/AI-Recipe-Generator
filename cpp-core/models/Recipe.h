#ifndef RECIPE_H
#define RECIPE_H

#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

// A single ingredient with a scalable quantity.
// Kept as a lightweight value type (not its own polymorphic hierarchy)
// because it has no varying behavior — only Recipe and RecipeGenerator
// hierarchies need runtime polymorphism in this design.
struct Ingredient {
    std::string name;
    double quantity;
    std::string unit;

    Ingredient() : name(""), quantity(0.0), unit("") {}
    Ingredient(const std::string& n, double q, const std::string& u)
        : name(n), quantity(q), unit(u) {}

    json toJson() const;
    static Ingredient fromJson(const json& j);
};

struct NutritionInfo {
    double calories = 0;
    double proteinGrams = 0;
    double carbsGrams = 0;
    double fatGrams = 0;
    bool estimated = true;

    json toJson() const;
};

/*
 * Recipe (Abstract Base Class)
 * -----------------------------------------------------------------------
 * Represents the common contract shared by every kind of recipe in the
 * system, regardless of where it came from (local database or AI model).
 *
 * OOP notes for viva:
 *  - Encapsulation: all state is private/protected; accessed via getters
 *    and setters that can validate/normalize values.
 *  - Abstraction: Recipe cannot be instantiated directly (pure virtual
 *    functions). Only concrete subclasses (TraditionalRecipe, AIRecipe)
 *    can be created.
 *  - Polymorphism: generateInstructions() and getSourceLabel() are
 *    overridden differently by each subclass, and callers operate on
 *    Recipe* / Recipe& without knowing the concrete type.
 */
class Recipe {
protected:
    std::string id;
    std::string name;
    std::string cuisine;
    std::string mealType;
    std::string dietaryPreference;
    std::vector<Ingredient> ingredients;
    std::vector<std::string> instructions;
    int cookingTimeMinutes;
    std::string difficulty;
    int servings;
    NutritionInfo nutrition;
    std::vector<std::string> substitutionNotes;

public:
    Recipe(const std::string& id,
           const std::string& name,
           const std::string& cuisine,
           const std::string& mealType,
           const std::string& dietaryPreference,
           std::vector<Ingredient> ingredients,
           std::vector<std::string> instructions,
           int cookingTimeMinutes,
           const std::string& difficulty,
           int servings,
           NutritionInfo nutrition);

    // Virtual destructor: mandatory whenever a class is intended to be
    // used polymorphically through a base pointer, so derived-class
    // resources are released correctly (e.g. `delete recipePtr;`).
    virtual ~Recipe();

    // --- Getters (encapsulation: read-only external access) ---
    std::string getId() const;
    std::string getName() const;
    std::string getCuisine() const;
    std::string getMealType() const;
    std::string getDietaryPreference() const;
    const std::vector<Ingredient>& getIngredients() const;
    const std::vector<std::string>& getInstructions() const;
    int getCookingTime() const;
    std::string getDifficulty() const;
    int getServings() const;
    const NutritionInfo& getNutrition() const;
    const std::vector<std::string>& getSubstitutionNotes() const;

    // --- Setters (encapsulation: controlled mutation) ---
    void setName(const std::string& n);
    void setServings(int s);
    void setIngredients(const std::vector<Ingredient>& ing);
    void setInstructions(const std::vector<std::string>& instr);
    void setNutrition(const NutritionInfo& n);
    void addSubstitutionNote(const std::string& note);

    // Pure virtual: every concrete Recipe type must supply its own way
    // of describing where its instructions come from / how it phrases
    // them. This is the polymorphic hook exercised by RecipeCustomizer.
    virtual void generateInstructions() = 0;

    // Pure virtual: identifies the concrete origin of the recipe
    // ("Traditional Database Recipe" vs "AI Generated Recipe").
    virtual std::string getSourceLabel() const = 0;

    // Virtual with a default body: subclasses may override, but most
    // won't need to. Demonstrates a *non-pure* virtual function
    // alongside the pure virtual ones above.
    virtual std::string displayRecipe() const;

    // Serialize for transport across the C++ <-> Node.js boundary.
    virtual json toJson() const;
};

#endif // RECIPE_H
