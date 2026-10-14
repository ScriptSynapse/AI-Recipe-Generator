const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonFileStore, StoreError } = require('../../backend/storage/JsonFileStore');

function tempStore(defaultValue = () => ({ items: [] })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfs-'));
  const file = path.join(dir, 'nested', 'data.json');       // directory does not exist yet
  return { dir, file, store: new JsonFileStore(file, defaultValue) };
}
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test('a missing file reads as the default value', () => {
  const { dir, store } = tempStore();
  assert.deepEqual(store.read(), { items: [] });
  cleanup(dir);
});

test('write creates directories, round-trips, leaves no temp file, and uses mode 0600', { skip: process.platform === 'win32' }, () => {
  const { dir, file, store } = tempStore();
  store.write({ items: [1, 2, 3] });
  assert.deepEqual(store.read(), { items: [1, 2, 3] });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json'], 'no .tmp left behind');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'owner-only: the file holds password/session hashes');
  cleanup(dir);
});

test('update returns the mutator result and persists its changes', () => {
  const { dir, store } = tempStore();
  const result = store.update((data) => { data.items.push('a'); return data.items.length; });
  assert.equal(result, 1);
  assert.deepEqual(store.read(), { items: ['a'] });
  cleanup(dir);
});

test('if the mutator throws, nothing is written', () => {
  const { dir, store } = tempStore();
  store.write({ items: ['keep'] });
  assert.throws(() => store.update((data) => { data.items.push('lost'); throw new Error('boom'); }), /boom/);
  assert.deepEqual(store.read(), { items: ['keep'] });
  cleanup(dir);
});

test('a CORRUPT file throws StoreError and is NOT silently reset or overwritten', () => {
  const { dir, file, store } = tempStore();
  store.write({ items: ['precious'] });
  fs.writeFileSync(file, '{ this is not json');
  assert.throws(() => store.read(), StoreError);
  assert.throws(() => store.update((d) => { d.items.push('x'); }), StoreError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ this is not json', 'the damaged file must be left for the operator to inspect');
  cleanup(dir);
});

test('an empty file counts as corrupt, not as an empty store', () => {
  const { dir, file, store } = tempStore();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  assert.throws(() => store.read(), StoreError);
  cleanup(dir);
});

test('error messages carry the file name only, never the directory path', () => {
  const { dir, file, store } = tempStore();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'garbage');
  try { store.read(); assert.fail('should have thrown'); } catch (err) {
    assert.ok(err.message.includes('data.json'));
    assert.equal(err.message.includes(dir), false);
  }
  cleanup(dir);
});
