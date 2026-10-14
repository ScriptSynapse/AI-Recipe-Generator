/**
 * sanitize.js
 * ---------------------------------------------------------------------
 * The ONE place the frontend escapes untrusted text (user input and
 * LLM output) before it is placed into an HTML string. Replaces three
 * separate copies of escapeHtml that used to live in generator.js,
 * recipes.js, and results.js.
 *
 * Why not the old trick (div.textContent = s; return div.innerHTML)?
 * That serializer escapes & < > but NOT quotes, so its output is only
 * safe as element TEXT. Placed inside a quoted attribute -- which
 * generator.js did, in aria-label="Remove ${...}" -- a value containing
 * a double quote could break out of the attribute and inject one of its
 * own (e.g. an onfocus handler). This version escapes all five
 * HTML-significant characters, so its output is safe both as element
 * text and inside a single- or double-quoted attribute value.
 *
 * It does NOT make output safe in other contexts: never put escaped
 * text into an unquoted attribute, a <script> block, a style block, or
 * a URL attribute (href/src) -- those need different handling. Where
 * possible, prefer safe DOM APIs (textContent, setAttribute,
 * createTextNode) over building HTML strings at all; this helper exists
 * for the places that still assemble markup from a template.
 *
 * Pure string function (no DOM access) so it is unit-testable in Node.
 */
(function (root) {
  const ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  /**
   * @param {*} value anything; null/undefined become '' (never the
   *                  literal text "undefined"), everything else is
   *                  converted with String().
   * @returns {string} text with & < > " ' replaced by HTML entities.
   */
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
  }

  const Sanitize = { escapeHtml };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Sanitize;      // Node (tests)
  } else {
    root.Sanitize = Sanitize;       // browser global, same convention as RecipeAPI
  }
})(typeof window !== 'undefined' ? window : this);
