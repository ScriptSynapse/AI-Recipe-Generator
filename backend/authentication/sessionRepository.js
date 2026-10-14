/**
 * SessionRepository -- persists sessions keyed by the SHA-256 HASH of the
 * session token. The raw token exists only in the user's cookie; if this
 * file leaks, it contains nothing that can be replayed as a login.
 */
const { JsonFileStore, StoreError } = require('../storage/JsonFileStore');

class SessionRepository {
  constructor(store) {
    this.store = store;
  }

  static forFile(filePath) {
    return new SessionRepository(new JsonFileStore(filePath, () => ({ sessions: {} })));
  }

  _sessions() {
    const data = this.store.read();
    if (!data || typeof data.sessions !== 'object' || data.sessions === null || Array.isArray(data.sessions)) {
      throw new StoreError('Session store has an unexpected shape.');
    }
    return data.sessions;
  }

  find(tokenHash) {
    const sessions = this._sessions();
    return Object.prototype.hasOwnProperty.call(sessions, tokenHash) ? sessions[tokenHash] : null;
  }

  /** Inserts a session and, in the same write, drops every already-expired one. */
  create(tokenHash, session, nowMs) {
    return this.store.update((data) => {
      if (!data || typeof data.sessions !== 'object' || data.sessions === null) {
        throw new StoreError('Session store has an unexpected shape.');
      }
      for (const [hash, s] of Object.entries(data.sessions)) {
        if (!s || typeof s.expiresAt !== 'number' || s.expiresAt <= nowMs) delete data.sessions[hash];
      }
      data.sessions[tokenHash] = session;
      return session;
    });
  }

  /** Records activity for the idle timeout. Best-effort by design: the caller throttles it. */
  touch(tokenHash, nowMs) {
    return this.store.update((data) => {
      const s = Object.prototype.hasOwnProperty.call(data.sessions, tokenHash) ? data.sessions[tokenHash] : null;
      if (!s) return false;
      s.lastSeenAt = nowMs;
      return true;
    });
  }

  /** Ends every session of one user (used when the password changes). Returns how many were removed. */
  deleteForUser(userId) {
    return this.store.update((data) => {
      let removed = 0;
      for (const [hash, s] of Object.entries(data.sessions)) {
        if (s && s.userId === userId) { delete data.sessions[hash]; removed += 1; }
      }
      return removed;
    });
  }

  delete(tokenHash) {
    return this.store.update((data) => {
      const had = Object.prototype.hasOwnProperty.call(data.sessions, tokenHash);
      delete data.sessions[tokenHash];
      return had;
    });
  }
}

module.exports = { SessionRepository };
