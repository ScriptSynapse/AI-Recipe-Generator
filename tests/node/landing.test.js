'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', 'frontend');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const html = read('landing.html');

test('LP-01 no inline scripts or event-handler attributes (CSP script-src self)', () => {
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html));
  assert.ok(!/\son[a-z]+\s*=/i.test(html));
  assert.ok(!/javascript:/i.test(html));
});

test('LP-02 local links and assets resolve to existing files', () => {
  const refs = [...html.matchAll(/(?<![-\w])(?:href|src)="([^"#?]+)/g)].map((m) => m[1])
    .filter((r) => !/^(https?:|mailto:)/.test(r));
  assert.ok(refs.length > 5);
  for (const r of refs) assert.ok(fs.existsSync(path.join(FE, r)), 'missing: ' + r);
});

test('LP-03 placeholders are labelled and optional files are not required', () => {
  assert.match(html, /Screenshot placeholder/);
  assert.match(html, /Demo video placeholder/);
  for (const f of ['generator.png', 'ai-lab.png', 'security.png']) assert.ok(html.includes('assets/screens/' + f));
  assert.ok(html.includes('assets/demo.mp4'));
  assert.match(html, /\[Student names\]/);
});

test('LP-04 facts match the code', () => {
  const counts = [...html.matchAll(/data-count="(\d+)"/g)].map((m) => Number(m[1]));
  const providers = fs.readdirSync(path.join(__dirname, '..', '..', 'cpp-core', 'ai', 'providers'))
    .filter((f) => /Provider\.cpp$/.test(f)).length;
  const events = Object.keys(require('../../backend/audit/auditEvents').EVENT_TYPES).length;
  assert.deepStrictEqual(counts, [providers, 3, events, 2]);
});

test('LP-05 landing.js uses no HTML-string sinks and respects reduced motion', () => {
  const js = read('js/landing.js');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
  assert.match(js, /prefers-reduced-motion/);
  assert.match(read('css/landing.css'), /prefers-reduced-motion/);
  assert.match(read('css/polish.css'), /prefers-reduced-motion/);
});

test('LP-06 polish.css is linked on every page', () => {
  for (const f of fs.readdirSync(FE).filter((n) => n.endsWith('.html'))) {
    assert.ok(read(f).includes('css/polish.css'), f);
  }
});

test('LP-07 backend serves the landing page at /', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'app.js'), 'utf8');
  assert.match(app, /app\.get\('\/'[\s\S]*landing\.html/);
});
