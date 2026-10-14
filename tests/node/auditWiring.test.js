const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { attachAuditLogger, MAPPINGS } = require('../../backend/audit/auditLogger');
const { consumeEngineEvents, MAX_EVENTS_PER_RESPONSE } = require('../../backend/audit/engineEvents');
const { loggablePath, requestContext, emitHttpEvent } = require('../../backend/audit/requestContext');
const requestId = require('../../backend/middleware/requestId');
const { EVENT_TYPES, SEVERITIES, RESULTS, isEventType, isSeverity, isResult } = require('../../backend/audit/auditEvents');

// A stand-in audit log that just remembers what it is asked to record.
const fakeLog = () => { const records = []; return { records, record: (r) => { records.push(r); return r; } }; };
function wire() {
  const events = new EventEmitter(); const log = fakeLog(); const errors = [];
  const detach = attachAuditLogger({ events, auditLog: log, logger: { error: (m) => errors.push(m) } });
  return { events, log, errors, detach };
}

// ---- the Observer: bus events -> audit records ------------------------------------------------

test('login failure -> AUTH_FAILURE/LOW carrying the cause and identity, never a username', () => {
  const { events, log } = wire();
  events.emit('auth.login_failure', { reason: 'BAD_PASSWORD', userId: 'u-1', ip: '1.2.3.4', requestId: 'r-1' });
  events.emit('auth.login_failure', { reason: 'UNKNOWN_USER', usernameFingerprint: 'abc123def456', ip: '1.2.3.4', requestId: 'r-2' });
  const [known, unknown] = log.records;
  assert.deepEqual([known.type, known.severity, known.action, known.result], ['AUTH_FAILURE', 'LOW', 'login', 'FAILURE']);
  assert.equal(known.userId, 'u-1');
  assert.deepEqual(known.details, { cause: 'BAD_PASSWORD', usernameFingerprint: undefined });
  assert.equal(unknown.details.usernameFingerprint, 'abc123def456');
  assert.equal(unknown.userId, undefined);
  assert.equal(known.requestId, 'r-1');
});

test('successful login, registration and logout -> AUTH_SUCCESS/INFO with the right action', () => {
  const { events, log } = wire();
  events.emit('auth.login_success', { userId: 'u-1', requestId: 'r' });
  events.emit('auth.registered', { userId: 'u-1', requestId: 'r' });
  events.emit('auth.logout', { userId: 'u-1', requestId: 'r' });
  assert.deepEqual(log.records.map((r) => [r.type, r.severity, r.action, r.result]),
    [['AUTH_SUCCESS', 'INFO', 'login', 'SUCCESS'], ['AUTH_SUCCESS', 'INFO', 'register', 'SUCCESS'], ['AUTH_SUCCESS', 'INFO', 'logout', 'SUCCESS']]);
});

test('401 and 403 -> UNAUTHORIZED_ACCESS (LOW vs MEDIUM), DENIED, with the route and the permission', () => {
  const { events, log } = wire();
  events.emit('auth.unauthenticated_access', { method: 'GET', path: '/api/recipes', ip: '9.9.9.9', requestId: 'r-1' });
  events.emit('authz.denied', { userId: 'u-1', role: 'USER', permission: 'admin:audit-log:read', method: 'GET', path: '/api/admin/audit-log', requestId: 'r-2' });
  const [anon, denied] = log.records;
  assert.deepEqual([anon.type, anon.severity, anon.result, anon.action], ['UNAUTHORIZED_ACCESS', 'LOW', 'DENIED', 'GET /api/recipes']);
  assert.deepEqual([denied.type, denied.severity, denied.result, denied.userId], ['UNAUTHORIZED_ACCESS', 'MEDIUM', 'DENIED', 'u-1']);
  assert.deepEqual(denied.details, { permission: 'admin:audit-log:read', role: 'USER' });
});

test('a role change -> PRIVILEGE_CHANGE/HIGH naming who, from and to', () => {
  const { events, log } = wire();
  events.emit('auth.role_changed', { userId: 'u-1', from: 'USER', to: 'ADMIN', actor: 'operator-cli' });
  assert.deepEqual([log.records[0].type, log.records[0].severity, log.records[0].action], ['PRIVILEGE_CHANGE', 'HIGH', 'role_change']);
  assert.deepEqual(log.records[0].details, { from: 'USER', to: 'ADMIN', actor: 'operator-cli' });
});

