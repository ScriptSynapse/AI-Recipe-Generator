/**
 * SessionCookie -- how the session token travels between browser and
 * server.
 *
 * The token lives in an HttpOnly cookie, so page JavaScript (and therefore
 * any XSS) can never read it. SameSite=Strict means browsers don't attach
 * it to cross-site requests, which blocks the usual CSRF vector. In
 * production (`secure: true`) the cookie is also Secure and uses the
 * "__Host-" prefix, which browsers only accept if it is Secure, has
 * Path=/, and carries no Domain attribute.
 *
 * `Authorization: Bearer <token>` is accepted too, for non-browser API
 * clients; unlike a cookie it is never attached automatically, so it adds
 * no CSRF exposure.
 */
function parseCookies(header) {
  const cookies = Object.create(null);
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (!name || name in cookies) continue;          // first occurrence wins
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try { cookies[name] = decodeURIComponent(value); } catch { cookies[name] = value; }
  }
  return cookies;
}

function appendHeader(res, name, value) {
  const existing = res.getHeader ? res.getHeader(name) : undefined;
  if (existing === undefined) res.setHeader(name, value);
  else res.setHeader(name, [].concat(existing, value));
}

class SessionCookie {
  constructor({ secure = false, name } = {}) {
    this.secure = secure;
    this.name = name || (secure ? '__Host-session' : 'session');
  }

  /** @returns {{token: string, source: 'cookie'|'bearer'} | null} */
  extract(req) {
    const headers = (req && req.headers) || {};
    const cookieToken = parseCookies(headers.cookie)[this.name];
    if (cookieToken) return { token: cookieToken, source: 'cookie' };
    const match = /^Bearer\s+(\S+)$/i.exec(headers.authorization || '');
    if (match) return { token: match[1], source: 'bearer' };
    return null;
  }

  _attributes(maxAgeSeconds) {
    return `Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }

  /**
   * @param {number} maxAgeMs how long the browser should keep the cookie.
   * A DURATION, not an absolute time: AuthService owns the clock, and
   * deriving Max-Age from a second clock here would let the two disagree.
   */
  set(res, token, maxAgeMs) {
    const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000));
    appendHeader(res, 'Set-Cookie', `${this.name}=${token}; ${this._attributes(maxAge)}`);
  }

  clear(res) {
    appendHeader(res, 'Set-Cookie', `${this.name}=; ${this._attributes(0)}`);
  }
}

module.exports = { SessionCookie, parseCookies };
