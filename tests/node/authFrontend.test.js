// Frontend sign-in code, verified WITHOUT a browser: pure helpers directly,
// the two page scripts against a fake DOM (tests/helpers/fakeDom.js), and
// the HTML structure by inspection. This shows the scripts' logic is right
// (what they call, where they redirect, what they put on the page); it does
// not show how the pages look or behave in a real browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const AuthHelpers = require('../../frontend/js/authHelpers');
const { FakeElement, createDocument, flush, runFrontendScript } = require('../helpers/fakeDom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend');
const PAGES = ['index.html', 'generator.html', 'results.html', 'recipes.html', 'login.html'];
const read = (rel) => fs.readFileSync(path.join(FRONTEND, rel), 'utf8');

// ---- AuthHelpers (pure) ----------------------------------------------------------

test('safeNextTarget accepts only this site\'s own pages', () => {
  for (const page of AuthHelpers.RETURN_PAGES) assert.equal(AuthHelpers.safeNextTarget(page), page);
  assert.equal(AuthHelpers.safeNextTarget('recipes.html', 'x.html'), 'recipes.html');
});

test('safeNextTarget defeats open-redirect and injection attempts', () => {
  const attacks = [
    'https://evil.example', 'http://evil.example/recipes.html', '//evil.example', '///evil.example',
    '\\\\evil.example', '/\\evil.example', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>',
    '../index.html', '/index.html', './index.html', 'index.html?x=1', 'index.html#x', 'index.html ',
    ' index.html', 'index.html\n', 'INDEX.HTML', 'login.html', 'recipes.html/../../etc/passwd',
    'index.html%0d%0aLocation:%20https://evil.example', '', null, undefined, 42, {}, ['index.html'], true,
  ];
  for (const attack of attacks) assert.equal(AuthHelpers.safeNextTarget(attack), 'index.html', JSON.stringify(attack));
  assert.equal(AuthHelpers.safeNextTarget('https://evil.example', 'generator.html'), 'generator.html');
});

test('loginUrlFor builds a login URL whose next value survives the same check', () => {
  assert.equal(AuthHelpers.loginUrlFor('results.html'), 'login.html?next=results.html');
  assert.equal(AuthHelpers.loginUrlFor('https://evil.example'), 'login.html?next=index.html');
  const next = new URLSearchParams(AuthHelpers.loginUrlFor('recipes.html').split('?')[1]).get('next');
  assert.equal(AuthHelpers.safeNextTarget(next), 'recipes.html');
});

test('isAuthRequired recognises only the backend\'s AUTH_REQUIRED error', () => {
  assert.equal(AuthHelpers.isAuthRequired({ success: false, error: { code: 'AUTH_REQUIRED' } }), true);
  for (const other of [{ success: true }, { success: false, error: { code: 'FORBIDDEN' } }, { success: false },
    { success: false, error: {} }, null, undefined, 'AUTH_REQUIRED', { error: { code: 'AUTH_REQUIRED' } }]) {
    assert.equal(AuthHelpers.isAuthRequired(other), false, JSON.stringify(other));
  }
});

// ---- auth-status.js (header widget), against a fake DOM ---------------------------------

function runStatus({ pathname = '/results.html', me, withSlot = true }) {
  const document = createDocument(withSlot ? ['auth-nav'] : []);
  const calls = { logout: 0 };
  const window = { location: { pathname, href: '' } };
  const AuthAPI = { me: async () => me, logout: async () => { calls.logout += 1; return { success: true }; } };
  runFrontendScript('auth-status.js', { document, window, AuthAPI, AuthHelpers });
  return { slot: document.getElementById('auth-nav'), window, calls };
}

test('auth-status: signed out -> a "Sign in" link that returns to the current page', async () => {
  const { slot } = runStatus({ me: { success: false, error: { code: 'AUTH_REQUIRED' } } });
  await flush();
  assert.equal(slot.children.length, 1);
  assert.equal(slot.children[0].tagName, 'A');
  assert.equal(slot.children[0].textContent, 'Sign in');
  assert.equal(slot.children[0].href, 'login.html?next=results.html');
});

test('auth-status: an unrecognised current page cannot smuggle itself into the return URL', async () => {
  const { slot } = runStatus({ pathname: '/evil.html', me: { success: false } });
  await flush();
  assert.equal(slot.children[0].href, 'login.html?next=index.html');
});

