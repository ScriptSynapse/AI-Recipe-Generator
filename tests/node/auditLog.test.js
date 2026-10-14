const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sanitizeText, sanitizeDetails } = require('../../backend/audit/sanitize');
const { SecurityAuditLog } = require('../../backend/audit/SecurityAuditLog');
const { EVENT_TYPES, SEVERITIES, RESULTS } = require('../../backend/audit/auditEvents');

// ---- sanitize ------------------------------------------------------------------------------

test('sanitize: keys that look like secrets are dropped at any depth, whatever their case', () => {
  const out = sanitizeDetails({
    ok: 'keep', password: 'hunter2', Password: 'x', newPassword: 'x', passwd: 'x', token: 'abc', sessionToken: 'x',
    Authorization: 'Bearer x', cookie: 'a=b', apiKey: 'k', api_key: 'k', 'api-key': 'k', secret: 's', clientSecret: 's',
    credentials: 'c', sessionId: 's', bearer: 'b',
    nested: { deep: 'keep', password: 'hunter2', inner: { token: 't', fine: 1 } },
    list: [{ password: 'p', name: 'keep' }],
  });
  assert.deepEqual(out, { ok: 'keep', nested: { deep: 'keep', inner: { fine: 1 } }, list: [{ name: 'keep' }] });
  assert.equal(JSON.stringify(out).includes('hunter2'), false);
});

test('sanitize: secret-shaped strings are redacted; ordinary text and UUIDs survive', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const out = sanitizeText(
    `key sk-ant-api03-abcdefghijklmnop gem AIzaSyA1234567890abcdefghijk groq gsk_abcdefghijklmnop ` +
    `hdr Bearer abc.def.ghi tok ${'A'.repeat(43)} id ${uuid} normal text`);
  for (const secret of ['abcdefghijklmnop', 'AIzaSyA1234567890', 'gsk_abcdefghij', 'abc.def.ghi', 'A'.repeat(43)]) {
    assert.equal(out.includes(secret), false, `leaked: ${secret}`);
  }
  assert.ok(out.includes(uuid), 'a UUID is not a secret and must stay correlatable');
  assert.ok(out.includes('normal text'));
});

test('sanitize: control characters (newlines, NUL, Unicode line separators) cannot survive', () => {
  const out = sanitizeText('line one\nline two\r\n\u0000\u001b[31m\u2028\u2029end');
  assert.equal(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(out), false);
  assert.ok(out.startsWith('line one') && out.endsWith('end'));
});

test('sanitize: size and structure are bounded', () => {
  // (spaced words: a long unbroken run of letters would be redacted as token-shaped instead)
  assert.ok(sanitizeText('word '.repeat(2000)).length <= 303);
  assert.equal(sanitizeText('abcd '.repeat(10), 10), 'abcd abcd ...');
  assert.equal(sanitizeText('x'.repeat(50)), '[REDACTED]', 'a long unbroken run is treated as a token and redacted, not just truncated');
  const many = {}; for (let i = 0; i < 100; i += 1) many[`k${i}`] = i;
  assert.equal(Object.keys(sanitizeDetails(many)).length, 30);
  assert.equal(sanitizeDetails({ a: Array.from({ length: 500 }, (_, i) => i) }).a.length, 50);
  const deep = sanitizeDetails({ l1: { l2: { l3: { l4: 'too deep' }, ok: 1 } } });
  assert.deepEqual(deep, { l1: { l2: { ok: 1 } } });
});

test('sanitize: prototype-pollution and malformed keys are refused', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":1,"ok":1,"has space":1,"' + 'k'.repeat(60) + '":1}');
  const out = sanitizeDetails(hostile);
  assert.deepEqual(out, { ok: 1 });
  assert.equal({}.polluted, undefined);
});

test('sanitize: only plain JSON values survive; junk is dropped; non-objects become {}', () => {
  assert.deepEqual(sanitizeDetails({ n: 1, b: false, z: null, s: 'x', nan: NaN, inf: Infinity, f() {}, u: undefined, sym: Symbol('x'), big: 10n }),
    { n: 1, b: false, z: null, s: 'x' });
  for (const bad of [null, undefined, 'text', 42, [1, 2], true]) assert.deepEqual(sanitizeDetails(bad), {});
});

// ---- SecurityAuditLog ------------------------------------------------------------------------

