#ifndef SECURITY_EVENT_MANAGER_H
#define SECURITY_EVENT_MANAGER_H

#include <memory>
#include <vector>
#include "SecurityEvent.h"
#include "SecurityEventObserver.h"

/*
 * SecurityEventManager -- the Subject in the Observer pattern.
 *
 * Providers, AIGenerator and the security pipeline call emit() without
 * knowing, or caring, who is listening. Observers are told in the order
 * they were attached.
 *
 * emit() NEVER throws: recording a security event must not be able to
 * break the request that triggered it, and one faulty observer must not
 * stop the others from being told.
 *
 * Components hold a plain (non-owning) SecurityEventManager* that may be
 * null, meaning "nobody is listening" -- an association, not ownership:
 * the manager is created by whoever handles the request (main.cpp) and
 * outlives the components it is handed to.
 */
class SecurityEventManager {
public:
    void attach(std::shared_ptr<SecurityEventObserver> observer) {
        if (observer) observers.push_back(std::move(observer));
    }

    void emit(const SecurityEvent& event) const {
        for (const auto& observer : observers) {
            try {
                observer->onSecurityEvent(event);
            } catch (...) {
                // deliberately swallowed -- see class comment
            }
        }
    }

    size_t observerCount() const { return observers.size(); }

private:
    std::vector<std::shared_ptr<SecurityEventObserver>> observers;
};

#endif // SECURITY_EVENT_MANAGER_H
