/**
 * UserRepository -- the only code that knows how users are persisted.
 * AuthService depends on this interface (find/create/update), not on the
 * JSON file behind it, so a database-backed implementation can replace it
 * later (the spec's StorageRepository direction) without touching
 * business logic.
 *
 * create() checks username uniqueness and inserts inside ONE synchronous
 * store.update(), so two concurrent registrations of the same name cannot
 * both succeed even though password hashing (done before this call) is
 * asynchronous.
 */
const { JsonFileStore, StoreError } = require('../storage/JsonFileStore');
const { normalizeUsernameKey } = require('./validators');

class UsernameTakenError extends Error {
  constructor() {
    super('Username is already taken.');
    this.name = 'UsernameTakenError';
  }
}

class UserRepository {
  constructor(store) {
    this.store = store;
  }

  static forFile(filePath) {
    return new UserRepository(new JsonFileStore(filePath, () => ({ users: [] })));
  }

  _users() {
    const data = this.store.read();
    if (!data || !Array.isArray(data.users)) throw new StoreError('User store has an unexpected shape.');
    return data.users;
  }

  findByUsername(username) {
    const key = normalizeUsernameKey(username);
    return this._users().find((u) => u.usernameKey === key) || null;
  }

  findById(id) {
    return this._users().find((u) => u.id === id) || null;
  }

  create({ id, username, passwordHash, role, createdAt }) {
    return this.store.update((data) => {
      if (!data || !Array.isArray(data.users)) throw new StoreError('User store has an unexpected shape.');
      const key = normalizeUsernameKey(username);
      if (data.users.some((u) => u.usernameKey === key)) throw new UsernameTakenError();
      const record = { id, username, usernameKey: key, passwordHash, role, createdAt };
      data.users.push(record);
      return record;
    });
  }

  updateRole(id, role) {
    return this.store.update((data) => {
      const user = data.users.find((u) => u.id === id);
      if (!user) return false;
      user.role = role;
      return true;
    });
  }

  updatePasswordHash(id, passwordHash) {
    return this.store.update((data) => {
      const user = data.users.find((u) => u.id === id);
      if (!user) return false;
      user.passwordHash = passwordHash;
      return true;
    });
  }
}

module.exports = { UserRepository, UsernameTakenError };
