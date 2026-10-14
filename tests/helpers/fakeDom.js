/**
 * A minimal fake DOM, just enough to run the small page scripts
 * (auth-status.js, login.js) in a Node vm sandbox and observe what they
 * do. It is NOT a browser: it proves the scripts' logic, not their
 * rendering or CSS.
 *
 * Deliberately strict: assigning to innerHTML THROWS, so a script that
 * ever builds markup from a string cannot pass these tests.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeElement {
  constructor(tagName = 'div', id = null) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this._text = '';
    this.attributes = {};
    this.listeners = {};
    this.classes = new Set();
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.href = '';
    this.type = '';
    this.style = {};
    this.classList = {
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      contains: (c) => this.classes.has(c),
    };
  }

  set textContent(value) { this._text = String(value); this.children = []; }   // like the DOM: replaces children
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }

  set innerHTML(_value) { throw new Error('innerHTML must not be used by these scripts'); }
  get innerHTML() { throw new Error('innerHTML must not be used by these scripts'); }

  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }

  // Just enough selector support for the page scripts: '.class' or 'tag', searched through descendants.
  querySelectorAll(selector) {
    const out = [];
    const matches = (node) => (selector.startsWith('.')
      ? node.classes.has(selector.slice(1)) || String(node.className).split(/\s+/).includes(selector.slice(1))
      : node.tagName === selector.toUpperCase());
    const walk = (node) => { node.children.forEach((c) => { if (matches(c)) out.push(c); walk(c); }); };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
  removeAttribute(name) { delete this.attributes[name]; }

  async dispatch(type, event = {}) {
    let defaultPrevented = false;
    const e = { preventDefault() { defaultPrevented = true; }, ...event };
    for (const fn of this.listeners[type] || []) await fn(e);
    return { defaultPrevented };
  }
}

function createDocument(ids = []) {
  const registry = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  const roots = [];
  return {
    registry,
    roots,
    querySelectorAll(selector) { const holder = new FakeElement('body'); holder.children = roots; return holder.querySelectorAll(selector); },
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => { const n = new FakeElement('#text'); n._text = String(text); return n; },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Runs a frontend script (relative to frontend/js) inside a sandbox with the given globals. */
function runFrontendScript(file, globals) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', file), 'utf8');
  const sandbox = { console, URLSearchParams, ...globals };
  vm.runInNewContext(source, sandbox, { filename: file });
  return sandbox;
}

module.exports = { FakeElement, createDocument, flush, runFrontendScript };
