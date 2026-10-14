/**
 * Username / password rules. Messages are fixed text -- they never echo
 * what the user typed.
 *
 * Passwords follow NIST SP 800-63B guidance: a minimum length and a cap
 * (to bound hashing cost), a screen against a few obviously bad choices,
 * and NO arbitrary composition rules ("must contain a symbol").
 * COMMON_PASSWORDS is a deliberately small list, not a breach corpus --
 * screening against a real breached-password list is a worthwhile future
 * upgrade.
 */
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', 'passw0rd123', '1234567890', '12345678910',
  '0123456789', '9876543210', 'qwertyuiop', 'qwerty12345', '1q2w3e4r5t',
  'letmein1234', 'welcome1234', 'admin12345', 'administrator', 'iloveyou123',
  'changeme123', 'abcdefghij',
]);

// Usernames that would be confusing next to the ADMIN role. Applies to
// public registration only; an operator can still create such an account.
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'anonymous', 'sentinel', 'moderator',
]);

function normalizeUsernameKey(username) {
  return String(username).toLowerCase();
}

function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return {
      valid: false,
      code: 'INVALID_USERNAME',
      message: 'Username must be 3-32 characters: letters, numbers, dot, underscore or hyphen.',
    };
  }
  return { valid: true };
}

function isReservedUsername(username) {
  return RESERVED_USERNAMES.has(normalizeUsernameKey(username));
}

function validatePassword(password, username = '') {
  const invalid = (message) => ({ valid: false, code: 'INVALID_PASSWORD', message });
  if (typeof password !== 'string') return invalid('Password must be text.');
  if (password.length < MIN_PASSWORD_LENGTH) return invalid(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  if (password.length > MAX_PASSWORD_LENGTH) return invalid(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  const lowered = password.toLowerCase();
  if (typeof username === 'string' && username && lowered === username.toLowerCase()) {
    return invalid('Password must not be the same as the username.');
  }
  if (COMMON_PASSWORDS.has(lowered) || /^(.)\1+$/.test(password)) {
    return invalid('That password is too easy to guess. Please choose another.');
  }
  return { valid: true };
}

module.exports = {
  validateUsername, validatePassword, isReservedUsername, normalizeUsernameKey,
  MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH,
};
