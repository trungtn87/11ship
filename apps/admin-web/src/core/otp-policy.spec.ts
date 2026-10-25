import { describe, expect, it } from '@jest/globals';
import { ApiResult, Transport } from './api.js';
import { OTP_POLICY_FIELDS, OtpPolicyApi, OtpPolicyBounds, parseOtpPolicy, refusalOf, validateOtpPolicy } from './otp-policy.js';

const VALUES = { cooldown_seconds: 60, max_wrong_attempts: 3, phone_per_hour: 3, phone_per_day: 5, ip_per_hour: 10, global_per_day: 30 };
const BOUNDS: OtpPolicyBounds = {
  cooldown_seconds: { min: 10, max: 600 },
  max_wrong_attempts: { min: 1, max: 10 },
  phone_per_hour: { min: 1, max: 20 },
  phone_per_day: { min: 1, max: 100 },
  ip_per_hour: { min: 1, max: 1000 },
  global_per_day: { min: 1, max: 10000 },
};
const ANSWER = { version: 2, ...VALUES, defaults: VALUES, bounds: BOUNDS, editable: true, updated_at: '2026-10-24T10:00:00.000Z', updated_by: null, history: [] };

describe('SMS & OTP policy model (issue #117)', () => {
  it('lists the six approved limits, each with its unit', () => {
    expect(OTP_POLICY_FIELDS.map((field) => [field.key, field.unit])).toEqual([
      ['cooldown_seconds', 'giây'], ['max_wrong_attempts', 'lần'], ['phone_per_hour', 'lần'], ['phone_per_day', 'lần'], ['ip_per_hour', 'lần'], ['global_per_day', 'SMS'],
    ]);
  });

  it('parses the server answer strictly and refuses anything malformed', () => {
    expect(parseOtpPolicy(ANSWER)?.values).toEqual(VALUES);
    expect(parseOtpPolicy({ ...ANSWER, history: [{ version: 2, old_values: VALUES, new_values: { ...VALUES, ip_per_hour: 11 }, reason: null, changed_by: 'u', changed_at: '2026-10-24T10:00:00.000Z' }] })?.history).toHaveLength(1);
    for (const broken of [
      { ...ANSWER, cooldown_seconds: '60' },
      { ...ANSWER, cooldown_seconds: 1.5 },
      { ...ANSWER, version: 0 },
      { ...ANSWER, editable: 'yes' },
      { ...ANSWER, bounds: { ...BOUNDS, ip_per_hour: { min: 'a', max: 1 } } },
      { ...ANSWER, updated_at: 'never' },
      { ...ANSWER, history: [{ version: 1 }] },
      { ...ANSWER, defaults: undefined },
    ]) {
      expect(parseOtpPolicy(broken as Record<string, unknown>)).toBeUndefined();
    }
  });

  it('validates every value against the server bounds, never accepting 0, decimals or text, and the hourly limit against the daily one', () => {
    expect(validateOtpPolicy(VALUES, BOUNDS)).toBeUndefined();
    for (const key of Object.keys(VALUES) as Array<keyof typeof VALUES>) {
      for (const bad of [0, -1, BOUNDS[key].max + 1, 1.5, '3', null, Number.NaN]) {
        expect(validateOtpPolicy({ ...VALUES, [key]: bad }, BOUNDS)).toContain('nhập số nguyên');
      }
    }
    expect(validateOtpPolicy({ ...VALUES, phone_per_hour: 6, phone_per_day: 5 }, BOUNDS)).toContain('24 giờ');
  });

  it('maps a failed save to a meaning by the code, never by text', () => {
    const error = (status: number, code: string): Exclude<ApiResult<unknown>, { kind: 'ok' }> => ({ kind: 'error', status, code });
    expect(refusalOf(error(403, 'ADMIN_FORBIDDEN'))).toBe('forbidden');
    expect(refusalOf(error(403, 'ADMIN_CSRF_INVALID'))).toBe('session');
    expect(refusalOf(error(401, 'ADMIN_SESSION_INVALID'))).toBe('session');
    expect(refusalOf(error(409, 'OTP_POLICY_VERSION_CONFLICT'))).toBe('conflict');
    expect(refusalOf(error(400, 'ADMIN_INPUT_INVALID'))).toBe('invalid');
    expect(refusalOf(error(503, 'SERVICE_UNAVAILABLE'))).toBe('unknown');
    expect(refusalOf({ kind: 'network' })).toBe('unknown');
  });

  it('the client sends the version, the six values, the reason only when given, the CSRF token and the Idempotency-Key of the intent', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const transport: Transport = (request) => {
      seen.push({ ...request });
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ data: ANSWER }), header: () => null });
    };
    const api = new OtpPolicyApi(transport);
    const result = await api.save('csrf-1', { expectedVersion: 2, values: VALUES, reason: '  ' }, 'key-1');
    expect(result.kind).toBe('ok');
    expect(seen[0]).toMatchObject({ method: 'POST', path: '/admin/system-settings/otp-policy', csrf: 'csrf-1', idempotencyKey: 'key-1', body: { expected_version: 2, ...VALUES } });
    expect('reason' in (seen[0]?.body as object)).toBe(false);
    await api.save('csrf-1', { expectedVersion: 2, values: VALUES, reason: ' Thử nghiệm ' }, 'key-2');
    expect((seen[1]?.body as { reason: string }).reason).toBe('Thử nghiệm');
    await api.read();
    expect(seen[2]).toMatchObject({ method: 'GET', path: '/admin/system-settings/otp-policy' });
  });
});