function newLog(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const clock = { t: Date.parse('2026-01-01T00:00:00Z') };
  const file = path.join(dir, 'sub', 'audit.jsonl');                  // parent directory does not exist yet
  const log = new SecurityAuditLog({ filePath: file, now: () => { clock.t += 1000; return clock.t; }, ...options });
  return { log, file, dir, clock };
}
const base = (over = {}) => ({
  type: EVENT_TYPES.AUTH_FAILURE, severity: SEVERITIES.LOW, action: 'login', result: RESULTS.FAILURE, reason: 'Invalid credentials.', ...over,
});
const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

test('record: writes one JSON line carrying every field the spec asks for', (t) => {
  const { log, file } = newLog(t);
  const rec = log.record(base({ requestId: 'req-1', userId: 'u-1', provider: 'claude', ip: '203.0.113.9', details: { cause: 'BAD_PASSWORD' } }));
  const lines = linesOf(file);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), rec);
  assert.deepEqual(Object.keys(rec).sort(), ['action', 'details', 'id', 'ip', 'provider', 'reason', 'requestId', 'result', 'seq', 'severity', 'timestamp', 'type', 'userId'].sort());
  assert.match(rec.id, /^[0-9a-f-]{36}$/);
  assert.equal(rec.timestamp, '2026-01-01T00:00:01.000Z');
  assert.equal(rec.seq, 1);
});

test('record: optional fields default to null; ids are unique; seq is strictly increasing', (t) => {
  const { log } = newLog(t);
  const records = Array.from({ length: 5 }, () => log.record(base()));
  assert.equal(records[0].userId, null); assert.equal(records[0].ip, null);
  assert.equal(records[0].requestId, null); assert.equal(records[0].provider, null);
  assert.equal(new Set(records.map((r) => r.id)).size, 5);
  assert.deepEqual(records.map((r) => r.seq), [1, 2, 3, 4, 5]);
});

test('record: the file is private (0600)', { skip: process.platform === 'win32' }, (t) => {
  const { log, file } = newLog(t);
  log.record(base());
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('record: an unknown type, severity or result is refused and writes nothing', (t) => {
  const { log, file } = newLog(t);
  assert.throws(() => log.record(base({ type: 'MADE_UP' })), RangeError);
  assert.throws(() => log.record(base({ severity: 'CATASTROPHIC' })), RangeError);
  assert.throws(() => log.record(base({ result: 'MAYBE' })), RangeError);
  assert.throws(() => log.record(base({ type: '__proto__' })), RangeError);
  assert.equal(fs.existsSync(file), false);
});

test('record: values cannot forge extra log lines', (t) => {
  const { log, file } = newLog(t);
  const forged = 'x\n{"seq":999,"type":"AUTH_SUCCESS","severity":"INFO","result":"SUCCESS"}\r\n\u2028';
  log.record(base({ requestId: forged, userId: forged, action: forged, reason: forged, ip: forged, provider: forged, details: { note: forged, list: [forged] } }));
  const lines = linesOf(file);
  assert.equal(lines.length, 1, 'exactly one line, however hostile the values');
  assert.equal(JSON.parse(lines[0]).seq, 1);
  assert.equal(log.query().events.length, 1);
});

test('record: secrets passed by mistake never reach the file', (t) => {
  const { log, file } = newLog(t);
  log.record(base({
    reason: 'login with sk-ant-api03-abcdefghijklmnopqrst failed',
    details: { password: 'hunter2', token: 'T0K3N', note: `Bearer ${'Z'.repeat(50)}`, nested: { apiKey: 'AIzaSyShouldNeverAppear1234567' } },
  }));
  const text = fs.readFileSync(file, 'utf8');
  for (const secret of ['hunter2', 'T0K3N', 'abcdefghijklmnopqrst', 'Z'.repeat(50), 'AIzaSyShould']) assert.equal(text.includes(secret), false, secret);
});

test('seq continues across a restart (a second instance on the same file)', (t) => {
  const { log, file, clock } = newLog(t);
  log.record(base()); log.record(base());
  const restarted = new SecurityAuditLog({ filePath: file, now: () => clock.t });
  assert.equal(restarted.record(base()).seq, 3);
});

test('rotation: files stay bounded, the oldest events fall off, nothing inside retention is lost', (t) => {
  // each record is roughly 260 bytes, so 1500 bytes holds about five per file
  const { log, file } = newLog(t, { maxBytes: 1500, maxFiles: 3 });
  for (let i = 0; i < 40; i += 1) log.record(base({ reason: `event number ${i}` }));
  const present = [file, `${file}.1`, `${file}.2`, `${file}.3`].filter((f) => fs.existsSync(f));
  assert.equal(present.length, 3, 'active file plus two rotated files, never more');
  assert.equal(fs.existsSync(`${file}.3`), false);
  for (const f of present) assert.ok(fs.statSync(f).size <= 1500 + 400, 'no file grows beyond the cap (plus at most one line)');

  const all = log.query({ limit: 500 }).events;
  assert.ok(all.length < 40, 'old events were discarded');
  assert.ok(all.length >= 10, 'recent events were kept');
  assert.equal(all[0].reason, 'event number 39', 'the newest event is always retained');
  const seqs = all.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a), 'newest first across files');
  assert.equal(new Set(seqs).size, seqs.length);
  assert.equal(seqs[0] - seqs[seqs.length - 1], seqs.length - 1, 'a contiguous run: nothing missing inside the retained window');
});

