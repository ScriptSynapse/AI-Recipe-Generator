#ifndef USER_H
#define USER_H

#include <string>
#include <vector>
#include "../json.hpp"

using json = nlohmann::json;

/*
 * User
 * -----------------------------------------------------------------------
 * Represents a person using the app and their standing preferences.
 * Demonstrates plain encapsulation (no inheritance needed here) — all
 * fields are private and only reachable through accessor methods.
 */
class User {
private:
    std::string name;
    std::string dietaryPreference;
    std::string preferredCuisine;
    std::vector<std::string> preferences; // free-form preference tags

public:
    User();
    User(const std::string& name,
         const std::string& dietaryPreference,
         const std::string& preferredCuisine);

    // --- Getters ---
    std::string getName() const;
    std::string getDietaryPreference() const;
    std::string getPreferredCuisine() const;
    const std::vector<std::string>& getPreferences() const;

    // --- Setters ---
    void setName(const std::string& n);
    void setDietaryPreference(const std::string& pref);
    void setPreferredCuisine(const std::string& cuisine);
    void addPreference(const std::string& tag);

    std::string displayPreferences() const;

    json toJson() const;
    static User fromJson(const json& j);
};

#endif // USER_H
