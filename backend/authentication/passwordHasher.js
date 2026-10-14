/**
 * PasswordHasher -- scrypt via Node's built-in crypto (no dependency).
 * ---------------------------------------------------------------------
 * Stored format:   scrypt$N$r$p$<salt base64>$<hash base64>
 * The cost parameters travel WITH each hash, so they can be raised later
 * without invalidating existing accounts: verify() always uses the
 * parameters in the stored string, and needsRehash() tells the caller
 * (AuthService, after a successful login) to upgrade an older hash.
 *
 * Defaults are OWASP's scrypt guidance (N=2^15, r=8, p=3 ~ 32 MiB).
 *
 *  - A fresh random 16-byte salt per hash.
 *  - Passwords are NFKC-normalized first, so visually identical Unicode
 *    spellings (composed vs decomposed accents) are the same password.
 *  - Comparison is constant-time (crypto.timingSafeEqual).
 *  - Parameters parsed from a stored hash are bounds-checked, so a
 *    tampered record cannot make verify() allocate unbounded memory.
 *  - verifyDummy() burns the same CPU as a real verify, so a login for a
 *    nonexistent user takes about as long as one for a real user and
 *    response timing does not reveal which usernames exist.
 */
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const FORMAT_PREFIX = 'scrypt';
const MAX_N = 2 ** 20;
const MAX_R = 32;
const MAX_P = 16;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

function maxmemFor(N, r) {
  return 256 * N * r;   // scrypt needs ~128*N*r bytes; leave headroom
}

class PasswordHasher {
  constructor({ N = 2 ** 15, r = 8, p = 3 } = {}) {
    if (!isPowerOfTwo(N) || N > MAX_N || !Number.isInteger(r) || r < 1 || r > MAX_R
        || !Number.isInteger(p) || p < 1 || p > MAX_P) {
      throw new RangeError('Invalid scrypt parameters.');
    }
    this.N = N;
    this.r = r;
    this.p = p;
    // Fixed, never-matching record used by verifyDummy().
    this.dummySalt = crypto.randomBytes(SALT_LENGTH);
  }

  static normalize(password) {
    return String(password).normalize('NFKC');
  }

  async hash(password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const derived = await scrypt(PasswordHasher.normalize(password), salt, KEY_LENGTH, {
      N: this.N, r: this.r, p: this.p, maxmem: maxmemFor(this.N, this.r),
    });
    return [FORMAT_PREFIX, this.N, this.r, this.p, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  /** Parses a stored hash; returns null if it is malformed or out of bounds. */
  static parse(stored) {
    if (typeof stored !== 'string') return null;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== FORMAT_PREFIX) return null;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!isPowerOfTwo(N) || N > MAX_N || !Number.isInteger(r) || r < 1 || r > MAX_R
        || !Number.isInteger(p) || p < 1 || p > MAX_P) return null;
    const salt = Buffer.from(parts[4], 'base64');
    const hash = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || hash.length === 0) return null;
    return { N, r, p, salt, hash };
  }

  async verify(password, stored) {
    const parsed = PasswordHasher.parse(stored);
    if (!parsed) return false;
    const derived = await scrypt(PasswordHasher.normalize(password), parsed.salt, parsed.hash.length, {
      N: parsed.N, r: parsed.r, p: parsed.p, maxmem: maxmemFor(parsed.N, parsed.r),
    });
    return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
  }

  /** True if `stored` was made with weaker (or different) parameters than the current ones. */
  needsRehash(stored) {
    const parsed = PasswordHasher.parse(stored);
    if (!parsed) return true;
    return parsed.N !== this.N || parsed.r !== this.r || parsed.p !== this.p;
  }

  /** Same CPU cost as verify() with the current parameters; always resolves false. */
  async verifyDummy(password) {
    await scrypt(PasswordHasher.normalize(password), this.dummySalt, KEY_LENGTH, {
      N: this.N, r: this.r, p: this.p, maxmem: maxmemFor(this.N, this.r),
    });
    return false;
  }
}

module.exports = { PasswordHasher };
