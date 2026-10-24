import { describe, expect, it } from '@jest/globals';
import { AppError } from '../common/app-errors';
import { OTP_POLICY_BOUNDS, OTP_POLICY_KEYS } from '../auth/otp-policy-repository';
import { parseOtpPolicyBody } from './otp-policy-validation';

const VALID = { expected_version: 1, cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 };

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as AppError).code;
  }
  return 'OK';
}

describe('parseOtpPolicyBody (issue #117)', () => {
  it('accepts exactly the version, the six limits and an optional reason', () => {
    expect(parseOtpPolicyBody(VALID)).toEqual({
      expectedVersion: 1,
      values: { cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 },
      reason: null,
    });
    expect(parseOtpPolicyBody({ ...VALID, reason: 'Thử nghiệm' }).reason).toBe('Thử nghiệm');
  });

  it('the defaults are the approved ones (60 s, 3 wrong, 3/h, 5/day, 10 per IP/h, 30 per Gateway/day)', () => {
    expect(OTP_POLICY_KEYS.map((key) => OTP_POLICY_BOUNDS[key].default)).toEqual([60, 3, 3, 5, 10, 30]);
  });

  it.each(OTP_POLICY_KEYS)('refuses %s below its minimum (never 0), above its maximum, decimal or as a string', (key) => {
    const { min, max } = OTP_POLICY_BOUNDS[key];
    const base = { ...VALID };
    for (const value of [0, -1, min - 1, max + 1, min + 0.5, String(min), null, Number.NaN]) {
      expect(code(() => parseOtpPolicyBody({ ...base, [key]: value }))).toBe('ADMIN_INPUT_INVALID');
    }
    expect(code(() => parseOtpPolicyBody({ ...base, [key]: min, phone_per_day: 100 }))).toBe('OK');
    expect(code(() => parseOtpPolicyBody({ ...base, [key]: max }))).toBe(key === 'phone_per_hour' ? 'ADMIN_INPUT_INVALID' : 'OK');
  });

  it('refuses a phone hourly limit above its daily limit, a missing field, an extra key and a bad version or body', () => {
    expect(code(() => parseOtpPolicyBody({ ...VALID, phone_per_hour: 6, phone_per_day: 5 }))).toBe('ADMIN_INPUT_INVALID');
    const missing: Record<string, unknown> = { ...VALID };
    delete missing.cooldown_seconds;
    for (const body of [missing, { ...VALID, enabled: false }, { ...VALID, expected_version: -1 }, { ...VALID, expected_version: '1' }, null, [], 'x', { ...VALID, reason: 5 }]) {
      expect(code(() => parseOtpPolicyBody(body))).toBe('ADMIN_INPUT_INVALID');
    }
  });
});
