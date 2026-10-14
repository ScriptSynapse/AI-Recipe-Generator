/**
 * Loads a route module with a recording stand-in for `express`, so the
 * ROUTE TABLE -- which middleware guards which route, in what order -- can
 * be asserted without Express installed. It tests wiring, not Express.
 *
 * The route modules are evicted from require.cache before AND after, so a
 * module loaded here (holding the fake) can never leak into a test that
 * uses the real Express.
 */
const Module = require('module');
const path = require('path');

function makeFakeExpress() {
  function Router() {
    const r = { routes: [], uses: [] };
    for (const method of ['get', 'post', 'delete', 'put', 'patch']) {
      r[method] = (p, ...handlers) => { r.routes.push({ method: method.toUpperCase(), path: p, handlers }); return r; };
    }
    r.use = (...args) => { r.uses.push(args); return r; };
    return r;
  }
  const express = () => { throw new Error('fake express cannot build an app'); };
  express.Router = Router;
  return express;
}

function evict(files) {
  for (const f of files) delete require.cache[require.resolve(f)];
}

function loadWithFakeExpress(relativeModulePaths) {
  const files = relativeModulePaths.map((p) => path.join(__dirname, '..', '..', 'backend', p));
  evict(files);
  const original = Module._load;
  const fake = makeFakeExpress();
  Module._load = function patched(request, ...rest) {
    return request === 'express' ? fake : original.call(this, request, ...rest);
  };
  try {
    return files.map((f) => require(f));
  } finally {
    Module._load = original;
    evict(files);
  }
}

/** A requirePermission/rate-limit stand-in whose handlers identify themselves. */
const tag = (kind, name) => { const fn = (req, res, next) => next(); fn.tag = `${kind}:${name}`; return fn; };

/** The table as [ 'GET /models', ['perm:ai-lab:use', 'handler'] ] pairs. */
function describeRoutes(router) {
  return router.routes.map((r) => [`${r.method} ${r.path}`, r.handlers.map((h) => h.tag || 'handler')]);
}

module.exports = { loadWithFakeExpress, tag, describeRoutes };
