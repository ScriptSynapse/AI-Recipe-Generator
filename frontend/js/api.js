/**
 * api.js
 * ---------------------------------------------------------------------
 * Thin fetch wrapper around the /api/recipes and /api/auth endpoints. Every function
 * returns the parsed JSON body (both success and error envelopes share
 * the same {success, data|error, message} shape from the backend), so
 * callers just check `.success`.
 */

const API_BASE = '/api/recipes';
const AUTH_BASE = '/api/auth';

async function apiRequest(path, options = {}, base = API_BASE) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (networkErr) {
    return {
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'Could not reach the server. Please check your connection and try again.' },
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (parseErr) {
    return {
      success: false,
      error: { code: 'BAD_RESPONSE', message: 'The server returned an unexpected response.' },
    };
  }
  return body;
}

const RecipeAPI = {
  generate(preferences) {
    return apiRequest('/generate', { method: 'POST', body: JSON.stringify(preferences) });
  },

  regenerate(preferences, previousRecipeId, forceAi = false) {
    return apiRequest('/regenerate', {
      method: 'POST',
      body: JSON.stringify({ preferences, previousRecipeId, forceAi }),
    });
  },

  substitute(recipe, ingredient) {
    return apiRequest('/substitute', { method: 'POST', body: JSON.stringify({ recipe, ingredient }) });
  },

  makeHealthier(recipe) {
    return apiRequest('/healthier', { method: 'POST', body: JSON.stringify({ recipe }) });
  },

  changeServings(recipe, servings) {
    return apiRequest('/servings', { method: 'POST', body: JSON.stringify({ recipe, servings }) });
  },

  save(recipe) {
    return apiRequest('/save', { method: 'POST', body: JSON.stringify({ recipe }) });
  },

  list() {
    return apiRequest('/', { method: 'GET' });
  },

  get(id) {
    return apiRequest(`/${encodeURIComponent(id)}`, { method: 'GET' });
  },

  remove(id) {
    return apiRequest(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

// Authentication. The session lives in an HttpOnly cookie that the browser
// attaches by itself; this code never sees or stores the session token.
const AuthAPI = {
  me() {
    return apiRequest('/me', { method: 'GET' }, AUTH_BASE);
  },

  login(username, password) {
    return apiRequest('/login', { method: 'POST', body: JSON.stringify({ username, password }) }, AUTH_BASE);
  },

  register(username, password) {
    return apiRequest('/register', { method: 'POST', body: JSON.stringify({ username, password }) }, AUTH_BASE);
  },

  logout() {
    return apiRequest('/logout', { method: 'POST', body: '{}' }, AUTH_BASE);
  },

  changePassword(currentPassword, newPassword) {
    return apiRequest('/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }, AUTH_BASE);
  },
};

// AI Model Lab. Needs a login; benchmark / analytics are admin-only (the
// server decides -- these calls just surface its answer).
const AiLabAPI = {
  models() {
    return apiRequest('/models', { method: 'GET' }, '/api/ai');
  },

  compare(preferences, mode = 'all', provider) {
    const body = { preferences, mode };
    if (provider) body.provider = provider;
    return apiRequest('/compare', { method: 'POST', body: JSON.stringify(body) }, '/api/ai');
  },

  benchmark(preferences, runs = 1) {
    return apiRequest('/benchmark', { method: 'POST', body: JSON.stringify({ preferences, runs }) }, '/api/admin');
  },

  providers() {
    return apiRequest('/providers', { method: 'GET' }, '/api/admin');
  },

  // filters: { provider, source, since, until, limit } -- only the ones that are set are sent.
  history(filters) {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, String(v)); });
    const qs = params.toString();
    return apiRequest(`/benchmark-history${qs ? `?${qs}` : ''}`, { method: 'GET' }, '/api/admin');
  },

  analytics() {
    return apiRequest('/model-analytics', { method: 'GET' }, '/api/admin');
  },
};

const SecurityAPI = {
  stats(window = '24h') {
    return apiRequest(`/stats?window=${encodeURIComponent(window)}`, { method: 'GET' }, '/api/security');
  },

  events(limit = 20) {
    return apiRequest(`/events?limit=${encodeURIComponent(limit)}`, { method: 'GET' }, '/api/security');
  },
};

// The signed-in user's own activity counters (for the dashboard).
const UsageAPI = {
  me() {
    return apiRequest('/me', { method: 'GET' }, '/api/usage');
  },
};
