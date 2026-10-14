/**
 * HTTP handlers for the AI Model Lab. Thin: validate the request shape,
 * hand it to the C++ engine (which runs the SAME security pipeline as normal
 * generation), record the measured outcome, return it. Raw model output is
 * never in the response: the engine only returns validated recipes.
 */
const { consumeEngineEvents } = require('../audit/engineEvents');
const { sendEngineError, errorBody } = require('../middleware/errorHandler');
const { emitHttpEvent } = require('../audit/requestContext');
const { statusForErrorCode } = require('./recipeController');

const MODES = new Set(['all', 'fastest', 'best', 'single']);
const PROVIDER_NAME = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BENCHMARK_RUNS = 3;
const HISTORY_SOURCES = new Set(['lab', 'benchmark']);
const MAX_HISTORY = 100;

/** Query-string check for the history endpoint. Returns { filters } or { problem } (fixed text, never the value). */
function parseHistoryQuery(query) {
  const q = query || {};
  const filters = { limit: 50 };
  const one = (v) => (typeof v === 'string' ? v : null);   // arrays/objects (?a=1&a=2) are refused
  if (q.provider !== undefined) {
    if (one(q.provider) === null || !PROVIDER_NAME.test(q.provider)) return { problem: 'Invalid provider filter.' };
    filters.provider = q.provider;
  }
  if (q.source !== undefined) {
    if (one(q.source) === null || !HISTORY_SOURCES.has(q.source)) return { problem: 'Invalid source filter.' };
    filters.source = q.source;
  }
  for (const [key, out, endOfDay] of [['since', 'sinceMs', false], ['until', 'untilMs', true]]) {
    if (q[key] === undefined) continue;
    const v = one(q[key]);
    if (v === null || !/^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z)?$/.test(v)) return { problem: 'Invalid date filter.' };
    let ms = Date.parse(v);
    if (Number.isNaN(ms)) return { problem: 'Invalid date filter.' };
    if (endOfDay && v.length === 10) ms += 24 * 60 * 60 * 1000 - 1;      // a plain date means "through that whole day"
    filters[out] = ms;
  }
  if (q.limit !== undefined) {
    const n = Number(one(q.limit));
    if (one(q.limit) === null || !/^\d{1,3}$/.test(q.limit) || n < 1 || n > MAX_HISTORY) return { problem: 'Invalid limit.' };
    filters.limit = n;
  }
  return { filters };
}

function reject(req, res, message) {
  emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_REQUEST_SHAPE', status: 400 });
  return res.status(400).json(errorBody('INVALID_REQUEST_SHAPE', message));
}

/** Shape check for the Lab's request body. Returns an error string or null. */
function validateCompareBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'A JSON object is required.';
  const p = body.preferences;
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.ingredients)) {
    return '"preferences" with an "ingredients" array is required.';
  }
  if (body.mode !== undefined && (typeof body.mode !== 'string' || !MODES.has(body.mode))) {
    return '"mode" must be one of: all, fastest, best, single.';
  }
  if (body.provider !== undefined && (typeof body.provider !== 'string' || !PROVIDER_NAME.test(body.provider))) {
    return '"provider" must be a short provider name.';
  }
  if (body.mode === 'single' && body.provider === undefined) return '"provider" is required when mode is "single".';
  return null;
}

