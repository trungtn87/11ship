import { AppError } from '../common/app-errors';
import { parseReason } from '../admin-access/admin-access-validation';

// Strict parser of POST /v1/admin/system-settings/phone-verification. Exactly the two switches plus the version the screen was
// loaded with. Anything else (an extra key, a string "true", a missing switch) is ADMIN_INPUT_INVALID.

export interface PhoneVerificationBody {
  readonly expectedVersion: number;
  readonly otpRegistrationEnabled: boolean;
  readonly otpPasswordResetEnabled: boolean;
  /** M12-D: why the setting changes, written to the audit row. Optional so the older screen keeps working. */
  readonly reason: string | null;
}

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

export function parsePhoneVerificationBody(body: unknown): PhoneVerificationBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  const source = body as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.filter((key) => key !== 'reason').join(',') !== 'expected_version,otp_password_reset_enabled,otp_registration_enabled') {
    invalid();
  }
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    invalid();
  }
  if (typeof source.otp_registration_enabled !== 'boolean' || typeof source.otp_password_reset_enabled !== 'boolean') {
    invalid();
  }
  return {
    expectedVersion: version,
    otpRegistrationEnabled: source.otp_registration_enabled,
    otpPasswordResetEnabled: source.otp_password_reset_enabled,
    reason: Object.hasOwn(source, 'reason') ? parseReason(source.reason) : null,
  };
}
