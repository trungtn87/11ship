import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import {
  assertLegacyDeviceAllowed,
  isWellFormed,
  parseLoginBody,
  parseOtpRequestBody,
  parseOtpVerifyBody,
  parseVerificationId,
} from './auth-validation';

const DEVICE = { device_id: 'device-1', platform: 'ANDROID', app: 'SHIP11' };

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error.code;
    }
    if (error instanceof BadRequestException) {
      return 'BAD_REQUEST';
    }
    throw error;
  }
  return 'ACCEPTED';
}

describe('parseOtpRequestBody', () => {
  it('normalizes the phone and fixes the purpose to REGISTER', () => {
    expect(parseOtpRequestBody({ phone: '0987654321', purpose: 'REGISTER' })).toEqual({
      phoneNormalized: '+84987654321',
      purpose: 'REGISTER',
    });
  });

  it('refuses unknown keys, other purposes and non-objects', () => {
    expect(code(() => parseOtpRequestBody({ phone: '0987654321', purpose: 'REGISTER', role: 'ADMIN' }))).toBe('BAD_REQUEST');
    expect(code(() => parseOtpRequestBody({ phone: '0987654321', purpose: 'LOGIN' }))).toBe('BAD_REQUEST');
    expect(code(() => parseOtpRequestBody({ phone: '0987654321' }))).toBe('BAD_REQUEST');
    for (const body of [null, undefined, [], 'x', 1]) {
      expect(code(() => parseOtpRequestBody(body))).toBe('BAD_REQUEST');
    }
  });

  it('reports a malformed phone as INVALID_PHONE', () => {
    expect(code(() => parseOtpRequestBody({ phone: '123', purpose: 'REGISTER' }))).toBe('INVALID_PHONE');
    expect(code(() => parseOtpRequestBody({ phone: 5, purpose: 'REGISTER' }))).toBe('INVALID_PHONE');
  });
});

describe('parseOtpVerifyBody / parseVerificationId', () => {
  it('accepts exactly {otp: six digits}', () => {
    expect(parseOtpVerifyBody({ otp: '123456' })).toEqual({ otp: '123456' });
    for (const body of [{ otp: '12345' }, { otp: 123456 }, { otp: '123456', x: 1 }, {}, { otp: null }]) {
      expect(code(() => parseOtpVerifyBody(body))).toBe('BAD_REQUEST');
    }
  });

  it('a verification id must be a canonical UUID, otherwise OTP_INVALID', () => {
    expect(parseVerificationId('123e4567-e89b-42d3-a456-426614174000')).toBe('123e4567-e89b-42d3-a456-426614174000');
    for (const value of ['', 'abc', '123E4567-E89B-42D3-A456-426614174000', '123e4567e89b42d3a456426614174000', undefined, 1]) {
      expect(code(() => parseVerificationId(value))).toBe('OTP_INVALID');
    }
  });
});

describe('parseLoginBody', () => {
  it('accepts the contract and does not apply the registration length policy', () => {
    expect(parseLoginBody({ phone: '84987654321', password: 'x', device: { ...DEVICE } })).toEqual({
      phoneNormalized: '+84987654321',
      password: 'x',
      device: { deviceId: 'device-1', platform: 'ANDROID', app: 'SHIP11' },
    });
  });

  it('is strict about keys, types and encoding', () => {
    const base = { phone: '0987654321', password: 'secret-pass', device: { ...DEVICE } };
    expect(code(() => parseLoginBody({ ...base, role: 'ADMIN' }))).toBe('BAD_REQUEST');
    expect(code(() => parseLoginBody({ ...base, password: 1 }))).toBe('BAD_REQUEST');
    expect(code(() => parseLoginBody({ ...base, password: `x${String.fromCharCode(0xd800)}` }))).toBe('BAD_REQUEST');
    expect(code(() => parseLoginBody({ ...base, password: 'x'.repeat(1025) }))).toBe('BAD_REQUEST');
    expect(code(() => parseLoginBody({ phone: '0987654321', password: 'x' }))).toBe('BAD_REQUEST');
    expect(code(() => parseLoginBody({ ...base, phone: 'nope' }))).toBe('INVALID_PHONE');
  });
});

describe('isWellFormed', () => {
  it('detects lone surrogates only', () => {
    expect(isWellFormed('plain')).toBe(true);
    expect(isWellFormed('😀')).toBe(true);
    expect(isWellFormed('\ud83d')).toBe(false);
    expect(isWellFormed('\ude00')).toBe(false);
    expect(isWellFormed('a\ud83db')).toBe(false);
  });
});

describe('assertLegacyDeviceAllowed', () => {
  const device = (platform: string, app: string) => ({ deviceId: 'device-1', platform, app });

  it('with the native gate on refuses EVERY label: the decision is the server\'s, not the client\'s', () => {
    for (const [platform, app] of [['ANDROID', 'OTHER'], ['IOS', 'FOOD'], ['WEB', 'SHIP'], ['ANDROID', 'FOOD']]) {
      expect(() => assertLegacyDeviceAllowed(device(platform, app), true)).toThrow(AppError);
    }
  });

  it('with the gate off keeps the web local compatibility and still refuses the native labels', () => {
    expect(() => assertLegacyDeviceAllowed(device('WEB', 'FOOD'))).not.toThrow();
    expect(() => assertLegacyDeviceAllowed(device('ANDROID', 'SHIP'))).toThrow(AppError);
  });
});
