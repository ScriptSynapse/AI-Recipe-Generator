/**
 * authHelpers.js
 * ---------------------------------------------------------------------
 * Small pure helpers shared by the sign-in page, the nav status widget
 * and the pages that need a login. No DOM access, so they are
 * unit-testable in Node (same UMD pattern as sanitize.js).
 */
(function (root) {
  // The ONLY pages a login may send the user back to. An exact allow-list
  // (not "starts with /" or "same origin" pattern matching) so a crafted
  // ?next= value can never become an open redirect to another site, a
  // javascript: URL, a protocol-relative //host, or a path trick.
  const RETURN_PAGES = ['index.html', 'generator.html', 'results.html', 'recipes.html', 'ai-lab.html', 'security.html', 'analytics.html', 'settings.html'];

  function safeNextTarget(next, fallback = 'index.html') {
    return typeof next === 'string' && RETURN_PAGES.includes(next) ? next : fallback;
  }

  function loginUrlFor(page) {
    return `login.html?next=${encodeURIComponent(safeNextTarget(page))}`;
  }

  /** True if an API response is the backend saying "you need to be logged in". */
  function isAuthRequired(result) {
    return Boolean(result && result.success === false && result.error && result.error.code === 'AUTH_REQUIRED');
  }

  const AuthHelpers = { safeNextTarget, loginUrlFor, isAuthRequired, RETURN_PAGES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthHelpers;      // Node (tests)
  } else {
    root.AuthHelpers = AuthHelpers;    // browser global
  }
})(typeof window !== 'undefined' ? window : this);
