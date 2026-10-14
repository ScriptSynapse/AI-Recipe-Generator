const test = require('node:test');
const assert = require('node:assert/strict');
const { PasswordHasher } = require('../../backend/authentication/passwordHasher');

const fast = () => new PasswordHasher({ N: 1024, r: 8, p: 1 });   // cheap params so tests stay quick

test('hash has the documented format with parameters embedded', async () => {
  const stored = await fast().hash('correct horse battery');
  const parts = stored.split('$');
  assert.equal(parts.length, 6);
  assert.deepEqual(parts.slice(0, 4), ['scrypt', '1024', '8', '1']);
  assert.equal(stored.includes('correct horse'), false, 'plaintext must never appear in the hash');
});

test('same password hashes differently each time (random per-hash salt)', async () => {
  const h = fast();
  assert.notEqual(await h.hash('same password!!'), await h.hash('same password!!'));
});

test('verify accepts the right password and rejects wrong ones', async () => {
  const h = fast();
  const stored = await h.hash('correct horse battery');
  assert.equal(await h.verify('correct horse battery', stored), true);
  assert.equal(await h.verify('correct horse batterz', stored), false);
  assert.equal(await h.verify('', stored), false);
  assert.equal(await h.verify('CORRECT HORSE BATTERY', stored), false);
});

test('verify uses the parameters stored in the hash, not the current ones', async () => {
  const stored = await fast().hash('migrating password');
  const stronger = new PasswordHasher({ N: 2048, r: 8, p: 1 });
  assert.equal(await stronger.verify('migrating password', stored), true);
  assert.equal(stronger.needsRehash(stored), true);
  assert.equal(fast().needsRehash(stored), false);
});

test('malformed or tampered stored values verify as false and never throw', async () => {
  const h = fast();
  const good = await h.hash('whatever password');
  const bad = [
    '', 'plaintext-password', null, undefined, 12345, {}, 'scrypt$x',
    'bcrypt$1024$8$1$c2FsdA==$aGFzaA==',                 // wrong scheme
    'scrypt$1000$8$1$c2FsdA==$aGFzaA==',                 // N not a power of two
    `scrypt$${2 ** 25}$8$1$c2FsdA==$aGFzaA==`,           // N far above the allowed maximum
    'scrypt$1024$8$1$$aGFzaA==',                         // empty salt
    'scrypt$1024$8$1$c2FsdA==$',                         // empty hash
    good + '$extra',                                     // too many fields
  ];
  for (const stored of bad) assert.equal(await h.verify('whatever password', stored), false, String(stored));
  assert.equal(h.needsRehash('garbage'), true);
});

test('out-of-range cost parameters in a stored hash are refused before any work is done', () => {
  assert.equal(PasswordHasher.parse(`scrypt$${2 ** 21}$8$1$c2FsdA==$aGFzaA==`), null);
  assert.equal(PasswordHasher.parse('scrypt$1024$999$1$c2FsdA==$aGFzaA=='), null);
  assert.equal(PasswordHasher.parse('scrypt$1024$8$999$c2FsdA==$aGFzaA=='), null);
});

test('passwords are NFKC-normalized: composed and decomposed spellings are the same password', async () => {
  const h = fast();
  const composed = 'caf\u00e9 au lait 123';        // é as one code point
  const decomposed = 'cafe\u0301 au lait 123';     // e + combining acute
  assert.notEqual(composed, decomposed);
  assert.equal(await h.verify(decomposed, await h.hash(composed)), true);
});

test('verifyDummy always resolves false and does not throw', async () => {
  assert.equal(await fast().verifyDummy('anything at all'), false);
});

test('constructor rejects invalid cost parameters', () => {
  assert.throws(() => new PasswordHasher({ N: 1000 }), RangeError);       // not a power of two
  assert.throws(() => new PasswordHasher({ N: 1 }), RangeError);
  assert.throws(() => new PasswordHasher({ N: 2 ** 21 }), RangeError);
  assert.throws(() => new PasswordHasher({ r: 0 }), RangeError);
  assert.throws(() => new PasswordHasher({ p: 99 }), RangeError);
});

test('default parameters are the OWASP scrypt recommendation (N=2^15, r=8, p=3)', async () => {
  const stored = await new PasswordHasher().hash('production parameters');
  assert.deepEqual(stored.split('$').slice(0, 4), ['scrypt', '32768', '8', '3']);
});
