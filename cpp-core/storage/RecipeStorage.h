#ifndef RECIPE_STORAGE_H
#define RECIPE_STORAGE_H

#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * StorageException
 * -----------------------------------------------------------------------
 * Thrown when file I/O against the saved-recipes store fails (e.g. the
 * data directory doesn't exist, or the JSON file is corrupted).
 */
class StorageException : public std::runtime_error {
public:
    explicit StorageException(const std::string& message) : std::runtime_error(message) {}
};

/*
 * RecipeStorage
 * -----------------------------------------------------------------------
 * Handles all persistence for saved recipes using C++ file streams
 * (std::ifstream / std::ofstream) against data/saved_recipes.json. This
 * is the module that demonstrates the "File Handling" OOP requirement.
 */
class RecipeStorage {
private:
    std::string filePath;

    std::vector<json> loadAll() const;
    void writeAll(const std::vector<json>& recipes) const;

public:
    explicit RecipeStorage(const std::string& filePath);

    // Persists a recipe (as JSON) and returns the stored record
    // (with a generated savedAt timestamp).
    json save(const json& recipeJson);

    // Returns all saved recipes, most recently saved first.
    std::vector<json> loadRecipes() const;

    // Returns a single saved recipe by id, or an empty json object if
    // not found.
    json findById(const std::string& id) const;

    // Deletes a saved recipe by id. Returns true if a record was removed.
    bool remove(const std::string& id);

    // Simple case-insensitive search by recipe name / cuisine.
    std::vector<json> search(const std::string& query) const;
};

#endif // RECIPE_STORAGE_H
