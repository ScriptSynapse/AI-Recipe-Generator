/**
 * cppBridge.js
 * ---------------------------------------------------------------------
 * The single point of contact between the Express API and the compiled
 * C++ OOP core (cpp-core/recipe_engine). Every backend route funnels
 * through `runEngine(command, payload)`, which spawns the C++ binary,
 * writes the JSON payload to its stdin, and parses the JSON it prints
 * to stdout.
 *
 * Hardening (Phase 0):
 *  - The child only receives an allow-list of environment variables, so
 *    unrelated secrets in process.env are never handed to the engine.
 *  - Each call has a hard timeout; a hung engine is killed (SIGKILL).
 *  - stdout size is capped so a runaway child cannot exhaust memory.
 *  - Failures are reported as `EngineError` carrying a SAFE public
 *    message. Internal detail (paths, raw output) is logged server-side
 *    only, with secrets redacted -- it is never sent to API clients.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Only these variables are forwarded to the C++ engine.
const ENV_ALLOWLIST = [
  // process/OS essentials (DNS, TLS, temp files, locale)
  'PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL',
  // network / TLS configuration libcurl honours
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE',
  // LLM provider configuration (read only by the C++ core)
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY', 'GOOGLE_MODEL',
  'OPENAI_API_KEY', 'OPENAI_MODEL',
  'GROQ_API_KEY', 'GROQ_MODEL',
  'LOCAL_LLM_URL', 'LOCAL_LLM_MODEL',
];

const DEFAULT_TIMEOUT_MS = 45000;          // C++ curl timeout is 30s per provider call
const DEFAULT_MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/** Error with a client-safe message; `detail` is for server logs only. */
class EngineError extends Error {
  constructor(code, publicMessage, detail = '') {
    super(publicMessage);
    this.name = 'EngineError';
    this.code = code;
    this.publicMessage = publicMessage;
    this.detail = detail;
  }
}

/** Builds the child's environment from an allow-list. */
function buildChildEnv(source = process.env, allowlist = ENV_ALLOWLIST) {
  const env = {};
  for (const key of allowlist) {
    if (source[key] !== undefined && source[key] !== '') env[key] = source[key];
  }
  return env;
}

/** Strips API-key-shaped strings and truncates text before logging. */
function redact(text, maxLength = 500) {
  const cleaned = String(text)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, '[REDACTED_KEY]')
    .replace(/gsk_[A-Za-z0-9]{10,}/g, '[REDACTED_KEY]')
    .replace(/(x-api-key|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 [REDACTED]');
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...[truncated]` : cleaned;
}

function resolveEnginePath() {
  const cppCoreDir = path.join(__dirname, '..', '..', 'cpp-core');
  const preferredName = process.platform === 'win32' ? 'recipe_engine.exe' : 'recipe_engine';
  const fallbackName = process.platform === 'win32' ? 'recipe_engine' : 'recipe_engine.exe';

  const preferredPath = path.join(cppCoreDir, preferredName);
  if (fs.existsSync(preferredPath)) return preferredPath;
  const fallbackPath = path.join(cppCoreDir, fallbackName);
  if (fs.existsSync(fallbackPath)) return fallbackPath;
  return preferredPath;
}

/**
 * Factory so the bridge is configurable and unit-testable (dependency
 * injection of the engine path / timeout) without touching globals.
 */
function createBridge(options = {}) {
  const enginePath = options.enginePath || resolveEnginePath();
  const dataDir = options.dataDir || path.join(__dirname, '..', '..', 'data');
  const timeoutMs = options.timeoutMs
    || Number(process.env.ENGINE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;
  const sourceEnv = options.env || process.env;

  /**
   * @param {string} command one of: generate | regenerate | customize | save | list | get | delete | health
   * @param {object} payload JSON-serializable request body for the command
   * @returns {Promise<object>} parsed JSON response from the C++ core
   * @throws {EngineError}
   */
  function runEngine(command, payload = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      let child;
      try {
        child = spawn(enginePath, [command, dataDir], {
          env: buildChildEnv(sourceEnv),
          windowsHide: true,
        });
      } catch (err) {
        return reject(new EngineError('ENGINE_UNAVAILABLE',
          'The recipe engine is not available.', err.message));
      }

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(reject, new EngineError('ENGINE_TIMEOUT',
          'The recipe engine took too long to respond.', `command=${command} timeoutMs=${timeoutMs}`));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill('SIGKILL');
          settle(reject, new EngineError('ENGINE_ERROR',
            'The recipe engine returned an unexpectedly large response.', `command=${command}`));
          return;
        }
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) stderr += chunk.toString();
      });

      child.on('error', (err) => {
        settle(reject, new EngineError('ENGINE_UNAVAILABLE',
          'The recipe engine is not available.',
          `${err.code || 'spawn error'} at ${enginePath}. Did you run 'npm run build:cpp'?`));
      });

      child.on('close', () => {
        if (settled) return;
        if (stderr.trim()) {
          // Non-fatal engine diagnostics (e.g. provider fallback). Server log only.
          console.warn(`[cpp-core stderr] ${redact(stderr.trim())}`);
        }
        try {
          settle(resolve, JSON.parse(stdout.trim()));
        } catch (parseErr) {
          settle(reject, new EngineError('ENGINE_BAD_RESPONSE',
            'The recipe engine returned an unreadable response.', redact(stdout)));
        }
      });

      // The child may exit before reading stdin (e.g. crash); ignore EPIPE.
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  return { runEngine };
}

const defaultBridge = createBridge();

module.exports = {
  runEngine: defaultBridge.runEngine,
  createBridge,
  EngineError,
  buildChildEnv,
  redact,
  ENV_ALLOWLIST,
};
