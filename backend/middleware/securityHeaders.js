/**
 * Security headers for every response (static files and API alike).
 *
 * CSP is written for THIS frontend, which has no inline <script> at all:
 *   script-src 'self'            => injected markup can't run script
 *   style-src  'self' + Google Fonts stylesheet; style *attributes* (the
 *              pages use a few) are allowed via style-src-attr only
 *   object-src 'none', base-uri 'none', frame-ancestors 'none', form-action 'self'
 * HSTS is sent only when the deployment is HTTPS (it would otherwise be
 * ignored on http and could confuse local testing).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "style-src-attr 'unsafe-inline'",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function createSecurityHeaders({ hsts = false } = {}) {
  return function securityHeaders(req, res, next) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

module.exports = { createSecurityHeaders, CSP };
