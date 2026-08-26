// Unit tests for RecipeStorage: save/load/delete/search using real file
// I/O against a temporary JSON file (exercises the "File Handling"
// OOP requirement end-to-end, not mocked).
#include <cassert>
#include <iostream>
#include <cstdio>
#include "../cpp-core/storage/RecipeStorage.h"

int main() {
    const std::string testFile = "test_saved_recipes.json";
    std::remove(testFile.c_str());

    RecipeStorage storage(testFile);

    // TC07: Save recipe -> Recipe stored.
    json recipe1 = json{{"id", "r1"}, {"name", "Test Paneer"}, {"cuisine", "Indian"}};
    json saved1 = storage.save(recipe1);
    assert(saved1.contains("savedAt"));
    std::cout << "TC07 passed: recipe saved with timestamp " << saved1["savedAt"] << "\n";

    json recipe2 = json{{"id", "r2"}, {"name", "Test Curry"}, {"cuisine", "Thai"}};
    storage.save(recipe2);

    // loadRecipes returns most-recent first.
    auto all = storage.loadRecipes();
    assert(all.size() == 2);
    assert(all.front().value("id", "") == "r2");
    std::cout << "Load test passed: " << all.size() << " recipes loaded, most recent first.\n";

    // findById
    json found = storage.findById("r1");
    assert(found.value("name", "") == "Test Paneer");
    std::cout << "findById test passed.\n";

    // search
    auto results = storage.search("curry");
    assert(results.size() == 1);
    assert(results[0].value("id", "") == "r2");
    std::cout << "search test passed.\n";

    // delete
    bool removed = storage.remove("r1");
    assert(removed);
    assert(storage.loadRecipes().size() == 1);
    bool removedAgain = storage.remove("r1");
    assert(!removedAgain);
    std::cout << "delete test passed.\n";

    std::remove(testFile.c_str());
    std::cout << "All RecipeStorage tests passed.\n";
    return 0;
}
