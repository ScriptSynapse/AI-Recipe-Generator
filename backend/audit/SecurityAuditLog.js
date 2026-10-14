/**
 * SecurityAuditLog -- the durable record of security-relevant events.
 * ---------------------------------------------------------------------
 * Storage: one JSON object per line (JSON Lines) appended to a file with
 * mode 0600. JSON.stringify escapes newlines inside strings, so a value
 * can never break out of its line and forge another record.
 *
 * Bounded: when the active file would exceed `maxBytes` it is rotated
 * (log -> log.1 -> log.2 ...) and the oldest file beyond `maxFiles` is
 * deleted. A flood of events therefore cannot fill the disk -- an
 * unbounded log is itself a denial-of-service lever. The price is that
 * retention is by SIZE, not by time: the oldest events eventually fall
 * off the end.
 *
 * Every record carries both a unique `id` (uuid) and a monotonic `seq`.
 * `seq` gives stable newest-first pagination (`beforeSeq`) that survives
 * restarts and rotation, which timestamps (ties!) cannot.
 *
 * Fields (spec): event ID, timestamp, request ID, user ID, event type,
 * severity, provider, IP address, action, result, reason -- plus a small
 * sanitized `details` object. Everything passes through sanitize.js, so
 * the log never contains a secret even if a producer slips.
 *
 * Synchronous I/O on purpose (same reasoning as JsonFileStore): single
 * Node thread, small appends, and no interleaving to reason about.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { isEventType, isSeverity, isResult, BLOCKED_RESULTS } = require('./auditEvents');
const { sanitizeText, sanitizeDetails } = require('./sanitize');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_SCAN_LIMIT = 50000;

const optionalText = (v, max) => (v === undefined || v === null || v === '' ? null : sanitizeText(v, max));

class SecurityAuditLog {
  constructor({
    filePath, maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_MAX_FILES,
    now = () => Date.now(), idFactory = () => crypto.randomUUID(),
  }) {
    if (!filePath) throw new Error('SecurityAuditLog requires a filePath.');
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    this.now = now;
    this.idFactory = idFactory;
    this.nextSeq = null;           // determined lazily from what is already on disk
  }

  /**
   * Appends one event. Throws RangeError for a programming error (unknown
   * type/severity/result) -- callers that must not fail (the audit
   * subscriber) catch and report loudly.
   */
  record(event) {
    if (!isEventType(event.type)) throw new RangeError('Unknown audit event type.');
    if (!isSeverity(event.severity)) throw new RangeError('Unknown audit event severity.');
    if (!isResult(event.result)) throw new RangeError('Unknown audit event result.');

    if (this.nextSeq === null) this.nextSeq = this._highestSeqOnDisk() + 1;

    const record = {
      seq: this.nextSeq,
      id: this.idFactory(),
      timestamp: new Date(this.now()).toISOString(),
      requestId: optionalText(event.requestId, 64),
      userId: optionalText(event.userId, 64),
      type: event.type,
      severity: event.severity,
      provider: optionalText(event.provider, 40),
      ip: optionalText(event.ip, 64),
      action: sanitizeText(event.action || '', 120),
      result: event.result,
      reason: sanitizeText(event.reason || '', 300),
      details: sanitizeDetails(event.details),
    };

    const line = `${JSON.stringify(record)}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this._rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.filePath, line, { mode: 0o600 });
    this.nextSeq += 1;
    return record;
  }

  /**
   * Newest-first query.
   * @param {object} [filters]
   * @param {string|string[]} [filters.type]   one or more EVENT_TYPES
   * @param {string} [filters.severity]
   * @param {string} [filters.result]
   * @param {string} [filters.userId]
   * @param {boolean} [filters.blockedOnly]    only requests a security control stopped
   * @param {string|number} [filters.since]    inclusive lower bound (ISO date or ms)
   * @param {string|number} [filters.until]    inclusive upper bound
   * @param {number} [filters.limit]           default 100, max 500
   * @param {number} [filters.beforeSeq]       only events older than this seq (pagination cursor)
   * @returns {{events: object[], nextBeforeSeq: (number|null), skippedCorruptLines: number}}
   * @throws {RangeError} for an invalid filter (callers map this to HTTP 400)
   */
  query(filters = {}) {
    const types = filters.type === undefined ? null : [].concat(filters.type);
    if (types && !types.every(isEventType)) throw new RangeError('Unknown event type filter.');
    if (filters.severity !== undefined && !isSeverity(filters.severity)) throw new RangeError('Unknown severity filter.');
    if (filters.result !== undefined && !isResult(filters.result)) throw new RangeError('Unknown result filter.');

    const toMs = (v, label) => {
      if (v === undefined) return null;
      const ms = typeof v === 'number' ? v : Date.parse(v);
      if (!Number.isFinite(ms)) throw new RangeError(`Invalid ${label} date.`);
      return ms;
    };
    const since = toMs(filters.since, 'since');
    const until = toMs(filters.until, 'until');

    let limit = DEFAULT_LIMIT;
    if (filters.limit !== undefined) {
      if (!Number.isInteger(filters.limit) || filters.limit < 1) throw new RangeError('limit must be a positive integer.');
      limit = Math.min(filters.limit, MAX_LIMIT);
    }
    if (filters.beforeSeq !== undefined && (!Number.isInteger(filters.beforeSeq) || filters.beforeSeq < 1)) {
      throw new RangeError('beforeSeq must be a positive integer.');
    }

    const matches = (e) => {
      if (filters.beforeSeq !== undefined && e.seq >= filters.beforeSeq) return false;
      if (types && !types.includes(e.type)) return false;
      if (filters.severity !== undefined && e.severity !== filters.severity) return false;
      if (filters.result !== undefined && e.result !== filters.result) return false;
      if (filters.userId !== undefined && e.userId !== filters.userId) return false;
      if (filters.blockedOnly && !BLOCKED_RESULTS.includes(e.result)) return false;
      const t = Date.parse(e.timestamp);
      if (since !== null && t < since) return false;
      if (until !== null && t > until) return false;
      return true;
    };

    const events = [];
    let skipped = 0;
    let more = false;
    outer:
    for (const file of this._filesNewestFirst()) {
      const lines = this._readLines(file);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parsed = SecurityAuditLog._parse(lines[i]);
        if (!parsed) { skipped += 1; continue; }
        if (!matches(parsed)) continue;
        if (events.length === limit) { more = true; break outer; }
        events.push(parsed);
      }
    }
    return {
      events,
      nextBeforeSeq: more ? events[events.length - 1].seq : null,
      skippedCorruptLines: skipped,
    };
  }

  /**
   * Streams records newest-first to `visit` (for aggregation -- the
   * security stats). Bounded by `maxRecords` so a large log cannot make one
   * request do unbounded work; `truncated` says whether older records were
   * left unread, so a caller never presents a partial count as complete.
   * @returns {{scanned: number, truncated: boolean, skippedCorruptLines: number}}
   */
  scan(visit, { maxRecords = DEFAULT_SCAN_LIMIT } = {}) {
    let scanned = 0;
    let skipped = 0;
    for (const file of this._filesNewestFirst()) {
      const lines = this._readLines(file);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parsed = SecurityAuditLog._parse(lines[i]);
        if (!parsed) { skipped += 1; continue; }
        if (scanned >= maxRecords) return { scanned, truncated: true, skippedCorruptLines: skipped };
        scanned += 1;
        visit(parsed);
      }
    }
    return { scanned, truncated: false, skippedCorruptLines: skipped };
  }

  // ---- internals -------------------------------------------------------------------

  static _parse(line) {
    if (!line) return null;
    try {
      const e = JSON.parse(line);
      return e && Number.isInteger(e.seq) && isEventType(e.type) ? e : null;
    } catch {
      return null;
    }
  }

  _filesNewestFirst() {
    const files = [this.filePath];
    for (let i = 1; i < this.maxFiles; i += 1) files.push(`${this.filePath}.${i}`);
    return files.filter((f) => fs.existsSync(f));
  }

  _readLines(file) {
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  _highestSeqOnDisk() {
    for (const file of this._filesNewestFirst()) {
      const lines = this._readLines(file);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const parsed = SecurityAuditLog._parse(lines[i]);
        if (parsed) return parsed.seq;
      }
    }
    return 0;
  }

  _rotateIfNeeded(incomingBytes) {
    let size = 0;
    try { size = fs.statSync(this.filePath).size; } catch { return; }       // no file yet: nothing to rotate
    if (size === 0 || size + incomingBytes <= this.maxBytes) return;

    const oldest = this.maxFiles - 1;                 // highest rotated index we keep
    if (oldest < 1) { fs.rmSync(this.filePath, { force: true }); return; }
    fs.rmSync(`${this.filePath}.${oldest}`, { force: true });
    for (let i = oldest - 1; i >= 1; i -= 1) {
      if (fs.existsSync(`${this.filePath}.${i}`)) fs.renameSync(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
    }
    fs.renameSync(this.filePath, `${this.filePath}.1`);
  }
}

module.exports = { SecurityAuditLog, DEFAULT_MAX_BYTES, DEFAULT_MAX_FILES, DEFAULT_LIMIT, MAX_LIMIT, DEFAULT_SCAN_LIMIT };
