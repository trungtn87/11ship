import { createHmac } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { OtpHmacKey } from '../config/auth-config';
import { computeOtpDigest, digestsEqual, generateOtp, isOtpShape } from './otp';
import { otpRequestLockKey } from './otp-lane-lock';
import { deriveLockKey } from '../shared/lock-key';
import { createHash } from 'node:crypto';

const KEY_BYTES = Buffer.alloc(32, 3);
const key = new OtpHmacKey(KEY_BYTES);
const ID = '123e4567-e89b-42d3-a456-426614174000';
const PHONE = '+84987654321';

describe('generateOtp', () => {
  it('returns six ASCII digits, zero padded', () => {
    expect(generateOtp(() => 0)).toBe('000000');
    expect(generateOtp(() => 7)).toBe('000007');
    expect(generateOtp(() => 123_456)).toBe('123456');
    expect(generateOtp(() => 999_999)).toBe('999999');
  });

  it('asks the generator for the half-open range [0, 10^6)', () => {
    const calls: Array<[number, number]> = [];
    generateOtp((min, max) => {
      calls.push([min, max]);
      return 5;
    });
    expect(calls).toEqual([[0, 1_000_000]]);
  });

  it('refuses an out-of-range or non-integer value from the source', () => {
    for (const value of [-1, 1_000_000, 1.5, Number.NaN]) {
      expect(() => generateOtp(() => value)).toThrow(RangeError);
    }
  });

  it('really uses the CSPRNG by default (six digits every time)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtp()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe('isOtpShape', () => {
  it('is exactly six ASCII digits', () => {
    expect(isOtpShape('123456')).toBe(true);
    expect(isOtpShape('000000')).toBe(true);
    for (const value of ['12345', '1234567', 'abcdef', '12345a', ' 12345', '123 56', '１２３４５６', 123456, null, undefined]) {
      expect(isOtpShape(value)).toBe(false);
    }
  });
});

describe('computeOtpDigest (task section 8)', () => {
  it('is HMAC-SHA-256 over the canonical JSON array with the domain separator', () => {
    const expected = createHmac('sha256', KEY_BYTES)
      .update(JSON.stringify(['11ship.auth.otp.v1', ID, PHONE, 'REGISTER', '123456']), 'utf8')
      .digest('hex');
    expect(computeOtpDigest(key, ID, PHONE, 'REGISTER', '123456')).toBe(expected);
  });

  it('binds the verification id, phone, purpose and otp', () => {
    const base = computeOtpDigest(key, ID, PHONE, 'REGISTER', '123456');
    expect(computeOtpDigest(key, ID.replace('1', '2'), PHONE, 'REGISTER', '123456')).not.toBe(base);
    expect(computeOtpDigest(key, ID, '+84987654322', 'REGISTER', '123456')).not.toBe(base);
    expect(computeOtpDigest(key, ID, PHONE, 'RESET', '123456')).not.toBe(base);
    expect(computeOtpDigest(key, ID, PHONE, 'REGISTER', '123457')).not.toBe(base);
    expect(computeOtpDigest(new OtpHmacKey(Buffer.alloc(32, 4)), ID, PHONE, 'REGISTER', '123456')).not.toBe(base);
  });

  it('does not collide when a field boundary moves (no delimiter-free concatenation)', () => {
    const a = computeOtpDigest(key, 'ab', 'c', 'REGISTER', '123456');
    const b = computeOtpDigest(key, 'a', 'bc', 'REGISTER', '123456');
    expect(a).not.toBe(b);
  });

  it('never contains the OTP and is 64 lowercase hex characters', () => {
    const digest = computeOtpDigest(key, ID, PHONE, 'REGISTER', '123456');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('123456');
  });
});

describe('digestsEqual', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);

  it('compares two valid digests', () => {
    expect(digestsEqual(a, a)).toBe(true);
    expect(digestsEqual(a, b)).toBe(false);
  });

  it('treats anything that is not a 64-char lowercase hex digest as not equal, without throwing', () => {
    for (const bad of ['', 'a', 'A'.repeat(64), 'g'.repeat(64), `${a}0`, a.slice(1)]) {
      expect(digestsEqual(a, bad)).toBe(false);
      expect(digestsEqual(bad, a)).toBe(false);
      expect(digestsEqual(bad, bad)).toBe(false);
    }
    expect(digestsEqual(undefined as unknown as string, a)).toBe(false);
  });
});

describe('otpRequestLockKey (task section 7)', () => {
  it('derives two signed int32 from SHA-256 of the canonical JSON array', () => {
    const digest = createHash('sha256')
      .update(Buffer.from(JSON.stringify(['11ship.auth.otp.request.v1', PHONE, 'REGISTER']), 'utf8'))
      .digest();
    expect(otpRequestLockKey(PHONE, 'REGISTER')).toEqual([digest.readInt32BE(0), digest.readInt32BE(4)]);
    expect(otpRequestLockKey(PHONE, 'REGISTER')).toEqual(deriveLockKey('11ship.auth.otp.request.v1', [PHONE, 'REGISTER']));
  });

  it('is stable per lane and differs between lanes', () => {
    expect(otpRequestLockKey(PHONE, 'REGISTER')).toEqual(otpRequestLockKey(PHONE, 'REGISTER'));
    expect(otpRequestLockKey(PHONE, 'REGISTER')).not.toEqual(otpRequestLockKey('+84987654322', 'REGISTER'));
    expect(otpRequestLockKey(PHONE, 'REGISTER')).not.toEqual(otpRequestLockKey(PHONE, 'OTHER'));
    for (const part of otpRequestLockKey(PHONE, 'REGISTER')) {
      expect(Number.isInteger(part)).toBe(true);
      expect(part).toBeGreaterThanOrEqual(-2_147_483_648);
      expect(part).toBeLessThanOrEqual(2_147_483_647);
    }
  });
});
