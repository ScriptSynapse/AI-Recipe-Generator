const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../../frontend/js/sanitize');

// ---- escapeHtml unit tests ----------------------------------------------

test('escapes all five HTML-significant characters', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('leaves ordinary ingredient text untouched', () => {
  assert.equal(escapeHtml('paneer tikka masala'), 'paneer tikka masala');
  assert.equal(escapeHtml('2 cups rice, 1 onion'), '2 cups rice, 1 onion');
});

test('null/undefined become empty string (never the text "undefined"); other types are stringified', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(0), '0');
  assert.equal(escapeHtml(false), 'false');
});

test('a <script> payload is rendered inert as text', () => {
  const out = escapeHtml('<script>alert(1)</script>');
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  assert.equal(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escaping is not idempotent by design: double-escaping is visible, not silently collapsed', () => {
  assert.equal(escapeHtml(escapeHtml('<')), '&amp;lt;');
});

// ---- The attribute-breakout bug this phase fixed -------------------------

// Models what the OLD escaper (div.textContent = s; return div.innerHTML)
// produced. Per the HTML fragment serialization algorithm, a Text node is
// serialized by escaping only & , U+00A0 , < and > -- quotes are NOT
// escaped (they only are when serializing an attribute VALUE). This is a
// model of the documented algorithm, not a run of a real browser.
function oldDomBasedEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const countQuotes = (s) => (s.match(/"/g) || []).length;

test('REGRESSION: the old escaper allowed breakout from a double-quoted attribute', () => {
  const payload = 'x" onfocus="alert(1)" autofocus="';
  const html = `<button type="button" aria-label="Remove ${oldDomBasedEscape(payload)}">`;
  // type="button" contributes 2 quotes, aria-label's own pair 2 more; any
  // extra means the payload escaped the attribute value.
  assert.ok(countQuotes(html) > 4, 'old escaper should have let the payload inject extra attributes');
  assert.ok(html.includes('onfocus="alert(1)"'));
});

test('FIX: escapeHtml keeps the same payload inside a double-quoted attribute', () => {
  const payload = 'x" onfocus="alert(1)" autofocus="';
  const html = `<button type="button" aria-label="Remove ${escapeHtml(payload)}">`;
  assert.equal(countQuotes(html), 4, 'only the template\'s own quotes may remain');
  assert.equal(html.includes('onfocus="'), false);
});

test('FIX: also safe inside a single-quoted attribute', () => {
  const payload = "x' onmouseover='alert(1)";
  const html = `<a title='${escapeHtml(payload)}'>`;
  assert.equal((html.match(/'/g) || []).length, 2);
  assert.equal(html.includes("onmouseover='"), false);
});

// ---- Source-level regression lint over the real frontend code -------------

const FRONTEND_JS = path.join(__dirname, '..', '..', 'frontend', 'js');

// Interpolations that are safe WITHOUT escapeHtml, each for a stated reason.
const SAFE_EXPRESSIONS = new Set([
  'sourceLabel',                    // recipes.js: one of two fixed class-name literals chosen by code
  'formatQuantity(ing.quantity)',   // results.js: formats a Number; can only emit digits, '.', '-' or 'NaN'
]);

/**
 * Returns a list of human-readable violations found in `source`:
 *  - an innerHTML assignment whose right-hand side is neither '' nor a
 *    template literal (i.e. an arbitrary string being parsed as HTML)
 *  - a ${...} inside an innerHTML template that is neither wrapped in
 *    escapeHtml(...) nor on the audited SAFE_EXPRESSIONS list
 *  - other raw-HTML / code-execution sinks
 */
function findUnsafeHtmlUsage(source) {
  const violations = [];

  const assignment = /\.innerHTML\s*=\s*([\s\S]*?);/g;
  let m;
  while ((m = assignment.exec(source)) !== null) {
    const rhs = m[1].trim();
    if (rhs === "''" || rhs === '""') continue;               // clearing a node is safe
    if (!(rhs.startsWith('`') && rhs.endsWith('`'))) {
      violations.push(`innerHTML assigned a non-template value: ${rhs.slice(0, 60)}`);
      continue;
    }
    const interpolation = /\$\{([^}]*)\}/g;
    let e;
    while ((e = interpolation.exec(rhs)) !== null) {
      const expr = e[1].trim();
      if (expr.startsWith('escapeHtml(') || SAFE_EXPRESSIONS.has(expr)) continue;
      violations.push(`unescaped interpolation in innerHTML template: \${${expr}}`);
    }
  }

  const sinks = [
    [/\.insertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
    [/\.outerHTML\s*=/, 'outerHTML assignment'],
    [/document\.write\s*\(/, 'document.write'],
    [/\beval\s*\(/, 'eval'],
    [/\bnew\s+Function\s*\(/, 'new Function'],
  ];
  for (const [pattern, label] of sinks) {
    if (pattern.test(source)) violations.push(`forbidden sink: ${label}`);
  }
  return violations;
}

test('LINT SELF-TEST: the lint really does flag unsafe patterns (so a clean result means something)', () => {
  assert.ok(findUnsafeHtmlUsage('el.innerHTML = `<b>${userInput}</b>`;').length > 0);
  assert.ok(findUnsafeHtmlUsage('el.innerHTML = userInput;').length > 0);
  assert.ok(findUnsafeHtmlUsage("el.innerHTML = '<b>' + name + '</b>';").length > 0);
  assert.ok(findUnsafeHtmlUsage('el.insertAdjacentHTML("beforeend", x);').length > 0);
  assert.ok(findUnsafeHtmlUsage('document.write(x);').length > 0);
  assert.ok(findUnsafeHtmlUsage('eval(x);').length > 0);
  // ...and does not flag the safe forms.
  assert.deepEqual(findUnsafeHtmlUsage("el.innerHTML = '';"), []);
  assert.deepEqual(findUnsafeHtmlUsage('el.innerHTML = `<b>${escapeHtml(name)}</b>`;'), []);
});

test('every frontend script uses only escaped interpolation and no raw-HTML sinks', () => {
  const files = fs.readdirSync(FRONTEND_JS).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 5, 'expected to scan the real frontend scripts');
  for (const file of files) {
    const source = fs.readFileSync(path.join(FRONTEND_JS, file), 'utf8');
    assert.deepEqual(findUnsafeHtmlUsage(source), [], `${file} has unsafe HTML usage`);
  }
});

test('no HTML page declares inline event handlers or javascript: URLs', () => {
  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  for (const file of fs.readdirSync(frontendDir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(frontendDir, file), 'utf8');
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${file} has an inline event handler`);
    assert.equal(/javascript\s*:/i.test(html), false, `${file} has a javascript: URL`);
  }
});

test('no frontend script assigns innerHTML/outerHTML or uses insertAdjacentHTML/document.write (comments ignored)', () => {
  const jsDir = path.join(__dirname, '..', '..', 'frontend', 'js');
  for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(jsDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\(/, `${file} injects markup`);
  }
});
