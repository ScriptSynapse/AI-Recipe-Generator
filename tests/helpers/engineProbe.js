/**
 * Decides whether tests that need the compiled C++ engine can run.
 *
 * "The file exists" is not enough: a stale binary, one built for another
 * operating system (this repo has had one committed), or a corrupt build
 * would make those tests FAIL with a misleading "engine not available"
 * error. So the probe actually runs the engine once -- `health`, which
 * only reads -- and the tests skip, with the reason, unless it answers
 * with a valid JSON envelope.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');

function resolveEnginePath() {
  return process.env.RECIPE_ENGINE_PATH
    || path.join(REPO_ROOT, 'cpp-core', process.platform === 'win32' ? 'recipe_engine.exe' : 'recipe_engine');
}

/** @returns {{usable: boolean, enginePath: string, skipReason: (string|false)}} */
function probeEngine() {
  const enginePath = resolveEnginePath();
  if (!fs.existsSync(enginePath)) {
    return { usable: false, enginePath, skipReason: 'C++ engine not built (npm run build:cpp)' };
  }
  const result = spawnSync(enginePath, ['health', DATA_DIR], { input: '{}', encoding: 'utf8', timeout: 20000 });
  if (result.error || result.status === null) {
    const why = (result.error && result.error.code) || 'did not run';
    return { usable: false, enginePath, skipReason: `C++ engine binary is present but cannot run here (${why}); rebuild with npm run build:cpp` };
  }
  try {
    const envelope = JSON.parse(result.stdout);
    if (envelope && typeof envelope.success === 'boolean') return { usable: true, enginePath, skipReason: false };
  } catch { /* fall through */ }
  return { usable: false, enginePath, skipReason: 'C++ engine ran but returned an unreadable response; rebuild with npm run build:cpp' };
}

module.exports = { probeEngine, resolveEnginePath };
