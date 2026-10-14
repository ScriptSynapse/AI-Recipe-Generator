// The npm build script must list every C++ translation unit. A forgotten file
// compiles fine in the unit-test script (which has its own list) but breaks
// `npm run build:cpp` with a link error on a fresh checkout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sourceFiles } = require('../../scripts/build-cpp');

function cppFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? cppFiles(full, base) : e.name.endsWith('.cpp') ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

test('BS-01 build-cpp.js lists every .cpp under cpp-core, and nothing that does not exist', () => {
  const root = path.join(__dirname, '..', '..', 'cpp-core');
  const onDisk = cppFiles(root).sort();
  assert.deepEqual([...sourceFiles].sort(), onDisk);
});

test('BS-02 the unit-test script (run_tests.sh) builds from the same sources, minus main.cpp', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'run_tests.sh'), 'utf8');
  const listed = (sh.match(/cpp-core\/[A-Za-z/]+\.cpp/g) || []).map((p) => p.replace('cpp-core/', ''));
  assert.deepEqual([...new Set(listed)].sort(), sourceFiles.filter((f) => f !== 'main.cpp').sort());
});
