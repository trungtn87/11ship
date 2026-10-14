import { describe, expect, it } from '@jest/globals';
import { assertNoInput, parseResetOtpBody, parseResetOtpRequestBody, parseResetOtpVerifyBody, parseResetTestBody } from './account-recovery-validation';

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

describe('SMS OTP reset bodies (issue #102)', () => {
  const TOKEN = 'T'.repeat(43);

  it('step 1 takes exactly a phone and normalizes it', () => {
    expect(parseResetOtpRequestBody({ phone: '0912345678' })).toEqual({ phoneNormalized: '+84912345678' });
    for (const body of [{}, { phone: '0912345678', purpose: 'REGISTER' }, { phone: 'abc' }, null, []]) {
      expect(() => parseResetOtpRequestBody(body)).toThrow();
    }
  });

  it('step 2 takes exactly a six digit code', () => {
    expect(parseResetOtpVerifyBody({ otp: '012345' })).toEqual({ otp: '012345' });
    for (const body of [{ otp: '12345' }, { otp: '1234567' }, { otp: 123456 }, { otp: '123456', phone: '0912345678' }, {}]) {
      expect(() => parseResetOtpVerifyBody(body)).toThrow();
    }
  });

  it('step 3 takes exactly a proof token and a password, and never a phone, role or confirmation', () => {
    expect(parseResetOtpBody({ verification_token: TOKEN, password: 'Brand-New-Passw0rd-7' })).toEqual({ verificationToken: TOKEN, password: 'Brand-New-Passw0rd-7' });
    for (const body of [
      { verification_token: TOKEN },
      { password: 'Brand-New-Passw0rd-7' },
      { verification_token: TOKEN, password: 'short' },
      { verification_token: TOKEN, password: 'Brand-New-Passw0rd-7', phone: '0912345678' },
      { verification_token: TOKEN, password: 'Brand-New-Passw0rd-7', role: 'SYSTEM' },
      { verification_token: 5, password: 'Brand-New-Passw0rd-7' },
      { verification_token: 'x'.repeat(100), password: 'Brand-New-Passw0rd-7' },
    ]) {
      expect(() => parseResetOtpBody(body)).toThrow();
    }
  });
});
