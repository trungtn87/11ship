import { describe, expect, it } from '@jest/globals';
import { readCookieToken } from '../admin-auth/admin-cookies';
import { ADMIN_PREAUTH_COOKIE, ADMIN_SESSION_COOKIE } from '../admin-auth/admin-auth-constants';
import { ACTIVATION_COOKIE } from './admin-activation-constants';
import { activationCookie, clearedActivationCookie } from './admin-activation-cookies';

const TOKEN = 'A'.repeat(43);

describe('activation-session cookie', () => {
  it('is __Host-11admin-act and distinct from the login cookies', () => {
    expect(ACTIVATION_COOKIE).toBe('__Host-11admin-act');
    expect(new Set([ACTIVATION_COOKIE, ADMIN_SESSION_COOKIE, ADMIN_PREAUTH_COOKIE]).size).toBe(3);
    expect(readCookieToken(`${ADMIN_SESSION_COOKIE}=${TOKEN}`, ACTIVATION_COOKIE)).toBeUndefined();
    expect(readCookieToken(`${ADMIN_PREAUTH_COOKIE}=${TOKEN}`, ACTIVATION_COOKIE)).toBeUndefined();
    expect(readCookieToken(`${ACTIVATION_COOKIE}=${TOKEN}`, ADMIN_SESSION_COOKIE)).toBeUndefined();
    expect(readCookieToken(`${ACTIVATION_COOKIE}=${TOKEN}`, ACTIVATION_COOKIE)).toBe(TOKEN);
  });

  it('carries HttpOnly, Secure, SameSite=Strict, Path=/ and no Domain', () => {
    const value = activationCookie(TOKEN, 1800);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=1800']) {
      expect(value).toContain(attribute);
    }
    expect(value.startsWith(`${ACTIVATION_COOKIE}=${TOKEN};`)).toBe(true);
    expect(value).not.toMatch(/Domain=/i);
  });

  it('never has a lifetime below one second', () => {
    expect(activationCookie(TOKEN, 0)).toContain('Max-Age=1');
    expect(activationCookie(TOKEN, 0.4)).toContain('Max-Age=1');
  });

  it('is removed with the same attributes and Max-Age=0', () => {
    const cleared = clearedActivationCookie();
    expect(cleared).toContain('Max-Age=0');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) {
      expect(cleared).toContain(attribute);
    }
    expect(cleared.startsWith(`${ACTIVATION_COOKIE}=;`)).toBe(true);
  });
});
