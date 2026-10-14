const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

const { run, parseArgs } = require('../../scripts/create-admin');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'create-admin.js');
const PASSWORD = 'correct horse battery';
const FAST = { N: 1024, r: 8, p: 1 };

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-admin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const users = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf8')).users;

// Runs the CLI in-process with captured output and a fake (non-TTY) stdin.
async function cli(argv, { env = {}, stdinText = '' } = {}) {
  let out = ''; let err = '';
  const code = await run(argv, {
    env, hasherOptions: FAST,
    stdin: Readable.from(stdinText ? [stdinText] : []),
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

// ---- argument parsing ---------------------------------------------------------

test('parseArgs: username, --promote, --data-dir, --help', () => {
  assert.deepEqual(parseArgs(['ops']), { username: 'ops', promote: false, dataDir: null, help: false });
  assert.deepEqual(parseArgs(['ops', '--promote', '--data-dir', '/x']), { username: 'ops', promote: true, dataDir: '/x', help: false });
  assert.equal(parseArgs(['--help']).help, true);
  for (const bad of [[], ['a', 'b'], ['a', '--bogus'], ['a', '--data-dir'], ['a', '--data-dir', '--promote']]) {
    assert.throws(() => parseArgs(bad), /./, JSON.stringify(bad));
  }
});

// ---- creating an admin -----------------------------------------------------------

test('creates an ADMIN from ADMIN_PASSWORD; the password is hashed and never printed', async (t) => {
  const dir = tempDir(t);
  const { code, out, err } = await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } });
  assert.equal(code, 0, err);
  assert.match(out, /Created ADMIN account "ops_admin"/);
  assert.equal(users(dir)[0].role, 'ADMIN');
  assert.match(users(dir)[0].passwordHash, /^scrypt\$/);
  assert.equal(fs.readFileSync(path.join(dir, 'users.json'), 'utf8').includes(PASSWORD), false);
  assert.equal((out + err).includes(PASSWORD), false);
});

test('reads the password from the first line of piped stdin (CRLF tolerated)', async (t) => {
  const dir = tempDir(t);
  const { code, err } = await cli(['ops_admin', '--data-dir', dir], { stdinText: `${PASSWORD}\r\nignored second line\n` });
  assert.equal(code, 0, err);
  assert.equal(users(dir)[0].role, 'ADMIN');
  // ...and it is the FIRST line that became the password:
  const authService = new (require('../../backend/authentication/authService').AuthService)({
    userRepository: require('../../backend/authentication/userRepository').UserRepository.forFile(path.join(dir, 'users.json')),
    sessionRepository: require('../../backend/authentication/sessionRepository').SessionRepository.forFile(path.join(dir, 'sessions.json')),
    passwordHasher: new (require('../../backend/authentication/passwordHasher').PasswordHasher)(FAST),
  });
  assert.ok(await authService.login('ops_admin', PASSWORD));
});

test('ADMIN_PASSWORD takes precedence over stdin', async (t) => {
  const dir = tempDir(t);
  const { code } = await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD }, stdinText: 'a-different-password-1\n' });
  assert.equal(code, 0);
});

test('no password available -> exit 2 and nothing is created', async (t) => {
  const dir = tempDir(t);
  const { code, err } = await cli(['ops_admin', '--data-dir', dir]);
  assert.equal(code, 2);
  assert.match(err, /No password provided/);
  assert.equal(fs.existsSync(path.join(dir, 'users.json')), false);
});

test('the normal password policy applies to admins too, and the rejected password is never echoed', async (t) => {
  const dir = tempDir(t);
  for (const weak of ['short', 'Password123', 'a'.repeat(129)]) {
    const { code, err, out } = await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: weak } });
    assert.equal(code, 1);
    assert.match(err, /Password|password/);
    assert.equal((err + out).includes(weak), false, 'the rejected password must never be echoed');
  }
  assert.equal(fs.existsSync(path.join(dir, 'users.json')), false);
});

test('an operator may use a reserved name such as "admin" (public registration cannot)', async (t) => {
  const dir = tempDir(t);
  const { code } = await cli(['admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } });
  assert.equal(code, 0);
  assert.equal(users(dir)[0].username, 'admin');
});

test('creating over an existing account fails safely and points to --promote', async (t) => {
  const dir = tempDir(t);
  await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } });
  const before = fs.readFileSync(path.join(dir, 'users.json'), 'utf8');
  const { code, err } = await cli(['OPS_ADMIN', '--data-dir', dir], { env: { ADMIN_PASSWORD: 'another long password' } });
  assert.equal(code, 1);
  assert.match(err, /already exists.*--promote/);
  assert.equal(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'), before, 'the existing account is untouched');
});

// ---- promoting ----------------------------------------------------------------------

