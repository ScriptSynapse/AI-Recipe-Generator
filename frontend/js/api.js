/**
 * api.js
 * ---------------------------------------------------------------------
 * Thin fetch wrapper around the /api/recipes endpoints. Every function
 * returns the parsed JSON body (both success and error envelopes share
 * the same {success, data|error, message} shape from the backend), so
 * callers just check `.success`.
 */

const API_BASE = '/api/recipes';

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
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