test('auth-status: signed in -> username and a Sign out button', async () => {
  const { slot } = runStatus({ me: { success: true, data: { user: { id: 'u1', username: 'alice_01', role: 'USER' } } } });
  await flush();
  assert.equal(slot.children.length, 2);
  assert.equal(slot.children[0].className, 'auth-user');
  assert.equal(slot.children[0].textContent, 'alice_01');
  assert.equal(slot.children[1].tagName, 'BUTTON');
  assert.equal(slot.children[1].textContent, 'Sign out');
});

test('auth-status: a hostile username is rendered as inert text (the fake DOM throws on any innerHTML use)', async () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const { slot } = runStatus({ me: { success: true, data: { user: { username: hostile } } } });
  await flush();
  assert.equal(slot.children[0].textContent, hostile);
  assert.equal(slot.children.length, 2, 'it did not become extra DOM nodes');
});

test('auth-status: Sign out calls the API, disables the button and goes home', async () => {
  const { slot, window, calls } = runStatus({ me: { success: true, data: { user: { username: 'alice_01' } } } });
  await flush();
  const button = slot.children[1];
  await button.dispatch('click');
  assert.equal(calls.logout, 1);
  assert.equal(button.disabled, true);
  assert.equal(window.location.href, 'index.html');
});

test('auth-status: a page without the slot is left alone (no error)', async () => {
  assert.doesNotThrow(() => runStatus({ withSlot: false, me: { success: true } }));
});

// ---- login.js (sign-in / register forms), against a fake DOM ------------------------------

function runLogin({ search = '', login, register }) {
  const document = createDocument(['auth-error', 'login-form', 'login-username', 'login-password', 'login-submit',
    'register-form', 'register-username', 'register-password', 'register-submit']);
  const window = { location: { search, href: '' } };
  const seen = { login: [], register: [] };
  const AuthAPI = {
    login: (u, p) => { seen.login.push([u, p]); return typeof login === 'function' ? login() : Promise.resolve(login); },
    register: (u, p) => { seen.register.push([u, p]); return typeof register === 'function' ? register() : Promise.resolve(register); },
  };
  runFrontendScript('login.js', { document, window, AuthAPI, AuthHelpers });
  const el = (id) => document.getElementById(id);
  return { el, window, seen };
}
const OK = { success: true, data: { user: { username: 'alice_01' } } };

test('login: submits the typed credentials and returns to a valid ?next page', async () => {
  const { el, window, seen } = runLogin({ search: '?next=recipes.html', login: OK });
  el('login-username').value = 'alice_01';
  el('login-password').value = 'correct horse battery';
  const { defaultPrevented } = await el('login-form').dispatch('submit');
  assert.equal(defaultPrevented, true, 'the browser must not do a native form POST');
  assert.deepEqual(seen.login, [['alice_01', 'correct horse battery']]);
  assert.equal(window.location.href, 'recipes.html');
});

test('login: a hostile or missing ?next falls back to the home page (no open redirect)', async () => {
  for (const search of ['?next=https://evil.example', '?next=//evil.example', '?next=javascript:alert(1)', '?next=login.html', '', '?other=1']) {
    const { el, window } = runLogin({ search, login: OK });
    await el('login-form').dispatch('submit');
    assert.equal(window.location.href, 'index.html', search);
  }
});

test('login: a failure shows the server\'s message, clears the password, re-enables the button, stays put', async () => {
  const { el, window } = runLogin({ login: { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } } });
  el('login-username').value = 'alice_01';
  el('login-password').value = 'wrong password!!';
  await el('login-form').dispatch('submit');
  assert.equal(el('auth-error').textContent, 'Invalid username or password.');
  assert.equal(el('auth-error').classList.contains('visible'), true);
  assert.equal(el('login-password').value, '');
  assert.equal(el('login-username').value, 'alice_01', 'the username is kept for the retry');
  assert.equal(el('login-submit').disabled, false);
  assert.equal(window.location.href, '');
});

test('login: the button is disabled while a request is in flight (no double submit)', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { el } = runLogin({ login: () => pending });
  const submitted = el('login-form').dispatch('submit');
  await flush();
  assert.equal(el('login-submit').disabled, true);
  release(OK);
  await submitted;
});

