import { parseReason } from '../admin-access/admin-access-validation';
import { AppError } from '../common/app-errors';
import { OTP_POLICY_BOUNDS, OTP_POLICY_KEYS, OtpPolicyValues } from '../auth/otp-policy-repository';

export interface OtpPolicyBody {
  readonly expectedVersion: number;
  readonly values: OtpPolicyValues;
  /** Why the limits change, written to the audit row and the history. */
  readonly reason: string | null;
}

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

/**
 * POST /v1/admin/system-settings/otp-policy: exactly the version the screen was loaded with, the six limits and an optional reason.
 * Every limit is a whole number inside its documented bounds (none can be 0: the limiters cannot be switched off), and the hourly
 * request limit of a phone cannot exceed its daily one. A decimal, a string, a missing field or an extra key is ADMIN_INPUT_INVALID
 * before anything is read or written; the database repeats the bounds as CHECKs.
 */
export function parseOtpPolicyBody(body: unknown): OtpPolicyBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return invalid();
  }
  const source = body as Record<string, unknown>;
  const allowed = new Set<string>(['expected_version', 'reason', ...OTP_POLICY_KEYS]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    return invalid();
  }
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return invalid();
  }
  const values: Record<string, number> = {};
  for (const key of OTP_POLICY_KEYS) {
    const value = source[key];
    const bounds = OTP_POLICY_BOUNDS[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) {
      return invalid();
    }
    values[key] = value;
  }
  if ((values.phone_per_hour as number) > (values.phone_per_day as number)) {
    return invalid();
  }
  return { expectedVersion: version, values: values as unknown as OtpPolicyValues, reason: Object.hasOwn(source, 'reason') ? parseReason(source.reason) : null };
}
