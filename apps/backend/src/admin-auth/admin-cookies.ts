import { ADMIN_PREAUTH_COOKIE, ADMIN_PREAUTH_TTL_SECONDS, ADMIN_SESSION_COOKIE } from './admin-auth-constants';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads one cookie from the Cookie header without a cookie library. A name that appears more than once is ambiguous
 * and treated as absent; a value that is not exactly a canonical 43-character token is treated as absent too.
 */
export function readCookieToken(header: string | string[] | undefined, name: string): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  let found: string | undefined;
  let count = 0;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator < 1) {
      continue;
    }
    if (trimmed.slice(0, separator) === name) {
      count += 1;
      found = trimmed.slice(separator + 1);
    }
  }
  if (count !== 1 || found === undefined || !TOKEN_SHAPE.test(found)) {
    return undefined;
  }
  return found;
}

/**
 * Set-Cookie value. The __Host- prefix requires Secure, Path=/ and no Domain; HttpOnly and SameSite=Strict keep the
 * value away from scripts and cross-site requests. The lifetime is absolute (Max-Age to the server expiry).
 */
function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return cookie(ADMIN_SESSION_COOKIE, token, Math.max(1, Math.floor(maxAgeSeconds)));
}

export function preauthCookie(token: string): string {
  return cookie(ADMIN_PREAUTH_COOKIE, token, ADMIN_PREAUTH_TTL_SECONDS);
}

/** Expired cookie with the SAME attributes, which is how a browser matches and removes it. */
export function clearedCookie(name: typeof ADMIN_SESSION_COOKIE | typeof ADMIN_PREAUTH_COOKIE): string {
  return `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=Strict`;
}
