const test = require('node:test');
const assert = require('node:assert/strict');
const { notFoundHandler, errorHandler, sendEngineError } = require('../../backend/middleware/errorHandler');
const { EngineError } = require('../../backend/services/cppBridge');

// Minimal fake Express response.
function fakeRes() {
  return {
    statusCode: null, body: null, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const quiet = (fn) => async (...a) => {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(...a); } finally { console.error = error; console.warn = warn; }
};

test('404 does not echo the requested URL', () => {
  const res = fakeRes();
  notFoundHandler({ method: 'GET', originalUrl: '/api/<script>alert(1)</script>' }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.stringify(res.body).includes('script'), false);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('malformed JSON body -> 400 INVALID_JSON (was 500)', () => {
  const res = fakeRes();
  errorHandler({ type: 'entity.parse.failed', message: 'Unexpected token } in JSON at position 4' }, {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
  assert.equal(res.body.error.message.includes('Unexpected token'), false);
});

test('oversized body -> 413', () => {
  const res = fakeRes();
  errorHandler({ type: 'entity.too.large' }, {}, res, () => {});
  assert.equal(res.statusCode, 413);
});

test('unexpected error -> generic 500 with no stack, path or message leaked', quiet(() => {
  const res = fakeRes();
  const err = new Error('ENOENT: no such file /home/secret/app/data.json');
  errorHandler(err, {}, res, () => {});
  assert.equal(res.statusCode, 500);
  const body = JSON.stringify(res.body);
  assert.equal(body.includes('/home/secret'), false);
  assert.equal(body.includes('ENOENT'), false);
  assert.equal(body.includes('at '), false);
}));

test('engine timeout -> 504, unavailable -> 503, with public messages only', quiet(() => {
  const r1 = fakeRes();
  sendEngineError(r1, new EngineError('ENGINE_TIMEOUT', 'The recipe engine took too long to respond.', 'internal detail /x/y'));
  assert.equal(r1.statusCode, 504);
  assert.equal(JSON.stringify(r1.body).includes('/x/y'), false);

  const r2 = fakeRes();
  sendEngineError(r2, new EngineError('ENGINE_UNAVAILABLE', 'The recipe engine is not available.', '/opt/app/cpp-core/recipe_engine'));
  assert.equal(r2.statusCode, 503);
  assert.equal(JSON.stringify(r2.body).includes('/opt/app'), false);
}));

test('non-EngineError thrown into sendEngineError still yields a safe response', quiet(() => {
  const res = fakeRes();
  sendEngineError(res, new Error('boom /secret/path'));
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.stringify(res.body).includes('/secret'), false);
}));
