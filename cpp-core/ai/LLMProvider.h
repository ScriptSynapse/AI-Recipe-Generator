#ifndef LLM_PROVIDER_H
#define LLM_PROVIDER_H

#include <atomic>
#include <stdexcept>
#include <string>

class SecurityEventManager;   // defined in security/events; only a pointer is needed here

/*
 * ProviderStatus
 * -----------------------------------------------------------------------
 * The health of one provider as the UI/dashboard reports it (Phase 20).
 * "ApiKeyMissing" is reported by providers whose credentials are not
 * configured; the others are derived from the outcome of the last call.
 */
enum class ProviderStatus {
    Available,
    Unavailable,
    ApiKeyMissing,
    Timeout,
    RateLimited
};

inline const char* toString(ProviderStatus s) {
    switch (s) {
        case ProviderStatus::Available:     return "AVAILABLE";
        case ProviderStatus::Unavailable:   return "UNAVAILABLE";
        case ProviderStatus::ApiKeyMissing: return "API_KEY_MISSING";
        case ProviderStatus::Timeout:       return "TIMEOUT";
        case ProviderStatus::RateLimited:   return "RATE_LIMITED";
    }
    return "UNAVAILABLE";
}

/*
 * LLMErrorKind / LLMException
 * -----------------------------------------------------------------------
 * The single error vocabulary every provider adapter translates its
 * vendor-specific failures into (HTTP 429, curl timeout, malformed body,
 * missing key ...). Callers (AIGenerator now; AIOrchestrator / ModelRouter
 * later) branch on `kind`, never on vendor details -- this is what lets the
 * rest of the application ignore which API sits behind the interface.
 *
 * SECURITY: messages must never contain API keys, request headers or full
 * upstream response bodies. Adapters pass short, sanitized text only.
 */
enum class LLMErrorKind {
    ApiKeyMissing,
    Timeout,
    RateLimited,
    Network,
    HttpError,
    BadResponse,
    Unavailable
};

class LLMException : public std::runtime_error {
private:
    LLMErrorKind kind;
    int httpStatus;

public:
    LLMException(LLMErrorKind kind_, const std::string& message, int httpStatus_ = 0)
        : std::runtime_error(message), kind(kind_), httpStatus(httpStatus_) {}

    LLMErrorKind getKind() const { return kind; }
    int getHttpStatus() const { return httpStatus; }

    // Maps an error kind to the status the provider should report next.
    static ProviderStatus statusFor(LLMErrorKind k) {
        switch (k) {
            case LLMErrorKind::ApiKeyMissing: return ProviderStatus::ApiKeyMissing;
            case LLMErrorKind::Timeout:       return ProviderStatus::Timeout;
            case LLMErrorKind::RateLimited:   return ProviderStatus::RateLimited;
            default:                          return ProviderStatus::Unavailable;
        }
    }
};

/*
 * LLMProvider (abstract interface -- the Strategy in the Strategy pattern)
 * -----------------------------------------------------------------------
 * Every concrete provider (Claude, Gemini, OpenAI, Groq, Local) implements
 * this contract, so they are interchangeable behind a base pointer. Each
 * concrete class is also an Adapter: it converts this uniform
 * prompt-in / text-out call into its vendor's request and response format.
 *
 *  - generate()        pure virtual; sends the prompt, returns the model's
 *                      raw text. Throws LLMException on any failure.
 *  - getProviderName() pure virtual; stable id such as "claude".
 *  - getModelName()    pure virtual; the model actually configured.
 *  - isAvailable()     pure virtual; true only if the provider is
 *                      configured and usable (e.g. key present).
 *  - getStatus()       virtual with a default body (overridable, e.g. to
 *                      report ApiKeyMissing): last observed health.
 *
 * Health tracking lives here once, instead of being copied into five
 * providers: implementations call recordSuccess()/recordFailure() around
 * their network call. The status is atomic because Phase E runs providers
 * on worker threads while the dashboard may read their status.
 */
class LLMProvider {
private:
    std::atomic<ProviderStatus> lastStatus{ProviderStatus::Available};

protected:
    void recordSuccess() { lastStatus = ProviderStatus::Available; }
    void recordFailure(const LLMException& e) { lastStatus = LLMException::statusFor(e.getKind()); }

public:
    virtual ~LLMProvider() = default;

    virtual std::string generate(const std::string& prompt) = 0;
    virtual std::string getProviderName() const = 0;
    virtual std::string getModelName() const = 0;
    virtual bool isAvailable() const = 0;

    virtual ProviderStatus getStatus() const {
        return isAvailable() ? lastStatus.load() : ProviderStatus::Unavailable;
    }

    // Lets a provider report failures to the audit trail. Optional: the
    // default does nothing, so a provider that has nothing to report (or a
    // test double) needs no change. `manager` may be null and is NOT owned.
    // Composite providers (ModelRouter) override this to pass it on.
    virtual void setEventManager(SecurityEventManager* manager) { (void)manager; }
};

#endif // LLM_PROVIDER_H
