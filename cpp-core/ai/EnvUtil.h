#ifndef ENV_UTIL_H
#define ENV_UTIL_H

#include <cstdlib>
#include <string>

/*
 * Tiny helpers for reading configuration from environment variables.
 * (Phase 22 introduces the full centralized configuration layer; these
 * keep provider construction simple until then.) Values are trimmed:
 * a stray "\r" from a Windows-edited .env file would otherwise end up
 * inside an HTTP header.
 */
inline std::string trimCopy(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

inline std::string readEnv(const char* name) {
    const char* value = std::getenv(name);
    return value ? trimCopy(value) : std::string();
}

inline std::string readEnvOr(const char* name, const std::string& fallback) {
    std::string value = readEnv(name);
    return value.empty() ? fallback : value;
}

#endif // ENV_UTIL_H