test('login: an error clears when the user tries again', async () => {
  let attempt = 0;
  const { el } = runLogin({ login: () => Promise.resolve(++attempt === 1 ? { success: false, error: { message: 'Nope.' } } : OK) });
  await el('login-form').dispatch('submit');
  assert.equal(el('auth-error').classList.contains('visible'), true);
  await el('login-form').dispatch('submit');
  assert.equal(el('auth-error').classList.contains('visible'), false);
});

test('login: a failure with no message gets a generic one; a hostile message stays inert text', async () => {
  const bare = runLogin({ login: { success: false } });
  await bare.el('login-form').dispatch('submit');
  assert.match(bare.el('auth-error').textContent, /Something went wrong/);

  const hostile = runLogin({ login: { success: false, error: { message: '<script>alert(1)</script>' } } });
  await hostile.el('login-form').dispatch('submit');
  assert.equal(hostile.el('auth-error').textContent, '<script>alert(1)</script>');
});

test('register: uses the register API call with its own fields and the same safe redirect', async () => {
  const { el, window, seen } = runLogin({ search: '?next=generator.html', register: OK });
  el('register-username').value = 'bob_02';
  el('register-password').value = 'a long enough passphrase';
  await el('register-form').dispatch('submit');
  assert.deepEqual(seen.register, [['bob_02', 'a long enough passphrase']]);
  assert.deepEqual(seen.login, []);
  assert.equal(window.location.href, 'generator.html');
});

// ---- HTML structure -------------------------------------------------------------------------

test('every page has the auth slot and loads api.js, authHelpers.js, auth-status.js in a working order', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(html.includes('id="auth-nav"'), `${page} needs the #auth-nav slot`);
    const order = ['js/api.js', 'js/authHelpers.js', 'js/auth-status.js'].map((s) => html.indexOf(`src="${s}"`));
    assert.ok(order.every((i) => i !== -1), `${page} must load all three`);
    assert.ok(order[0] < order[1] && order[1] < order[2], `${page}: api.js, then authHelpers.js, then auth-status.js`);
    for (const pageScript of html.match(/src="js\/(?:app|generator|results|recipes|login)\.js"/g) || []) {
      assert.ok(html.indexOf(pageScript) > order[2], `${page}: page script must come after the auth scripts`);
    }
  }
});

test('login.html: every input has a label, correct autocomplete hints, and an alert region', () => {
  const html = read('login.html');
  const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(inputs.length, 4);
  for (const input of inputs) {
    const id = /id="([^"]+)"/.exec(input)[1];
    assert.ok(html.includes(`for="${id}"`), `input #${id} has no <label for>`);
  }
  // Attribute lookup that does not depend on the order the attributes are written in.
  const attr = (id, name) => {
    const tag = inputs.find((i) => i.includes(`id="${id}"`));
    assert.ok(tag, `no <input id="${id}">`);
    const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    assert.ok(match, `<input id="${id}"> has no ${name} attribute`);
    return match[1];
  };
  assert.equal(attr('login-username', 'autocomplete'), 'username');
  assert.equal(attr('login-password', 'autocomplete'), 'current-password');
  assert.equal(attr('register-username', 'autocomplete'), 'username');
  assert.equal(attr('register-password', 'autocomplete'), 'new-password');
  assert.equal(attr('login-password', 'type'), 'password');
  assert.equal(attr('register-password', 'type'), 'password');
  assert.match(html, /id="auth-error"[^>]*role="alert"/);
});

test('every <script src> on every page points at a file that exists', () => {
  for (const page of PAGES) {
    for (const [, src] of read(page).matchAll(/<script[^>]+src="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(FRONTEND, src)), `${page} references missing ${src}`);
    }
  }
});

test('every frontend script is syntactically valid JavaScript', () => {
  for (const file of fs.readdirSync(path.join(FRONTEND, 'js')).filter((f) => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(read(`js/${file}`), { filename: file }), file);
  }
});

test('pages that need a login redirect to the sign-in page when the API says AUTH_REQUIRED', () => {
  for (const [file, page] of [['results.js', 'results.html'], ['recipes.js', 'recipes.html']]) {
    const source = read(`js/${file}`);
    assert.ok(source.includes('AuthHelpers.isAuthRequired('), `${file} must check for AUTH_REQUIRED`);
    assert.ok(source.includes(`AuthHelpers.loginUrlFor('${page}')`), `${file} must send the user to sign in and back to ${page}`);
  }
});
