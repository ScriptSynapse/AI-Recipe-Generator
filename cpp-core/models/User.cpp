#include "User.h"
#include <sstream>

User::User() : name("Guest"), dietaryPreference("No Preference"), preferredCuisine("Any") {}

User::User(const std::string& name_, const std::string& dietaryPreference_, const std::string& preferredCuisine_)
    : name(name_), dietaryPreference(dietaryPreference_), preferredCuisine(preferredCuisine_) {}

std::string User::getName() const { return name; }
std::string User::getDietaryPreference() const { return dietaryPreference; }
std::string User::getPreferredCuisine() const { return preferredCuisine; }
const std::vector<std::string>& User::getPreferences() const { return preferences; }

void User::setName(const std::string& n) { name = n; }
void User::setDietaryPreference(const std::string& pref) { dietaryPreference = pref; }
void User::setPreferredCuisine(const std::string& cuisine) { preferredCuisine = cuisine; }
void User::addPreference(const std::string& tag) { preferences.push_back(tag); }

std::string User::displayPreferences() const {
    std::ostringstream out;
    out << name << " prefers " << dietaryPreference << " " << preferredCuisine << " food.";
    return out.str();
}

json User::toJson() const {
    return json{
        {"name", name},
        {"dietaryPreference", dietaryPreference},
        {"preferredCuisine", preferredCuisine},
        {"preferences", preferences}
    };
}

User User::fromJson(const json& j) {
    User u;
    u.name = j.value("name", "Guest");
    u.dietaryPreference = j.value("dietaryPreference", "No Preference");
    u.preferredCuisine = j.value("preferredCuisine", "Any");
    if (j.contains("preferences") && j["preferences"].is_array()) {
        for (const auto& p : j["preferences"]) u.preferences.push_back(p.get<std::string>());
    }
    return u;
}
