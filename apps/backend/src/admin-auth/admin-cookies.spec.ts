import { describe, expect, it } from '@jest/globals';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from './admin-auth-constants';
import { clearedCookie, preauthCookie, readCookieToken, sessionCookie } from './admin-cookies';

const TOKEN = 'A'.repeat(43);
const OTHER = 'B'.repeat(43);

describe('readCookieToken', () => {
  it('reads one canonical token by exact name', () => {
    expect(readCookieToken(`${ADMIN_SESSION_COOKIE}=${TOKEN}`, ADMIN_SESSION_COOKIE)).toBe(TOKEN);
    expect(readCookieToken(`x=1; ${ADMIN_SESSION_COOKIE}=${TOKEN}; y=2`, ADMIN_SESSION_COOKIE)).toBe(TOKEN);
    expect(readCookieToken(`${ADMIN_PREAUTH_COOKIE}=${OTHER}; ${ADMIN_SESSION_COOKIE}=${TOKEN}`, ADMIN_PREAUTH_COOKIE)).toBe(OTHER);
  });

  it('does not confuse the session name with the preauth name', () => {
    expect(readCookieToken(`${ADMIN_PREAUTH_COOKIE}=${TOKEN}`, ADMIN_SESSION_COOKIE)).toBeUndefined();
  });

  it('treats a repeated name as absent', () => {
    expect(readCookieToken(`${ADMIN_SESSION_COOKIE}=${TOKEN}; ${ADMIN_SESSION_COOKIE}=${OTHER}`, ADMIN_SESSION_COOKIE)).toBeUndefined();
  });

  it.each(['', 'short', `${'A'.repeat(42)}=`, `${'A'.repeat(44)}`, `${'A'.repeat(42)}+`, `"${TOKEN}"`])(
    'treats the malformed value %p as absent',
    (value) => {
      expect(readCookieToken(`${ADMIN_SESSION_COOKIE}=${value}`, ADMIN_SESSION_COOKIE)).toBeUndefined();
    },
  );

  it('treats a missing or non-string header as absent', () => {
    expect(readCookieToken(undefined, ADMIN_SESSION_COOKIE)).toBeUndefined();
    expect(readCookieToken([`${ADMIN_SESSION_COOKIE}=${TOKEN}`], ADMIN_SESSION_COOKIE)).toBeUndefined();
  });
});

describe('Set-Cookie attributes', () => {
  const required = ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'];

  it('session cookie: __Host- prefix, host-only, absolute lifetime', () => {
    const value = sessionCookie(TOKEN, 28800);
    expect(value.startsWith(`__Host-11admin=${TOKEN};`)).toBe(true);
    expect(value).toContain('Max-Age=28800');
    for (const attribute of required) expect(value).toContain(attribute);
    expect(value).not.toMatch(/Domain/i);
  });

  it('preauth cookie lives five minutes with the same attributes', () => {
    const value = preauthCookie(TOKEN);
    expect(value.startsWith(`__Host-11admin-pre=${TOKEN};`)).toBe(true);
    expect(value).toContain('Max-Age=300');
    for (const attribute of required) expect(value).toContain(attribute);
    expect(value).not.toMatch(/Domain/i);
  });

  it('cleared cookies are expired with the same attributes and carry no value', () => {
    for (const name of [ADMIN_SESSION_COOKIE, ADMIN_PREAUTH_COOKIE] as const) {
      const value = clearedCookie(name);
      expect(value.startsWith(`${name}=;`)).toBe(true);
      expect(value).toContain('Max-Age=0');
      for (const attribute of required) expect(value).toContain(attribute);
      expect(value).not.toMatch(/Domain/i);
    }
  });

  it('never allows a session lifetime below one second', () => {
    expect(sessionCookie(TOKEN, 0.2)).toContain('Max-Age=1');
  });
});
