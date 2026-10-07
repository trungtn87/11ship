import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import {
  isWellFormed,
  parseLoginBody,
  parseOtpRequestBody,
  parseOtpVerifyBody,
  parseRegisterBody,
  parseRoleSelectBody,
  parseVerificationId,
} from './auth-validation';

const DEVICE = { device_id: 'device-1', platform: 'ANDROID', app: 'SHIP11' };
const TOKEN = 'A'.repeat(43);

function register(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { phone: '0987654321', password: 'a-good-password', verification_token: TOKEN, device: { ...DEVICE }, ...overrides };
}

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

describe('parseRegisterBody (task section 14)', () => {
  it('accepts the exact contract and normalizes only the phone', () => {
    const parsed = parseRegisterBody(register({ phone: '+84987654321' }));
    expect(parsed).toEqual({
      phoneNormalized: '+84987654321',
      password: 'a-good-password',
      verificationToken: TOKEN,
      device: { deviceId: 'device-1', platform: 'ANDROID', app: 'SHIP11' },
    });
  });

  it('keeps the password exactly as sent: no trim, no normalization', () => {
    const decomposed = 'é-pass-word'; // e + combining acute, NOT normalized to é
    expect(parseRegisterBody(register({ password: '  padded pw  ' })).password).toBe('  padded pw  ');
    expect(parseRegisterBody(register({ password: decomposed })).password).toBe(decomposed);
    expect(parseRegisterBody(register({ password: decomposed })).password).not.toBe(decomposed.normalize('NFC'));
  });

  it('counts the password length in code points (8..128)', () => {
    expect(code(() => parseRegisterBody(register({ password: 'x'.repeat(7) })))).toBe('BAD_REQUEST');
    expect(code(() => parseRegisterBody(register({ password: 'x'.repeat(8) })))).toBe('ACCEPTED');
    expect(code(() => parseRegisterBody(register({ password: 'x'.repeat(128) })))).toBe('ACCEPTED');
    expect(code(() => parseRegisterBody(register({ password: 'x'.repeat(129) })))).toBe('BAD_REQUEST');
    // 8 emoji are 8 code points (16 UTF-16 units): accepted; 129 are not.
    expect(code(() => parseRegisterBody(register({ password: '😀'.repeat(8) })))).toBe('ACCEPTED');
    expect(code(() => parseRegisterBody(register({ password: '😀'.repeat(129) })))).toBe('BAD_REQUEST');
  });

  it('refuses a password that is not valid text (lone surrogate) and non-strings', () => {
    expect(code(() => parseRegisterBody(register({ password: `abcdefgh${String.fromCharCode(0xd800)}` })))).toBe('BAD_REQUEST');
    expect(code(() => parseRegisterBody(register({ password: `abcdefgh${String.fromCharCode(0xdc00)}` })))).toBe('BAD_REQUEST');
    for (const password of [12345678, null, undefined, ['abcdefgh'], {}]) {
      expect(code(() => parseRegisterBody(register({ password })))).toBe('BAD_REQUEST');
    }
  });

  it('rejects security-sensitive and unknown fields instead of ignoring them', () => {
    for (const extra of [
      { role: 'ADMIN' },
      { roles: ['SHOP'] },
      { driver_type: 'PLATFORM' },
      { is_admin: true },
      { admin: true },
      { permissions: ['*'] },
      { user_id: 'x' },
      { status: 'ACTIVE' },
      { anything: 1 },
    ]) {
      expect([Object.keys(extra)[0], code(() => parseRegisterBody(register(extra)))]).toEqual([Object.keys(extra)[0], 'BAD_REQUEST']);
    }
    expect(code(() => parseRegisterBody(register({ device: { ...DEVICE, role: 'ADMIN' } })))).toBe('BAD_REQUEST');
  });

  it('rejects a body that smuggles __proto__ or constructor keys', () => {
    const polluted = JSON.parse(`{"phone":"0987654321","password":"a-good-password","verification_token":"${TOKEN}","device":{"device_id":"d","platform":"ANDROID","app":"A"},"__proto__":{"role":"ADMIN"}}`);
    expect(code(() => parseRegisterBody(polluted))).toBe('BAD_REQUEST');
    expect(({} as Record<string, unknown>).role).toBeUndefined();
  });

  it('requires every field and validates the device labels like the database constraints do', () => {
    for (const key of ['phone', 'password', 'verification_token', 'device']) {
      const body = register();
      delete body[key];
      expect([key, code(() => parseRegisterBody(body))]).toEqual([key, key === 'phone' ? 'BAD_REQUEST' : 'BAD_REQUEST']);
    }
    const bad: unknown[] = [
      null,
      [],
      {},
      { platform: 'ANDROID', app: 'SHIP11' },
      { ...DEVICE, device_id: '' },
      { ...DEVICE, device_id: 'has space' },
      { ...DEVICE, device_id: 'x'.repeat(129) },
      { ...DEVICE, platform: 'android' },
      { ...DEVICE, platform: 'A'.repeat(33) },
      { ...DEVICE, app: 'with-dash' },
      { ...DEVICE, app: 5 },
    ];
    for (const device of bad) {
      expect(code(() => parseRegisterBody(register({ device })))).toBe('BAD_REQUEST');
    }
    expect(code(() => parseRegisterBody(register({ device: { device_id: 'x'.repeat(128), platform: 'A'.repeat(32), app: 'B'.repeat(32) } })))).toBe('ACCEPTED');
  });

  it('leaves the token shape to the service (a malformed token is VERIFICATION_PROOF_INVALID there) but bounds its size', () => {
    expect(parseRegisterBody(register({ verification_token: 'short' })).verificationToken).toBe('short');
    expect(code(() => parseRegisterBody(register({ verification_token: 'x'.repeat(257) })))).toBe('BAD_REQUEST');
    expect(code(() => parseRegisterBody(register({ verification_token: 5 })))).toBe('BAD_REQUEST');
  });

  it('reports INVALID_PHONE for a bad phone', () => {
    expect(code(() => parseRegisterBody(register({ phone: '0123' })))).toBe('INVALID_PHONE');
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

describe('parseRoleSelectBody', () => {
  it('passes any bounded string through: whether it is selectable is the service decision', () => {
    for (const role of ['SHOP', 'DRIVER', 'ADMIN', 'shop', 'SHOP ', 'x'.repeat(64)]) {
      expect(parseRoleSelectBody({ role })).toEqual({ role });
    }
  });

  it('refuses extra keys, non-strings and unbounded input', () => {
    for (const body of [{}, { role: '' }, { role: 1 }, { role: null }, { role: 'x'.repeat(65) }, { role: 'SHOP', x: 1 }, { roles: ['SHOP'] }, []]) {
      expect(code(() => parseRoleSelectBody(body))).toBe('BAD_REQUEST');
    }
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
