const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateUsername, validatePassword, isReservedUsername, normalizeUsernameKey,
} = require('../../backend/authentication/validators');
const { SessionCookie, parseCookies } = require('../../backend/authentication/sessionCookie');

// ---- usernames / passwords ------------------------------------------------

test('usernames: accepts 3-32 of letters, digits, dot, underscore, hyphen', () => {
  for (const ok of ['abc', 'Alice_01', 'a.b-c_d', 'x'.repeat(32)]) assert.equal(validateUsername(ok).valid, true, ok);
});

test('usernames: rejects bad length, spaces, symbols, unicode and non-strings', () => {
  for (const bad of ['ab', 'x'.repeat(33), 'has space', 'semi;colon', '<script>', 'caf\u00e9', 'new\nline', '', null, undefined, 42, {}]) {
    const r = validateUsername(bad);
    assert.equal(r.valid, false, String(bad));
    assert.equal(r.code, 'INVALID_USERNAME');
  }
});

test('reserved usernames are recognised case-insensitively', () => {
  assert.equal(isReservedUsername('Admin'), true);
  assert.equal(isReservedUsername('ROOT'), true);
  assert.equal(isReservedUsername('alice'), false);
  assert.equal(normalizeUsernameKey('AlIcE'), normalizeUsernameKey('alice'));
});

test('passwords: enforces length bounds but no arbitrary composition rules', () => {
  assert.equal(validatePassword('short').valid, false);
  assert.equal(validatePassword('x1y2z3a4b').valid, false);               // 9 chars
  assert.equal(validatePassword('a'.repeat(129)).valid, false);
  assert.equal(validatePassword('alllowercaseletters').valid, true);      // NIST: no "must contain a symbol"
  assert.equal(validatePassword('correct horse battery staple').valid, true);
  assert.equal(validatePassword('a'.repeat(128) + '').valid, false);      // single repeated char is rejected...
  assert.equal(validatePassword('ab'.repeat(64)).valid, true);            // ...but the 128-char cap itself is allowed
});

test('passwords: rejects the username, common choices, repeated characters and non-strings', () => {
  assert.equal(validatePassword('Alice_Smith_1', 'alice_smith_1').valid, false);
  assert.equal(validatePassword('Password123').valid, false);             // common, case-insensitive
  assert.equal(validatePassword('1234567890').valid, false);
  assert.equal(validatePassword('aaaaaaaaaaaa').valid, false);
  for (const bad of [null, undefined, 12345678901234, {}, ['longenoughpassword']]) {
    assert.equal(validatePassword(bad).valid, false);
  }
});

test('validation messages never echo what the user typed', () => {
  const secret = 'SuperSecretValue-abc';
  for (const result of [validatePassword(secret.slice(0, 5)), validatePassword(secret, secret), validateUsername(secret + ' bad')]) {
    assert.equal(JSON.stringify(result).includes('SuperSecret'), false);
  }
});

// ---- cookies ---------------------------------------------------------------

test('parseCookies: basic parsing, first occurrence wins, quotes and malformed parts handled', () => {
  assert.equal(parseCookies('a=1; b=2').b, '2');
  assert.equal(parseCookies('session=first; session=second').session, 'first');
  assert.equal(parseCookies('s="quoted"').s, 'quoted');
  assert.equal(parseCookies('novalue; ok=1').ok, '1');
  assert.equal(parseCookies('bad=%E0%A4%A').bad, '%E0%A4%A', 'invalid percent-encoding must not throw');
  assert.deepEqual(Object.keys(parseCookies(undefined)), []);
  assert.deepEqual(Object.keys(parseCookies(42)), []);
  assert.equal(parseCookies('__proto__=x').__proto__, 'x', 'cookie names are plain data, not prototype access');
  assert.equal(({}).polluted, undefined);
});

test('SessionCookie.extract: cookie wins over Bearer; Bearer scheme is case-insensitive; else null', () => {
  const sc = new SessionCookie();
  assert.deepEqual(sc.extract({ headers: { cookie: 'session=abc' } }), { token: 'abc', source: 'cookie' });
  assert.deepEqual(sc.extract({ headers: { authorization: 'Bearer xyz' } }), { token: 'xyz', source: 'bearer' });
  assert.deepEqual(sc.extract({ headers: { authorization: 'bearer xyz' } }), { token: 'xyz', source: 'bearer' });
  assert.equal(sc.extract({ headers: { cookie: 'session=abc', authorization: 'Bearer xyz' } }).source, 'cookie');
  assert.equal(sc.extract({ headers: { authorization: 'Basic dXNlcjpwdw==' } }), null);
  assert.equal(sc.extract({ headers: { cookie: 'other=1' } }), null);
  assert.equal(sc.extract({ headers: {} }), null);
  assert.equal(sc.extract({}), null);
});

function fakeRes() {
  const headers = {};
  return {
    headers,
    getHeader: (n) => headers[n],
    setHeader: (n, v) => { headers[n] = v; },
  };
}

test('SessionCookie sets a hardened cookie; production mode adds Secure and the __Host- prefix', () => {
  const dev = new SessionCookie({ secure: false });
  const res = fakeRes();
  dev.set(res, 'TOKEN', 3_600_000);
  assert.equal(res.headers['Set-Cookie'], 'session=TOKEN; Max-Age=3600; Path=/; HttpOnly; SameSite=Strict');

  const prod = new SessionCookie({ secure: true });
  const res2 = fakeRes();
  prod.set(res2, 'TOKEN', 5000);
  assert.equal(prod.name, '__Host-session');
  assert.equal(res2.headers['Set-Cookie'], '__Host-session=TOKEN; Max-Age=5; Path=/; HttpOnly; SameSite=Strict; Secure');
});

test('SessionCookie.clear expires the cookie, and Set-Cookie headers are appended, not overwritten', () => {
  const sc = new SessionCookie();
  const res = fakeRes();
  res.setHeader('Set-Cookie', 'other=1; Path=/');
  sc.clear(res);
  assert.deepEqual(res.headers['Set-Cookie'], ['other=1; Path=/', 'session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict']);
  const res2 = fakeRes();
  sc.set(res2, 'T', -10_000);   // a non-positive lifetime -> Max-Age is never negative
  assert.match(res2.headers['Set-Cookie'], /Max-Age=0;/);
});