test('rotation: rotated files are also private, and maxFiles=1 simply discards', { skip: process.platform === 'win32' }, (t) => {
  const { log, file } = newLog(t, { maxBytes: 400, maxFiles: 2 });
  for (let i = 0; i < 12; i += 1) log.record(base());
  assert.equal(fs.statSync(`${file}.1`).mode & 0o777, 0o600);

  const single = newLog(t, { maxBytes: 400, maxFiles: 1 });
  for (let i = 0; i < 12; i += 1) single.log.record(base());
  assert.equal(fs.existsSync(`${single.file}.1`), false);
  assert.ok(single.log.query().events.length >= 1);
});

test('a flood of events cannot grow the log without bound', (t) => {
  const { log, file } = newLog(t, { maxBytes: 2000, maxFiles: 3 });
  for (let i = 0; i < 2000; i += 1) log.record(base({ reason: 'x'.repeat(100) }));
  const total = [file, `${file}.1`, `${file}.2`, `${file}.3`].filter((f) => fs.existsSync(f)).reduce((n, f) => n + fs.statSync(f).size, 0);
  assert.ok(total <= 3 * (2000 + 600), `disk use stayed bounded (${total} bytes for 2000 events)`);
});

function seed(t) {
  const ctx = newLog(t);
  const specs = [
    base({ type: EVENT_TYPES.AUTH_FAILURE, severity: SEVERITIES.LOW, result: RESULTS.FAILURE, userId: 'u-1' }),
    base({ type: EVENT_TYPES.PROMPT_INJECTION, severity: SEVERITIES.HIGH, result: RESULTS.BLOCKED, userId: 'u-2' }),
    base({ type: EVENT_TYPES.XSS_ATTEMPT, severity: SEVERITIES.HIGH, result: RESULTS.BLOCKED }),
    base({ type: EVENT_TYPES.SECURITY_SCAN, severity: SEVERITIES.INFO, result: RESULTS.SUCCESS }),
    base({ type: EVENT_TYPES.UNAUTHORIZED_ACCESS, severity: SEVERITIES.MEDIUM, result: RESULTS.DENIED, userId: 'u-1' }),
    base({ type: EVENT_TYPES.INVALID_INPUT, severity: SEVERITIES.LOW, result: RESULTS.REJECTED }),
    base({ type: EVENT_TYPES.AUTH_SUCCESS, severity: SEVERITIES.INFO, result: RESULTS.SUCCESS, userId: 'u-1' }),
  ];
  ctx.records = specs.map((s) => ctx.log.record(s));
  return ctx;
}

