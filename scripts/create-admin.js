#!/usr/bin/env node
/**
 * create-admin.js -- operator tool to create (or promote) an ADMIN account.
 * ---------------------------------------------------------------------
 *   node scripts/create-admin.js <username>            create a new ADMIN
 *   node scripts/create-admin.js <username> --promote  make an EXISTING account an ADMIN
 *   options:  --data-dir <path>   where users.json lives (default: ./data)
 *             --help
 *
 * This is the ONLY way to obtain an admin account: there is deliberately
 * no HTTP route for it, and public registration always creates a plain
 * USER. Run it on the server, as the operator.
 *
 * The password is never accepted as a command-line argument (it would be
 * visible in `ps` output and shell history). For a NEW account it is read
 * from, in order:
 *   1. the ADMIN_PASSWORD environment variable;
 *   2. a hidden prompt (asked twice) when run in a terminal;
 *   3. the first line of standard input, when piped.
 * It is subject to the same password policy as any other account and is
 * never printed. Promotion needs no password.
 *
 * Exit codes: 0 success, 1 operation failed, 2 bad usage.
 */
const path = require('path');

const { PasswordHasher } = require('../backend/authentication/passwordHasher');
const { UserRepository } = require('../backend/authentication/userRepository');
const { SessionRepository } = require('../backend/authentication/sessionRepository');
const { AuthService, AuthError } = require('../backend/authentication/authService');
const { ROLES } = require('../backend/authentication/roles');
const { StoreError } = require('../backend/storage/JsonFileStore');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

const USAGE = `Usage:
  node scripts/create-admin.js <username>              create a new ADMIN account
  node scripts/create-admin.js <username> --promote    make an existing account an ADMIN
Options:
  --data-dir <path>   directory containing users.json (default: ./data)
  --help              show this message
Password (new accounts only): ADMIN_PASSWORD env var, else a hidden prompt, else first line of stdin.
`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { username: null, promote: false, dataDir: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--promote') options.promote = true;
    else if (arg === '--data-dir') {
      i += 1;
      if (i >= argv.length || argv[i].startsWith('--')) throw new UsageError('--data-dir needs a value.');
      options.dataDir = argv[i];
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option: ${arg}`);
    else if (options.username === null) options.username = arg;
    else throw new UsageError('Give exactly one username.');
  }
  if (!options.help && options.username === null) throw new UsageError('A username is required.');
  return options;
}

// Reads a line from a TTY without echoing it.
function promptHidden(question, { stdin, stdout }) {
  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return finish();
        if (ch === '\u0003') return finish(new Error('Cancelled.'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
      return undefined;
    };
    stdin.on('data', onData);
  });
}

function readFirstLine(stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => { data += chunk; });
    stdin.on('end', () => resolve(data.split('\n')[0].replace(/\r$/, '')));
    stdin.on('error', reject);
  });
}

async function obtainPassword({ env, stdin, stdout }) {
  if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
  if (stdin.isTTY) {
    const first = await promptHidden('Password: ', { stdin, stdout });
    const second = await promptHidden('Confirm password: ', { stdin, stdout });
    if (first !== second) throw new UsageError('The passwords do not match.');
    return first;
  }
  const line = await readFirstLine(stdin);
  if (!line) throw new UsageError('No password provided (set ADMIN_PASSWORD or pipe it on stdin).');
  return line;
}

/**
 * @param {string[]} argv arguments after the script name
 * @param {object} [io] injectable for tests: env, stdin, stdout, stderr, hasherOptions
 * @returns {Promise<number>} the process exit code
 */
async function run(argv, io = {}) {
  const env = io.env || process.env;
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const say = (text) => stdout.write(`${text}\n`);
  const complain = (text) => stderr.write(`${text}\n`);

  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    complain(`${err.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) { say(USAGE); return 0; }

  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const authService = new AuthService({
    userRepository: UserRepository.forFile(path.join(dataDir, 'users.json')),
    sessionRepository: SessionRepository.forFile(path.join(dataDir, 'sessions.json')),
    passwordHasher: new PasswordHasher(io.hasherOptions),
  });

  try {
    if (options.promote) {
      const result = authService.setRole(options.username, ROLES.ADMIN, { actor: 'operator-cli' });
      say(result.changed ? `"${result.user.username}" is now an ADMIN.` : `"${result.user.username}" is already an ADMIN; no change.`);
      return 0;
    }

    const password = await obtainPassword({ env, stdin, stdout });
    const admin = await authService.createUser(options.username, password, ROLES.ADMIN);
    say(`Created ADMIN account "${admin.username}".`);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) { complain(err.message); return 2; }
    if (err instanceof AuthError) {
      if (err.code === 'USERNAME_TAKEN') complain(`An account named "${options.username}" already exists. To make it an admin, re-run with --promote.`);
      else if (err.code === 'USER_NOT_FOUND') complain(`There is no account named "${options.username}".`);
      else complain(err.message);       // INVALID_USERNAME / INVALID_PASSWORD: fixed text, never echoes the password
      return 1;
    }
    if (err instanceof StoreError) { complain(`Could not read or write the user data: ${err.message}`); return 1; }
    if (err && err.message === 'Cancelled.') { complain('Cancelled.'); return 1; }
    complain(`Unexpected error: ${err && err.message}`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { run, parseArgs };