function createAiController({ runEngine, analytics, logger = console }) {
  async function callEngine(req, command, payload) {
    return consumeEngineEvents(await runEngine(command, payload), req);
  }

  // Analytics must never break a request: a full disk loses a data point, not the response.
  function safeRecord(comparison, source) {
    try { return analytics.record(comparison, { source }); } catch (err) {
      logger.error(`[ai-lab] could not record analytics: ${err.name}`);
      return null;
    }
  }

  const fail = (res, result) => res.status(statusForErrorCode(result.error && result.error.code)).json(result);

  return {
    validateCompareBody,

    // Which models exist and whether each is usable. Names + availability only.
    listModels: async (req, res) => {
      try {
        const result = await callEngine(req, 'models', {});
        if (!result.success) return fail(res, result);
        const models = ((result.data && result.data.models) || []).map((m) => ({
          provider: String(m.provider), model: String(m.model), available: m.available === true,
        }));
        return res.status(200).json({ success: true, data: { models } });
      } catch (err) { return sendEngineError(res, err); }
    },

    // Admin: the same list with each provider's detailed status.
    adminProviderStatus: async (req, res) => {
      try {
        return res.status(200).json(await callEngine(req, 'models', {}));
      } catch (err) { return sendEngineError(res, err); }
    },

    compare: async (req, res) => {
      const problem = validateCompareBody(req.body);
      if (problem) return reject(req, res, problem);
      const { preferences, mode = 'all', provider } = req.body;
      try {
        const result = await callEngine(req, 'compare', { preferences, mode, ...(provider ? { provider } : {}) });
        if (!result.success) return fail(res, result);
        const comparison = result.data && result.data.comparison;
        const comparisonId = safeRecord(comparison, 'lab');
        return res.status(200).json({ success: true, data: { comparison, comparisonId } });
      } catch (err) { return sendEngineError(res, err); }
    },

    // Admin: repeat the comparison `runs` times (sequentially -- each is its
    // own engine call with its own timeout) and report what was measured.
    benchmark: async (req, res) => {
      const problem = validateCompareBody({ ...req.body, mode: 'all', provider: undefined });
      if (problem) return reject(req, res, problem);
      let runs = req.body.runs === undefined ? 1 : req.body.runs;
      if (!Number.isInteger(runs) || runs < 1 || runs > MAX_BENCHMARK_RUNS) {
        return reject(req, res, `"runs" must be a whole number from 1 to ${MAX_BENCHMARK_RUNS}.`);
      }
      const perProvider = new Map();
      const comparisons = [];
      try {
        for (let i = 0; i < runs; i += 1) {
          const result = await callEngine(req, 'compare', { preferences: req.body.preferences, mode: 'all' });
          if (!result.success) return fail(res, result);            // e.g. blocked by the security pipeline
          const comparison = result.data && result.data.comparison;
          safeRecord(comparison, 'benchmark');
          comparisons.push({ best: comparison.best, fastest: comparison.fastest });
          for (const m of comparison.models || []) {
            if (m.status === 'BASELINE') continue;
            const row = perProvider.get(m.provider) || { provider: m.provider, model: m.model, runs: 0, successes: 0, skipped: 0, latency: [], scores: [] };
            if (m.status === 'SKIPPED') row.skipped += 1;
            else {
              row.runs += 1;
              if (m.status === 'SUCCESS') {
                row.successes += 1;
                if (typeof m.durationMs === 'number') row.latency.push(m.durationMs);
                if (m.evaluation && typeof m.evaluation.overallScore === 'number') row.scores.push(m.evaluation.overallScore);
              }
            }
            perProvider.set(m.provider, row);
          }
        }
      } catch (err) { return sendEngineError(res, err); }

      const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
      const models = [...perProvider.values()].map((r) => ({
        provider: r.provider, model: r.model, runs: r.runs, skipped: r.skipped,
        successRate: r.runs ? Math.round((r.successes / r.runs) * 100) : null,
        avgLatencyMs: avg(r.latency), avgScore: avg(r.scores),
      }));
      return res.status(200).json({ success: true, data: { runs, models } });
    },

    // Admin: past runs (Lab comparisons and benchmarks) with per-model measurements.
    history: (req, res) => {
      const { filters, problem } = parseHistoryQuery(req.query);
      if (problem) {
        emitHttpEvent(req, 'http.invalid_input', { code: 'INVALID_QUERY', status: 400 });
        return res.status(400).json(errorBody('INVALID_QUERY', problem));
      }
      try {
        return res.status(200).json({ success: true, data: { runs: analytics.history(filters) } });
      } catch (err) {
        logger.error(`[ai-lab] history unreadable: ${err.name}`);
        return res.status(500).json(errorBody('INTERNAL_ERROR', 'Benchmark history is not available.'));
      }
    },

    // Admin: lifetime numbers from everything recorded so far.
    analytics: (req, res) => {
      try {
        return res.status(200).json({ success: true, data: analytics.summary() });
      } catch (err) {
        logger.error(`[ai-lab] analytics unreadable: ${err.name}`);
        return res.status(500).json(errorBody('INTERNAL_ERROR', 'Analytics are not available.'));
      }
    },
  };
}

module.exports = { createAiController, validateCompareBody, parseHistoryQuery, MAX_BENCHMARK_RUNS };