test('malformed requests -> INVALID_INPUT/LOW/REJECTED with the code and status', () => {
  const { events, log } = wire();
  events.emit('http.invalid_input', { code: 'INVALID_JSON', status: 400, method: 'POST', path: '/api/auth/login', requestId: 'r' });
  assert.deepEqual([log.records[0].type, log.records[0].severity, log.records[0].result], ['INVALID_INPUT', 'LOW', 'REJECTED']);
  assert.deepEqual(log.records[0].details, { code: 'INVALID_JSON', status: 400 });
});

test('engine events are recorded as the engine described them, tagged with the request, user and IP', () => {
  const { events, log } = wire();
  const event = { type: 'PROMPT_INJECTION', severity: 'HIGH', action: 'generate', result: 'BLOCKED', reason: 'Potential instruction override detected.', provider: 'claude', details: { matchedCategories: ['INSTRUCTION_OVERRIDE'] } };
  events.emit('security.engine_event', { event, requestId: 'r-9', userId: 'u-3', ip: '5.6.7.8' });
  assert.deepEqual(log.records[0], {
    requestId: 'r-9', userId: 'u-3', ip: '5.6.7.8', type: 'PROMPT_INJECTION', severity: 'HIGH', action: 'generate', result: 'BLOCKED',
    reason: 'Potential instruction override detected.', provider: 'claude', details: { matchedCategories: ['INSTRUCTION_OVERRIDE'] },
  });
});

test('an UNRECOGNISED engine event is kept as a MEDIUM anomaly, and none of its fields are trusted', () => {
  const { events, log } = wire();
  for (const event of [
    { type: 'BRAND_NEW_TYPE', severity: 'HIGH', result: 'BLOCKED', reason: 'secret-looking text' },
    { type: 'PROMPT_INJECTION', severity: 'CATASTROPHIC', result: 'BLOCKED' },
    { type: 'PROMPT_INJECTION', severity: 'HIGH', result: 'MAYBE' },
    {}, null, 'a string',
  ]) events.emit('security.engine_event', { event, requestId: 'r' });
  assert.equal(log.records.length, 6);
  for (const r of log.records) {
    assert.deepEqual([r.type, r.severity, r.result], ['SECURITY_SCAN', 'MEDIUM', 'FAILURE']);
    assert.equal(r.reason, 'Unrecognised security event received from the engine.');
    assert.equal(JSON.stringify(r).includes('secret-looking'), false);
  }
});

test('every mapping produces only values the audit log accepts', () => {
  for (const [name, map] of Object.entries(MAPPINGS)) {
    const record = map({ event: { type: 'XSS_ATTEMPT', severity: 'HIGH', result: 'BLOCKED' }, method: 'GET', path: '/x' });
    assert.ok(isEventType(record.type), `${name}: type`);
    assert.ok(isSeverity(record.severity), `${name}: severity`);
    assert.ok(isResult(record.result), `${name}: result`);
  }
  assert.ok(Object.values(EVENT_TYPES).every(isEventType) && Object.values(SEVERITIES).every(isSeverity) && Object.values(RESULTS).every(isResult));
});

