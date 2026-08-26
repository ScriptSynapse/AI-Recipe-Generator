#include "RecipeStorage.h"
#include <fstream>
#include <algorithm>
#include <chrono>
#include <ctime>
#include <sstream>

RecipeStorage::RecipeStorage(const std::string& filePath_) : filePath(filePath_) {}

std::vector<json> RecipeStorage::loadAll() const {
    std::ifstream in(filePath);
    if (!in.is_open()) {
        // No file yet is not an error -- treat as an empty store.
        return {};
    }

    std::vector<json> records;
    try {
        json data;
        in >> data;
        if (data.is_array()) {
            for (const auto& item : data) records.push_back(item);
        }
    } catch (const json::parse_error&) {
        throw StorageException("Saved recipes file is corrupted: " + filePath);
    }
    return records;
}

void RecipeStorage::writeAll(const std::vector<json>& recipes) const {
    std::ofstream out(filePath);
    if (!out.is_open()) {
        throw StorageException("Unable to open storage file for writing: " + filePath);
    }
    json arr = json::array();
    for (const auto& r : recipes) arr.push_back(r);
    out << arr.dump(2);
    if (out.fail()) {
        throw StorageException("Failed while writing to storage file: " + filePath);
    }
}

static std::string currentIsoTimestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::ostringstream oss;
    oss << std::put_time(std::gmtime(&t), "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

json RecipeStorage::save(const json& recipeJson) {
    std::vector<json> records = loadAll();

    json record = recipeJson;
    record["savedAt"] = currentIsoTimestamp();
    if (!record.contains("id") || record["id"].get<std::string>().empty()) {
        record["id"] = "saved-" + std::to_string(records.size() + 1) + "-" + currentIsoTimestamp();
    }

    records.push_back(record);
    writeAll(records);
    return record;
}

std::vector<json> RecipeStorage::loadRecipes() const {
    std::vector<json> records = loadAll();
    // Most recently saved first.
    std::reverse(records.begin(), records.end());
    return records;
}

json RecipeStorage::findById(const std::string& id) const {
    std::vector<json> records = loadAll();
    for (const auto& r : records) {
        if (r.value("id", "") == id) return r;
    }
    return json::object();
}

bool RecipeStorage::remove(const std::string& id) {
    std::vector<json> records = loadAll();
    size_t before = records.size();
    records.erase(std::remove_if(records.begin(), records.end(), [&](const json& r) {
        return r.value("id", "") == id;
    }), records.end());

    if (records.size() == before) return false;
    writeAll(records);
    return true;
}

std::vector<json> RecipeStorage::search(const std::string& query) const {
    std::string q = query;
    std::transform(q.begin(), q.end(), q.begin(), ::tolower);

    std::vector<json> records = loadAll();
    std::vector<json> matches;
    for (const auto& r : records) {
        std::string name = r.value("name", "");
        std::string cuisine = r.value("cuisine", "");
        std::transform(name.begin(), name.end(), name.begin(), ::tolower);
        std::transform(cuisine.begin(), cuisine.end(), cuisine.begin(), ::tolower);
        if (name.find(q) != std::string::npos || cuisine.find(q) != std::string::npos) {
            matches.push_back(r);
        }
    }
    std::reverse(matches.begin(), matches.end());
    return matches;
}
