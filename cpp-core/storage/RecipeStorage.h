#ifndef RECIPE_STORAGE_H
#define RECIPE_STORAGE_H

#include <stdexcept>
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
 * InvalidRecipeException
 * -----------------------------------------------------------------------
 * Thrown when a record submitted for saving is malformed or oversized.
 * Derives from std::invalid_argument so the CLI maps it to a client error
 * (HTTP 400), distinct from StorageException (server-side I/O failure).
 * Messages are written to be safe to show to end users.
 */
class InvalidRecipeException : public std::invalid_argument {
public:
    explicit InvalidRecipeException(const std::string& message) : std::invalid_argument(message) {}
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
    void writeAll(const std::vector<json>& recipes) const;   // atomic: temp file + rename

    static bool isSafeId(const std::string& id);
    static std::string generateId();

public:
    // Shape and size rules for one record (object, text name, bounded lists/size).
    // Public so a caller can validate BEFORE rebuilding the record.
    static void validateRecord(const json& recipeJson);       // throws InvalidRecipeException

    explicit RecipeStorage(const std::string& filePath);

    // Validates and persists a recipe (as JSON) under a cross-process lock
    // and returns the stored record (with a generated savedAt timestamp).
    // A client-supplied id is kept only if it is safe (1-64 chars of
    // [A-Za-z0-9._-]) and not already stored; otherwise a fresh id is
    // generated, so ids are always unique and URL-safe.
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