test('an empty or missing payload never throws; a failure to record is reported loudly, not propagated', () => {
  const { events, log } = wire();
  assert.doesNotThrow(() => events.emit('auth.login_failure'));
  assert.doesNotThrow(() => events.emit('authz.denied', null));
  assert.equal(log.records.length, 2);

  const bus = new EventEmitter(); const errors = [];
  attachAuditLogger({ events: bus, auditLog: { record() { throw new Error('disk full'); } }, logger: { error: (m) => errors.push(m) } });
  assert.doesNotThrow(() => bus.emit('auth.login_success', { userId: 'u' }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /FAILED to record "auth\.login_success".*gap.*disk full/);
});

test('detaching stops recording', () => {
  const { events, log, detach } = wire();
  events.emit('auth.logout', { userId: 'u' });
  detach();
  events.emit('auth.logout', { userId: 'u' });
  assert.equal(log.records.length, 1);
  assert.equal(events.listenerCount('auth.logout'), 0);
});

// ---- engine events: consume and strip -------------------------------------------------------------

function reqWithBus(extra = {}) {
  const bus = new EventEmitter(); const seen = [];
  bus.on('security.engine_event', (p) => seen.push(p));
  return { req: { id: 'req-5', ip: '1.1.1.1', auth: { user: { id: 'u-7' } }, app: { locals: { events: bus } }, ...extra }, seen };
}

test('consumeEngineEvents: strips securityEvents, publishes each with request context, leaves the rest untouched', () => {
  const { req, seen } = reqWithBus();
  const original = { success: true, data: { recipe: { name: 'X' } }, message: 'ok', securityEvents: [{ type: 'SECURITY_SCAN' }, { type: 'MODEL_FAILURE' }] };
  const clean = consumeEngineEvents(original, req);
  assert.deepEqual(clean, { success: true, data: { recipe: { name: 'X' } }, message: 'ok' });
  assert.equal('securityEvents' in clean, false);
  assert.equal('securityEvents' in original, true, 'the input object is not mutated');
  assert.deepEqual(seen.map((p) => p.event.type), ['SECURITY_SCAN', 'MODEL_FAILURE']);
  assert.deepEqual([seen[0].requestId, seen[0].userId, seen[0].ip], ['req-5', 'u-7', '1.1.1.1']);
});

test('consumeEngineEvents: anonymous callers get userId null; error responses are handled the same way', () => {
  const { req, seen } = reqWithBus({ auth: null });
  const clean = consumeEngineEvents({ success: false, error: { code: 'XSS_SUSPECTED' }, securityEvents: [{ type: 'XSS_ATTEMPT' }] }, req);
  assert.deepEqual(clean, { success: false, error: { code: 'XSS_SUSPECTED' } });
  assert.equal(seen[0].userId, null);
});

test('consumeEngineEvents: responses without events pass through as the same object; junk is stripped; no bus is fine', () => {
  const { req } = reqWithBus();
  const plain = { success: true, data: {} };
  assert.equal(consumeEngineEvents(plain, req), plain);
  assert.equal(consumeEngineEvents(null, req), null);
  assert.equal(consumeEngineEvents('text', req), 'text');
  assert.deepEqual(consumeEngineEvents({ success: true, securityEvents: 'not an array' }, req), { success: true });
  assert.deepEqual(consumeEngineEvents({ success: true, securityEvents: [{ type: 'X' }] }, { id: 'r', app: { locals: {} } }), { success: true });
  assert.deepEqual(consumeEngineEvents({ success: true, securityEvents: [{ type: 'X' }] }, undefined), { success: true });
});

test('consumeEngineEvents: one response can publish at most MAX_EVENTS_PER_RESPONSE events', () => {
  const { req, seen } = reqWithBus();
  consumeEngineEvents({ success: true, securityEvents: Array.from({ length: 500 }, () => ({ type: 'SECURITY_SCAN' })) }, req);
  assert.equal(seen.length, MAX_EVENTS_PER_RESPONSE);
  assert.equal(MAX_EVENTS_PER_RESPONSE, 50);
});

// ---- request ids and request context ---------------------------------------------------------------

test('requestId: generates a fresh uuid per request, exposes it as a header, and never trusts the client\'s', () => {
  const headers = {}; const res = { setHeader: (k, v) => { headers[k] = v; } };
  const a = { headers: { 'x-request-id': 'forged-by-client\ninjected' } };
  const b = {};
  let nexts = 0;
  requestId(a, res, () => { nexts += 1; });
  const firstHeader = headers['X-Request-Id'];
  requestId(b, res, () => { nexts += 1; });
  assert.equal(nexts, 2);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(firstHeader, a.id);
  assert.equal(a.id.includes('forged'), false);
});

test('loggablePath drops the query string and bounds the length; requestContext describes the request', () => {
  assert.equal(loggablePath({ originalUrl: '/api/x?token=secret&a=1' }), '/api/x');
  assert.ok(loggablePath({ originalUrl: `/${'a'.repeat(1000)}` }).length <= 200);
  assert.equal(loggablePath({}), '');
  assert.deepEqual(requestContext({ id: 'r', ip: '1.2.3.4', method: 'POST', originalUrl: '/p?q=1', auth: { user: { id: 'u' } } }),
    { requestId: 'r', ip: '1.2.3.4', method: 'POST', path: '/p', userId: 'u' });
  assert.equal(requestContext({ originalUrl: '/p' }).userId, null);
});

test('emitHttpEvent: publishes with request context when a bus exists, and is silent when it does not', () => {
  const bus = new EventEmitter(); const seen = [];
  bus.on('http.invalid_input', (p) => seen.push(p));
  emitHttpEvent({ id: 'r', method: 'GET', originalUrl: '/x?y=1', app: { locals: { events: bus } } }, 'http.invalid_input', { code: 'C', status: 400 });
  assert.deepEqual(seen[0], { requestId: 'r', ip: undefined, method: 'GET', path: '/x', userId: null, code: 'C', status: 400 });
  assert.doesNotThrow(() => emitHttpEvent({ id: 'r' }, 'x', {}));
  assert.doesNotThrow(() => emitHttpEvent(undefined, 'x', {}));
});
