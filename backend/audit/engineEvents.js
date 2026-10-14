/**
 * The C++ engine reports security events by adding a `securityEvents`
 * array to its response. This helper does two things with it:
 *
 *   1. publishes each event on the app's event bus, tagged with what only
 *      the Node layer knows (request id, authenticated user, client IP) --
 *      the audit logger picks them up from there;
 *   2. returns the response WITHOUT that array, so clients never see
 *      internal events (provider failures, which providers are configured,
 *      scanner categories, ...).
 *
 * At most MAX_EVENTS_PER_RESPONSE are published per response, so a faulty
 * or hostile engine build cannot flood the log through a single request.
 */
const MAX_EVENTS_PER_RESPONSE = 50;

function consumeEngineEvents(result, req) {
  if (!result || typeof result !== 'object' || !('securityEvents' in result)) return result;

  const { securityEvents, ...clean } = result;
  const bus = req && req.app && req.app.locals && req.app.locals.events;
  if (bus && Array.isArray(securityEvents)) {
    const userId = req.auth && req.auth.user ? req.auth.user.id : null;
    for (const event of securityEvents.slice(0, MAX_EVENTS_PER_RESPONSE)) {
      bus.emit('security.engine_event', { event, requestId: req.id, userId, ip: req.ip });
    }
  }
  return clean;
}

module.exports = { consumeEngineEvents, MAX_EVENTS_PER_RESPONSE };
