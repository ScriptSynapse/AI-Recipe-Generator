#include "RecipeStorage.h"
#include "FileLock.h"
#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <random>
#include <sstream>

namespace fs = std::filesystem;

// Upper bounds for a single saved record (defence against oversized or
// abusive payloads reaching the on-disk store).
static const size_t MAX_RECORD_BYTES = 64 * 1024;
static const size_t MAX_NAME_LENGTH = 200;
static const size_t MAX_LIST_ITEMS = 200;
static const size_t MAX_ID_LENGTH = 64;

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

// Writes to "<file>.tmp" and then renames over the real file. A rename is
// atomic, so a concurrent reader (or a crash mid-write) never observes a
// half-written or truncated JSON file. Callers must hold the FileLock.
void RecipeStorage::writeAll(const std::vector<json>& recipes) const {
    json arr = json::array();
    for (const auto& r : recipes) arr.push_back(r);

    const std::string tmpPath = filePath + ".tmp";
    {
        std::ofstream out(tmpPath, std::ios::trunc);
        if (!out.is_open()) {
            throw StorageException("Unable to open storage file for writing: " + tmpPath);
        }
        out << arr.dump(2);
        out.flush();
        if (out.fail()) {
            out.close();
            std::error_code rmEc;
            fs::remove(tmpPath, rmEc);
            throw StorageException("Failed while writing to storage file: " + tmpPath);
        }
    }

    std::error_code ec;
    fs::rename(tmpPath, filePath, ec);
    if (ec) {
        std::error_code rmEc;
        fs::remove(tmpPath, rmEc);
        throw StorageException("Unable to replace storage file: " + ec.message());
    }
}

static std::string currentIsoTimestamp() {
    auto now = std::chrono::system_clock::now();
    std::time_t t = std::chrono::system_clock::to_time_t(now);
    std::tm tmBuf{};
#ifdef _WIN32
    gmtime_s(&tmBuf, &t);
#else
    gmtime_r(&t, &tmBuf);   // thread-safe variant
#endif
    std::ostringstream oss;
    oss << std::put_time(&tmBuf, "%Y-%m-%dT%H:%M:%SZ");
    return oss.str();
}

bool RecipeStorage::isSafeId(const std::string& id) {
    if (id.empty() || id.size() > MAX_ID_LENGTH) return false;
    return std::all_of(id.begin(), id.end(), [](unsigned char c) {
        return std::isalnum(c) || c == '.' || c == '_' || c == '-';
    });
}

std::string RecipeStorage::generateId() {
    thread_local std::mt19937_64 rng{std::random_device{}()};
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                  std::chrono::system_clock::now().time_since_epoch()).count();
    std::ostringstream oss;
    oss << "saved-" << ms << "-" << std::hex << std::setw(8) << std::setfill('0')
        << (rng() & 0xffffffffULL);
    return oss.str();
}

void RecipeStorage::validateRecord(const json& r) {
    if (!r.is_object()) throw InvalidRecipeException("Recipe must be a JSON object.");

    if (!r.contains("name") || !r["name"].is_string() || r["name"].get<std::string>().empty()) {
        throw InvalidRecipeException("Recipe must have a non-empty text name.");
    }
    if (r["name"].get<std::string>().size() > MAX_NAME_LENGTH) {
        throw InvalidRecipeException("Recipe name is too long.");
    }
    if (r.contains("id") && !r["id"].is_string()) {
        throw InvalidRecipeException("Recipe id must be text.");
    }
    for (const char* key : {"ingredients", "instructions", "substitutionNotes"}) {
        if (r.contains(key)) {
            if (!r[key].is_array()) {
                throw InvalidRecipeException(std::string("Recipe field '") + key + "' must be a list.");
            }
            if (r[key].size() > MAX_LIST_ITEMS) {
                throw InvalidRecipeException(std::string("Recipe field '") + key + "' has too many entries.");
            }
        }
    }
    if (r.dump().size() > MAX_RECORD_BYTES) {
        throw InvalidRecipeException("Recipe is too large to save.");
    }
}

json RecipeStorage::save(const json& recipeJson) {
    validateRecord(recipeJson);

    FileLock lock(filePath);   // held until this function returns or throws
    std::vector<json> records = loadAll();

    json record = recipeJson;
    record["savedAt"] = currentIsoTimestamp();

    std::string id = record.value("id", "");
    bool duplicate = std::any_of(records.begin(), records.end(), [&](const json& existing) {
        return existing.value("id", "") == id;
    });
    if (!isSafeId(id) || duplicate) {
        record["id"] = generateId();
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
    FileLock lock(filePath);
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