test('query: newest first, with filters for type, severity, result, user and blocked-only', (t) => {
  const { log } = seed(t);
  const types = (q) => log.query(q).events.map((e) => e.type);
  assert.deepEqual(types({}), ['AUTH_SUCCESS', 'INVALID_INPUT', 'UNAUTHORIZED_ACCESS', 'SECURITY_SCAN', 'XSS_ATTEMPT', 'PROMPT_INJECTION', 'AUTH_FAILURE']);
  assert.deepEqual(types({ type: 'XSS_ATTEMPT' }), ['XSS_ATTEMPT']);
  assert.deepEqual(types({ type: ['XSS_ATTEMPT', 'PROMPT_INJECTION'] }), ['XSS_ATTEMPT', 'PROMPT_INJECTION']);
  assert.deepEqual(types({ severity: 'HIGH' }), ['XSS_ATTEMPT', 'PROMPT_INJECTION']);
  assert.deepEqual(types({ result: 'DENIED' }), ['UNAUTHORIZED_ACCESS']);
  assert.deepEqual(types({ userId: 'u-1' }), ['AUTH_SUCCESS', 'UNAUTHORIZED_ACCESS', 'AUTH_FAILURE']);
  assert.deepEqual(types({ blockedOnly: true }), ['INVALID_INPUT', 'UNAUTHORIZED_ACCESS', 'XSS_ATTEMPT', 'PROMPT_INJECTION'],
    'blocked = BLOCKED, DENIED or REJECTED; plain successes and failed logins are not "blocked requests"');
  assert.deepEqual(types({ blockedOnly: true, type: 'XSS_ATTEMPT', userId: 'nobody' }), []);
});

test('query: time-range filtering is inclusive', (t) => {
  const { log, records } = seed(t);
  const t3 = records[2].timestamp; const t5 = records[4].timestamp;
  assert.deepEqual(log.query({ since: t3, until: t5 }).events.map((e) => e.seq), [5, 4, 3]);
  assert.deepEqual(log.query({ since: Date.parse(t5) }).events.map((e) => e.seq), [7, 6, 5]);
});

test('query: limit is honoured, defaults to 100 and is clamped to 500', (t) => {
  const { log } = newLog(t);
  for (let i = 0; i < 120; i += 1) log.record(base());
  assert.equal(log.query({ limit: 5 }).events.length, 5);
  assert.equal(log.query().events.length, 100);
  assert.equal(log.query({ limit: 100000 }).events.length, 120);
});

test('query: paging with beforeSeq walks every event exactly once, across rotated files', (t) => {
  const { log } = newLog(t, { maxBytes: 1500, maxFiles: 6 });
  for (let i = 0; i < 60; i += 1) log.record(base({ reason: `n${i}` }));
  const everything = log.query({ limit: 500 }).events.map((e) => e.seq);
  const paged = [];
  let cursor;
  let pages = 0;
  do {
    const page = log.query({ limit: 7, ...(cursor ? { beforeSeq: cursor } : {}) });
    paged.push(...page.events.map((e) => e.seq));
    cursor = page.nextBeforeSeq;
    pages += 1;
  } while (cursor && pages < 100);
  assert.deepEqual(paged, everything, 'same events, same order, no duplicates, no gaps');
  assert.ok(pages > 1);
  assert.equal(log.query({ limit: 500 }).nextBeforeSeq, null, 'null once there is nothing older');
});

test('query: invalid filters throw RangeError (the API turns these into HTTP 400)', (t) => {
  const { log } = seed(t);
  for (const bad of [{ type: 'NOPE' }, { type: ['XSS_ATTEMPT', 'NOPE'] }, { severity: 'CRITICAL' }, { result: 'MAYBE' },
    { limit: 0 }, { limit: -3 }, { limit: 1.5 }, { limit: '5' }, { beforeSeq: 0 }, { beforeSeq: 'x' }, { since: 'yesterday-ish' }, { until: 'nope' }]) {
    assert.throws(() => log.query(bad), RangeError, JSON.stringify(bad));
  }
});

test('query: a missing log reads as empty', (t) => {
  const { log } = newLog(t);
  assert.deepEqual(log.query(), { events: [], nextBeforeSeq: null, skippedCorruptLines: 0 });
});

test('corrupt lines are skipped and counted, never fatal, and do not disturb new records', (t) => {
  const { log, file } = newLog(t);
  log.record(base()); log.record(base());
  fs.appendFileSync(file, '{ not json at all\n{"seq":"nope"}\n{"seq":5,"type":"NOT_A_TYPE"}\n{"seq":3,"type":"AUTH_FAILURE"\n');
  const result = log.query();
  assert.equal(result.events.length, 2);
  assert.equal(result.skippedCorruptLines, 4);
  const restarted = new SecurityAuditLog({ filePath: file });
  assert.equal(restarted.record(base()).seq, 3, 'junk at the end of the file does not confuse seq recovery');
});