async function seedUser(dir, username) {
  const { AuthService } = require('../../backend/authentication/authService');
  const { UserRepository } = require('../../backend/authentication/userRepository');
  const { SessionRepository } = require('../../backend/authentication/sessionRepository');
  const { PasswordHasher } = require('../../backend/authentication/passwordHasher');
  const svc = new AuthService({
    userRepository: UserRepository.forFile(path.join(dir, 'users.json')),
    sessionRepository: SessionRepository.forFile(path.join(dir, 'sessions.json')),
    passwordHasher: new PasswordHasher(FAST),
  });
  return svc.register(username, PASSWORD);
}

test('--promote turns an existing USER into an ADMIN without needing a password', async (t) => {
  const dir = tempDir(t);
  await seedUser(dir, 'carol_03');
  assert.equal(users(dir)[0].role, 'USER');
  const { code, out } = await cli(['carol_03', '--promote', '--data-dir', dir]);
  assert.equal(code, 0);
  assert.match(out, /"carol_03" is now an ADMIN/);
  assert.equal(users(dir)[0].role, 'ADMIN');
});

test('--promote: already an admin -> no change; unknown user -> failure', async (t) => {
  const dir = tempDir(t);
  await seedUser(dir, 'carol_03');
  await cli(['carol_03', '--promote', '--data-dir', dir]);
  const again = await cli(['carol_03', '--promote', '--data-dir', dir]);
  assert.equal(again.code, 0);
  assert.match(again.out, /already an ADMIN; no change/);

  const missing = await cli(['nobody_here', '--promote', '--data-dir', dir]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /no account named/);
});

test('a corrupted user file is reported, not "fixed" by overwriting it', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'users.json'), '{ corrupted');
  const { code, err } = await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } });
  assert.equal(code, 1);
  assert.match(err, /corrupted/);
  assert.equal(fs.readFileSync(path.join(dir, 'users.json'), 'utf8'), '{ corrupted');
});

// ---- the real script, as a separate process ---------------------------------------------

function spawnScript(args, { env = {}, input = '' } = {}) {
  const cleanEnv = { ...process.env }; delete cleanEnv.ADMIN_PASSWORD;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...cleanEnv, ...env }, input, encoding: 'utf8', timeout: 60000 });
}

test('real process: creates an admin with production hashing parameters; file is mode 0600', { skip: process.platform === 'win32' }, (t) => {
  const dir = tempDir(t);
  const r = spawnScript(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Created ADMIN account/);
  assert.deepEqual(users(dir)[0].passwordHash.split('$').slice(0, 4), ['scrypt', '32768', '8', '3']);
  assert.equal(fs.statSync(path.join(dir, 'users.json')).mode & 0o777, 0o600);
  assert.equal((r.stdout + r.stderr).includes(PASSWORD), false);
});

test('real process: piped stdin works; exit codes are 0 / 1 / 2 as documented', (t) => {
  const dir = tempDir(t);
  assert.equal(spawnScript(['ops_admin', '--data-dir', dir], { input: `${PASSWORD}\n` }).status, 0);
  assert.equal(spawnScript(['ops_admin', '--data-dir', dir], { input: `${PASSWORD}\n` }).status, 1, 'duplicate');
  assert.equal(spawnScript(['--data-dir', dir]).status, 2, 'missing username');
  assert.equal(spawnScript(['x_user', '--data-dir', dir], { input: '' }).status, 2, 'no password');
  assert.equal(spawnScript(['--help']).status, 0);
});

// ---- the point of it all: an admin made this way really is one, over HTTP --------------------

let express = null;
try { express = require.resolve('express'); } catch { /* not installed */ }

test('an admin created by the script can log in over HTTP and reach admin endpoints', { skip: express ? false : 'express is not installed (run npm install)' }, async (t) => {
  const { FakeEngine } = require('../helpers/fakeEngine');
  const { startApp, call, cookiePair } = require('../helpers/httpHarness');
  const dir = tempDir(t);
  assert.equal((await cli(['ops_admin', '--data-dir', dir], { env: { ADMIN_PASSWORD: PASSWORD } })).code, 0);

  const srv = await startApp({ runEngine: new FakeEngine().runEngine });
  t.after(srv.close);
  // point the running app at the script's data directory
  const { UserRepository } = require('../../backend/authentication/userRepository');
  fs.copyFileSync(path.join(dir, 'users.json'), path.join(srv.dataDir, 'users.json'));
  assert.ok(UserRepository.forFile(path.join(srv.dataDir, 'users.json')).findByUsername('ops_admin'));

  const login = await call(srv.base, 'POST', '/api/auth/login', { body: { username: 'ops_admin', password: PASSWORD } });
  assert.equal(login.status, 200);
  assert.equal(login.json.data.user.role, 'ADMIN');
  assert.equal((await call(srv.base, 'GET', '/api/admin/health', { cookie: cookiePair(login) })).status, 200);
});
