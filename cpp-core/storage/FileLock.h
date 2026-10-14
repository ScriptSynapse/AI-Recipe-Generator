#ifndef FILE_LOCK_H
#define FILE_LOCK_H

#include <chrono>
#include <filesystem>
#include <string>
#include <system_error>
#include <thread>
#include "RecipeStorage.h"

/*
 * FileLock (RAII)
 * -----------------------------------------------------------------------
 * Cross-process mutual exclusion for the JSON storage files. The Express
 * layer spawns one recipe_engine process per request, so two concurrent
 * "save" requests would otherwise each read the same file, append their
 * record, and overwrite one another (lost update).
 *
 * The lock is a directory named "<file>.lock": std::filesystem::
 * create_directory is atomic on POSIX and Windows -- it succeeds for
 * exactly one caller. The destructor releases the lock, so it is released
 * on every path including exceptions (constructor = acquire, destructor =
 * release: a genuine use of both).
 *
 * A lock older than `staleAfter` is assumed to belong to a crashed process
 * and is reclaimed. (Two waiters reclaiming the same stale lock at the
 * same instant is theoretically racy, but only after a crash and only
 * once; acceptable for this storage layer.)
 */
class FileLock {
private:
    std::filesystem::path lockPath;
    bool held = false;

public:
    explicit FileLock(const std::string& targetFile,
                      std::chrono::milliseconds timeout = std::chrono::milliseconds(3000),
                      std::chrono::seconds staleAfter = std::chrono::seconds(15))
        : lockPath(targetFile + ".lock") {
        namespace fs = std::filesystem;
        const auto deadline = std::chrono::steady_clock::now() + timeout;
        for (;;) {
            std::error_code ec;
            if (fs::create_directory(lockPath, ec)) { held = true; return; }
            // libstdc++ reports EEXIST (not "false") when the holder removes the lock
            // between our mkdir and its follow-up is_directory check. That still means
            // "someone held it a moment ago": wait and retry. Any OTHER error is real.
            if (ec && ec != std::errc::file_exists) throw StorageException("Unable to create storage lock: " + ec.message());

            std::error_code timeEc;
            auto modified = fs::last_write_time(lockPath, timeEc);
            if (!timeEc && (fs::file_time_type::clock::now() - modified) > staleAfter) {
                std::error_code removeEc;
                fs::remove(lockPath, removeEc);
                continue;
            }
            if (std::chrono::steady_clock::now() >= deadline) {
                throw StorageException("Timed out waiting for the storage lock.");
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(15));
        }
    }

    ~FileLock() {
        if (held) {
            std::error_code ec;
            std::filesystem::remove(lockPath, ec);
        }
    }

    FileLock(const FileLock&) = delete;
    FileLock& operator=(const FileLock&) = delete;
};

#endif // FILE_LOCK_H
