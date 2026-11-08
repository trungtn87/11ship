import { describe, expect, it } from '@jest/globals';
import { originAllowed } from './account-deletion.controller';
import { parseAccountDeletionBody } from './account-deletion-validation';

describe('parseAccountDeletionBody', () => {
  it('accepts exactly {phone, password} and normalizes the phone only', () => {
    const parsed = parseAccountDeletionBody({ phone: '0912345678', password: '  keep spaces  ' });
    expect(parsed.password).toBe('  keep spaces  ');
    expect(parsed.phoneNormalized.length).toBeGreaterThanOrEqual(9);
  });

  it.each([
    [{ phone: '0912345678' }],
    [{ password: 'x' }],
    [{ phone: '0912345678', password: 'x', otp: '123456' }],
    [{ phone: '0912345678', password: 'x', role: 'ADMIN' }],
    [{ phone: '0912345678', password: '' }],
    [{ phone: '0912345678', password: 1234 }],
    [{ phone: '0912345678', password: 'x'.repeat(1025) }],
    [null],
    [[]],
    ['text'],
  ])('refuses %j without echoing it', (body) => {
    expect(() => parseAccountDeletionBody(body)).toThrow();
  });

  it('refuses a malformed phone as INVALID_PHONE', () => {
    expect(() => parseAccountDeletionBody({ phone: 'abc', password: 'x' })).toThrow(expect.objectContaining({ code: 'INVALID_PHONE' }) as unknown as Error);
  });
});

describe('originAllowed', () => {
  it('passes everything when no public origin is configured', () => {
    expect(originAllowed('https://anything.test', undefined)).toBe(true);
    expect(originAllowed(undefined, undefined)).toBe(true);
  });

  it('with a configured origin: a request without Origin (the app) passes, the same origin passes, any other fails', () => {
    expect(originAllowed(undefined, 'https://a.test')).toBe(true);
    expect(originAllowed('https://a.test', 'https://a.test')).toBe(true);
    expect(originAllowed('https://b.test', 'https://a.test')).toBe(false);
    expect(originAllowed('null', 'https://a.test')).toBe(false);
    expect(originAllowed(['https://a.test'], 'https://a.test')).toBe(false);
  });
});
