import { describe, expect, it } from '@jest/globals';
import { assertNoInput, parseResetTestBody } from './account-recovery-validation';

describe('parseResetTestBody', () => {
  it('accepts exactly phone and password and normalizes the phone', () => {
    const parsed = parseResetTestBody({ phone: '0912345678', password: 'Brand-New-Passw0rd-7' });
    expect(parsed.password).toBe('Brand-New-Passw0rd-7');
    expect(parsed.phoneNormalized).toMatch(/^\+?\d+$/);
  });

  it.each([
    [{ phone: '0912345678' }],
    [{ password: 'Brand-New-Passw0rd-7' }],
    [{ phone: '0912345678', password: 'Brand-New-Passw0rd-7', code: '123456' }],
    [{ phone: '0912345678', password: 'Brand-New-Passw0rd-7', verification_token: 'x' }],
    [{ phone: '0912345678', password: 'Brand-New-Passw0rd-7', role: 'SYSTEM' }],
    [{ phone: '0912345678', password: 'Brand-New-Passw0rd-7', password_confirmation: 'Brand-New-Passw0rd-7' }],
    [{ phone: '0912345678', password: 'short' }],
    [null],
    [[]],
    ['text'],
  ])('refuses %j', (body) => {
    expect(() => parseResetTestBody(body)).toThrow();
  });

  it('does not trim or alter the password', () => {
    expect(parseResetTestBody({ phone: '0912345678', password: ' Brand-New-Passw0rd-7 ' }).password).toBe(' Brand-New-Passw0rd-7 ');
  });
});

describe('assertNoInput', () => {
  it('accepts an empty query and an absent or empty body only', () => {
    expect(() => assertNoInput({}, undefined)).not.toThrow();
    expect(() => assertNoInput({}, {})).not.toThrow();
    expect(() => assertNoInput({ x: '1' }, undefined)).toThrow();
    expect(() => assertNoInput({}, { x: 1 })).toThrow();
  });
});
