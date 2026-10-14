#ifndef SECURITY_EVENT_OBSERVER_H
#define SECURITY_EVENT_OBSERVER_H

#include "SecurityEvent.h"

/*
 * SecurityEventObserver -- the Observer interface. Anything that wants to
 * be told about security events (the response collector now; a dashboard
 * or alerting component later) implements this and is attached to a
 * SecurityEventManager.
 */
class SecurityEventObserver {
public:
    virtual ~SecurityEventObserver() = default;
    virtual void onSecurityEvent(const SecurityEvent& event) = 0;
};

#endif // SECURITY_EVENT_OBSERVER_H
