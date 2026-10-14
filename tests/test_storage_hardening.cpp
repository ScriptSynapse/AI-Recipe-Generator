// Phase 0 hardening tests for RecipeStorage: validation, id safety,
// cross-process-style locking (exercised with threads), atomic writes,
// stale-lock recovery, corrupted-file handling.
#include <cassert>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <thread>
#include <vector>
#include <atomic>
#include "../cpp-core/storage/FileLock.h"
#include "../cpp-core/storage/RecipeStorage.h"

namespace fs = std::filesystem;
static const std::string F = "test_hardening_recipes.json";

static void cleanup() {
    std::error_code ec;
    fs::remove(F, ec); fs::remove(F + ".tmp", ec); fs::remove_all(F + ".lock", ec);
}

template <typename Ex, typename Fn>
static bool throwsAs(Fn fn) {
    try { fn(); } catch (const Ex&) { return true; } catch (...) { return false; }
    return false;
}

int main() {
    cleanup();
    RecipeStorage storage(F);

    // Duplicate client ids are replaced so ids stay unique.
    json a = storage.save(json{{"id", "same"}, {"name", "A"}});
    json b = storage.save(json{{"id", "same"}, {"name", "B"}});
    assert(a["id"] == "same");
    assert(b["id"] != "same");
    assert(storage.loadRecipes().size() == 2);
    std::cout << "HARD-01 passed: duplicate id replaced, both records kept.\n";

    // Unsafe / missing / overlong ids are replaced with a safe generated id.
    for (const json& bad : {json("../../etc/passwd"), json("has space"), json(std::string(65, 'x')), json("")}) {
        json rec = storage.save(json{{"id", bad}, {"name", "X"}});
        std::string id = rec["id"].get<std::string>();
        assert(id.rfind("saved-", 0) == 0);
    }
    json noId = storage.save(json{{"name", "NoId"}});
    assert(noId["id"].get<std::string>().rfind("saved-", 0) == 0);
    std::cout << "HARD-02 passed: unsafe/missing ids replaced with generated ids.\n";

    // Malformed records are rejected before touching the file.
    size_t before = storage.loadRecipes().size();
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json::array()); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"cuisine", "x"}}); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"name", 5}}); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"name", "n"}, {"ingredients", "oops"}}); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"name", std::string(201, 'n')}}); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"name", "n"}, {"instructions", std::vector<std::string>(300, "step")}}); }));
    assert(throwsAs<InvalidRecipeException>([&] { storage.save(json{{"name", "n"}, {"blob", std::string(70000, 'z')}}); }));
    assert(storage.loadRecipes().size() == before);
    std::cout << "HARD-03 passed: malformed/oversized records rejected, store unchanged.\n";

    // Concurrent saves: no lost updates.
    cleanup();
    RecipeStorage fresh(F);
    const int THREADS = 8, PER = 5;
    std::vector<std::thread> pool;
    for (int t = 0; t < THREADS; ++t) {
        pool.emplace_back([&, t] {
            RecipeStorage s(F);  // each thread has its own instance, like separate processes
            for (int i = 0; i < PER; ++i) s.save(json{{"name", "T" + std::to_string(t) + "-" + std::to_string(i)}});
        });
    }
    for (auto& th : pool) th.join();
    auto all = fresh.loadRecipes();
    std::set<std::string> ids;
    for (const auto& r : all) ids.insert(r["id"].get<std::string>());
    assert((int)all.size() == THREADS * PER);
    assert((int)ids.size() == THREADS * PER);
    std::cout << "HARD-04 passed: " << all.size() << " concurrent saves, none lost, all ids unique.\n";

    // No leftovers after operations.
    assert(!fs::exists(F + ".tmp"));
    assert(!fs::exists(F + ".lock"));
    std::cout << "HARD-05 passed: no .tmp or .lock left behind.\n";

    // A stale lock from a crashed process is reclaimed.
    fs::create_directory(F + ".lock");
    fs::last_write_time(F + ".lock", fs::file_time_type::clock::now() - std::chrono::hours(1));
    fresh.save(json{{"name", "AfterStale"}});
    assert(!fs::exists(F + ".lock"));
    std::cout << "HARD-06 passed: stale lock reclaimed.\n";

    // Corrupted store surfaces as StorageException (not a crash).
    { std::ofstream(F, std::ios::trunc) << "{ not json"; }
    assert(throwsAs<StorageException>([&] { fresh.loadRecipes(); }));
    assert(throwsAs<StorageException>([&] { fresh.save(json{{"name", "x"}}); }));
    assert(!fs::exists(F + ".lock"));   // lock released even when save throws
    std::cout << "HARD-07 passed: corrupted file -> StorageException, lock released.\n";

    // Lock churn: acquiring and releasing the lock back-to-back from many threads must never
    // THROW. libstdc++ reports EEXIST from create_directory when the holder removes the lock
    // between our mkdir and its follow-up check; FileLock must treat that as "held, retry".
    {
        const std::string lockTarget = F + ".churn";
        std::atomic<int> failures{0};
        std::atomic<int> inside{0};
        std::atomic<int> overlaps{0};
        std::vector<std::thread> workers;
        for (int t = 0; t < 8; ++t) {
            workers.emplace_back([&] {
                for (int i = 0; i < 400; ++i) {
                    try {
                        FileLock lock(lockTarget, std::chrono::milliseconds(20000));
                        if (inside.fetch_add(1) != 0) overlaps++;
                        inside.fetch_sub(1);
                    } catch (const std::exception&) {
                        failures++;
                    }
                }
            });
        }
        for (auto& w : workers) w.join();
        assert(failures == 0);
        assert(overlaps == 0);       // mutual exclusion still holds
        assert(!fs::exists(lockTarget + ".lock"));
    }
    std::cout << "HARD-08 passed: 3200 lock acquisitions across 8 threads, none threw, none overlapped.\n";

    cleanup();
    std::cout << "All RecipeStorage hardening tests passed.\n";
    return 0;
}
