/**
 * cppBridge.js
 * ---------------------------------------------------------------------
 * The single point of contact between the Express API and the compiled
 * C++ OOP core (cpp-core/recipe_engine). Every backend route funnels
 * through `runEngine(command, payload)`, which spawns the C++ binary,
 * writes the JSON payload to its stdin, and parses the JSON it prints
 * to stdout.
 *
 * Keeping this in one module means the rest of the backend never has
 * to know how the C++ core is invoked (path, args, encoding) — only
 * that it returns a Promise of a parsed JSON response.
 */

const { spawn } = require('child_process');
const path = require('path');

const ENGINE_PATH = path.join(__dirname, '..', '..', 'cpp-core', 'recipe_engine');
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Runs the C++ recipe engine with a given command and JSON payload.
 * @param {string} command - one of: generate | regenerate | customize |
 *                            save | list | get | delete | health
 * @param {object} payload - JSON-serializable request body for the command
 * @returns {Promise<object>} parsed JSON response from the C++ core
 */
function runEngine(command, payload = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ENGINE_PATH, [command, DATA_DIR], {
      env: process.env, // forwards ANTHROPIC_API_KEY etc. to the C++ AIGenerator
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      reject(new Error(`Failed to start C++ recipe engine at ${ENGINE_PATH}: ${err.message}. Did you run 'npm run build:cpp'?`));
    });

    child.on('close', () => {
      if (stderr) {
        // The C++ core logs non-fatal provider failures (e.g. AI fallback
        // triggered) to stderr; surface for server-side visibility only.
        console.warn(`[cpp-core stderr] ${stderr.trim()}`);
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (parseErr) {
        reject(new Error(`C++ recipe engine returned invalid JSON: ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

module.exports = { runEngine };
