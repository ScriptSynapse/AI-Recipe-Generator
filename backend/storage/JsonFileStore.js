/**
 * JsonFileStore
 * ---------------------------------------------------------------------
 * Minimal, dependable persistence for small JSON documents (users,
 * sessions). Deliberately synchronous: Node runs one JS thread, so a
 * read-modify-write done with sync fs calls cannot interleave with any
 * other request -- no lock needed within this process. (The C++ engine's
 * own storage uses a cross-process FileLock; these files are only ever
 * touched by this one Node process.)
 *
 *  - Writes go to a temp file, then rename over the target, so a crash
 *    mid-write never leaves a truncated file.
 *  - Files are created with mode 0600 (owner read/write only): they hold
 *    password hashes and session-token hashes.
 *  - A missing file reads as the default value; a CORRUPT file throws.
 *    It must never silently reset to empty: doing so on a users file
 *    would quietly erase every account.
 *  - Error messages carry only the file's base name, never a full path.
 */
const fs = require('fs');
const path = require('path');

class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreError';
  }
}

class JsonFileStore {
  /**
   * @param {string} filePath absolute path of the JSON file
   * @param {() => object} defaultValue factory for the value of a missing file
   */
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
    this.name = path.basename(filePath);
  }

  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return this.defaultValue();
      throw new StoreError(`Cannot read store file ${this.name} (${err.code || 'error'}).`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError(`Store file ${this.name} is corrupted.`);
    }
  }

  write(value) {
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), { mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* best effort */ }
      throw new StoreError(`Cannot write store file ${this.name} (${err.code || 'error'}).`);
    }
  }

  /**
   * Atomic (within this process) read-modify-write. `mutator` receives the
   * current value, may change it in place, and its return value is
   * returned. If `mutator` throws, nothing is written.
   */
  update(mutator) {
    const data = this.read();
    const result = mutator(data);
    this.write(data);
    return result;
  }
}

module.exports = { JsonFileStore, StoreError };
