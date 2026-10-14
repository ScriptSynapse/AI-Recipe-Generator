/**
 * In-memory stand-in for the C++ recipe engine (the `runEngine` function),
 * mirroring the real engine's response envelopes and the storage rules
 * that matter for authorization tests:
 *   - save keeps a client-supplied id only if it is safe AND not already
 *     taken; otherwise it generates a fresh one (so one user can never
 *     overwrite another's record by guessing an id);
 *   - list is newest-first;
 *   - get/delete of an unknown id -> NOT_FOUND.
 * It also records which commands were called, so tests can assert that
 * e.g. a non-owner's delete never reached the engine.
 *
 * Real-engine behavior is covered separately by tests that run against
 * the compiled binary (skipped when it isn't built).
 */
const crypto = require('crypto');

const ok = (data, message) => ({ success: true, data, message });
const fail = (code, message) => ({ success: false, error: { code, message } });

const defaultComparison = (mode = 'all') => ({
  mode: mode.toUpperCase(), fastest: 'local', best: 'local', recommended: null,
  models: [
    { provider: 'claude', model: 'claude-x', status: 'SKIPPED', durationMs: 0, isBaseline: false, error: 'claude is not configured or unavailable.' },
    { provider: 'local', model: 'llama-x', status: 'SUCCESS', durationMs: 420, isBaseline: false,
      recipe: { name: 'Curry' }, evaluation: { overallScore: 88, warnings: [] } },
    { provider: 'offline-template', model: 'built-in templates', status: 'BASELINE', durationMs: 1, isBaseline: true,
      recipe: { name: 'Template curry' }, evaluation: { overallScore: 100, warnings: [] } },
  ],
});

class FakeEngine {
  constructor() {
    this.store = [];       // saved records, oldest first (same as the real file)
    this.calls = [];       // command names, in order
    this.pendingEvents = []; // extra securityEvents to attach to the NEXT response (for odd cases)
    this.runEngine = this.runEngine.bind(this);
  }

  // Like the real engine, any security events ride along on the response
  // as a `securityEvents` array.
  async runEngine(command, payload = {}) {
    const response = await this._dispatch(command, payload);
    if (this.pendingEvents.length > 0) {
      const withEvents = { ...response, securityEvents: [...(response.securityEvents || []), ...this.pendingEvents] };
      this.pendingEvents = [];
      return withEvents;
    }
    return response;
  }

  async _dispatch(command, payload) {
    this.calls.push(command);
    switch (command) {
      case 'save': return this._save(payload.recipe);
      case 'list': return ok({ recipes: [...this.store].reverse() }, 'Saved recipes retrieved.');
      case 'get': {
        const found = this.store.find((r) => r.id === payload.id);
        return found ? ok({ recipe: found }, 'Recipe retrieved.') : fail('NOT_FOUND', 'No saved recipe with that id.');
      }
      case 'delete': {
        const before = this.store.length;
        this.store = this.store.filter((r) => r.id !== payload.id);
        return this.store.length === before ? fail('NOT_FOUND', 'No saved recipe with that id.')
          : ok({ id: payload.id }, 'Recipe deleted.');
      }
      case 'health':
        return ok({
          status: 'ok', databaseRecipeCount: 20, aiApiKeyConfigured: true, aiModel: 'secret-model-name',
          aiProviders: [{ provider: 'claude', status: 'API_KEY_MISSING' }, { provider: 'local', status: 'AVAILABLE' }],
        }, 'C++ recipe engine is healthy.');
      case 'generate': return this._generate(payload.preferences);
      case 'models': return ok({ models: [
        { provider: 'claude', model: 'claude-x', status: 'API_KEY_MISSING', available: false },
        { provider: 'local', model: 'llama-x', status: 'AVAILABLE', available: true }] }, 'Model list.');
      case 'compare': return this._compare(payload);
      case 'customize': return ok({ recipe: payload.recipe }, 'Recipe customized successfully.');
      default: return fail('UNKNOWN_COMMAND', 'Unknown command.');
    }
  }

  // Scripted comparison. Set `engine.comparison` to control the report; the
  // injection / XSS input rules mirror the real pipeline (action 'compare').
  _compare(payload) {
    const r = this._generate(payload.preferences);
    if (!r.success) {
      return { ...r, securityEvents: r.securityEvents.map((e) => ({ ...e, action: 'compare' })) };
    }
    if (payload.mode && !['all', 'fastest', 'best', 'single'].includes(payload.mode)) {
      return fail('INVALID_MODE', 'mode must be one of: all, fastest, best, single.');
    }
    if (payload.mode === 'single' && payload.provider === 'nope') return fail('INVALID_PROVIDER', 'Unknown provider.');
    this.compareCalls = (this.compareCalls || 0) + 1;
    return { ...ok({ comparison: this.comparison || defaultComparison(payload.mode) }, 'Models compared.'), securityEvents: r.securityEvents.map((e) => ({ ...e, action: 'compare' })) };
  }

  _save(recipe) {
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return fail('INVALID_ARGUMENT', 'Recipe must be a JSON object.');
    if (typeof recipe.name !== 'string' || recipe.name === '') return fail('INVALID_ARGUMENT', 'Recipe must have a non-empty text name.');
    const saved = { ...recipe, savedAt: new Date().toISOString() };
    const idIsUsable = typeof saved.id === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(saved.id)
      && !this.store.some((r) => r.id === saved.id);
    if (!idIsUsable) saved.id = `saved-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.store.push(saved);
    return ok({ recipe: saved }, 'Recipe saved successfully.');
  }

  // Emulates the security pipeline: its rejection codes (Phases I and J)
  // and the events the real engine attaches (Phase M).
  _generate(preferences) {
    const text = ((preferences && preferences.ingredients) || []).join(', ').toLowerCase();
    const event = (type, severity, result, reason, details = {}) => ({ type, severity, action: 'generate', result, reason, details });
    if (text.includes('ignore previous instructions')) {
      return { ...fail('PROMPT_INJECTION_SUSPECTED', 'Potential instruction override detected.'), securityEvents: [
        event('PROMPT_INJECTION', 'HIGH', 'BLOCKED', 'Potential instruction override detected.', { matchedCategories: ['INSTRUCTION_OVERRIDE'] })] };
    }
    if (text.includes('<script')) {
      return { ...fail('XSS_SUSPECTED', 'Potential script tag injection detected.'), securityEvents: [
        event('XSS_ATTEMPT', 'HIGH', 'BLOCKED', 'Potential script tag injection detected.', { matchedPatterns: ['SCRIPT_TAG'] })] };
    }
    return { ...ok({ recipe: { id: 'gen-1', name: 'Generated', ingredients: [], instructions: [] } }, 'ok'), securityEvents: [
      event('SECURITY_SCAN', 'INFO', 'SUCCESS', 'Input security scan completed with no findings.', { checks: [] })] };
  }
}

module.exports = { FakeEngine };
