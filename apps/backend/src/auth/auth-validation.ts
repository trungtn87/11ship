import { BadRequestException } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, REGISTER_PURPOSE } from './auth-constants';
import { isOtpShape } from './otp';
import { requireNormalizedPhone } from './phone';

// Strict request-body parsers for Auth Core (task sections 4, 14 and 16). They are pure: no I/O, no Nest
// pipeline magic. A body is accepted only when it is a plain JSON object whose keys are EXACTLY the allowed
// ones, so a security-sensitive extra field (role, roles, driver_type, is_admin, permissions, ...) is refused
// instead of being ignored. Nothing is repaired: no trimming (except the outer whitespace of a phone number,
// which the phone contract defines), no case folding, no Unicode normalization.
//
// Failures never echo the offending value or key: a malformed shape is a plain 400 BAD_REQUEST, a bad phone
// is INVALID_PHONE.

const DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DEVICE_TOKEN = /^[A-Z0-9_]{1,32}$/;
const ROLE_MAX_LENGTH = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// A lone surrogate cannot be encoded as UTF-8 (it would silently become U+FFFD and let two different
// passwords hash alike), so it is refused rather than altered. (String.prototype.isWellFormed needs ES2024.)
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function isWellFormed(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

function reject(): never {
  throw new BadRequestException();
}

export function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return reject();
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) {
    return reject();
  }
  return value as Record<string, unknown>;
}

export interface DeviceInfo {
  readonly deviceId: string;
  readonly platform: string;
  readonly app: string;
}

/** The device object exactly as the legacy routes parse it; the client API (M01.03) narrows platform and app on top. */
export function parseDevice(value: unknown): DeviceInfo {
  const device = exactObject(value, ['device_id', 'platform', 'app']);
  const { device_id: deviceId, platform, app } = device;
  if (
    typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId) ||
    typeof platform !== 'string' || !DEVICE_TOKEN.test(platform) ||
    typeof app !== 'string' || !DEVICE_TOKEN.test(app)
  ) {
    return reject();
  }
  return { deviceId, platform, app };
}

/**
 * The legacy /auth routes must never become a way around the native device binding (contract11 section 6).
 *
 * The decision is made by the SERVER, never by the label the client sends: while the native gate is on (nativeGateEnabled, decided from the
 * validated startup configuration) the legacy routes issue no session at all, whatever platform or app the body claims, because every
 * customer session must then come from /v1/client-auth with a device proof. The static label check below stays as a second
 * guard for the gate-off case only; it is not what protects a gate-on process.
 */
export function assertLegacyDeviceAllowed(device: DeviceInfo, nativeGateEnabled = false): void {
  if (nativeGateEnabled || (device.platform === 'ANDROID' && (device.app === 'FOOD' || device.app === 'SHIP'))) {
    throw new AppError('DEVICE_PROOF_REQUIRED');
  }
}

/** The password exactly as sent. Length is counted in code points; a lone surrogate (not valid UTF-8) is refused. */
export function parsePassword(value: unknown): string {
  if (typeof value !== 'string' || !isWellFormed(value)) {
    return reject();
  }
  const length = [...value].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return reject();
  }
  return value;
}

export interface OtpRequestInput {
  readonly phoneNormalized: string;
  readonly purpose: string;
}

export function parseOtpRequestBody(body: unknown): OtpRequestInput {
  const parsed = exactObject(body, ['phone', 'purpose']);
  if (parsed.purpose !== REGISTER_PURPOSE) {
    return reject();
  }
  return { phoneNormalized: requireNormalizedPhone(parsed.phone), purpose: REGISTER_PURPOSE };
}

export interface OtpVerifyInput {
  readonly otp: string;
}

export function parseOtpVerifyBody(body: unknown): OtpVerifyInput {
  const parsed = exactObject(body, ['otp']);
  if (!isOtpShape(parsed.otp)) {
    return reject();
  }
  return { otp: parsed.otp };
}

/** A verification id from the URL. Anything that is not a canonical UUID cannot name a verification. */
export function parseVerificationId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AppError('OTP_INVALID');
  }
  return value;
}

export interface RegisterInput {
  readonly phoneNormalized: string;
  readonly password: string;
  /** Raw proof token as sent; its shape is checked by the service (malformed -> VERIFICATION_PROOF_INVALID). */
  readonly verificationToken: string;
  readonly device: DeviceInfo;
}

export function parseRegisterBody(body: unknown): RegisterInput {
  const parsed = exactObject(body, ['phone', 'password', 'verification_token', 'device']);
  if (typeof parsed.verification_token !== 'string' || parsed.verification_token.length > 256) {
    return reject();
  }
  return {
    phoneNormalized: requireNormalizedPhone(parsed.phone),
    password: parsePassword(parsed.password),
    verificationToken: parsed.verification_token,
    device: parseDevice(parsed.device),
  };
}

export interface LoginInput {
  readonly phoneNormalized: string;
  readonly password: string;
  readonly device: DeviceInfo;
}

export function parseLoginBody(body: unknown): LoginInput {
  const parsed = exactObject(body, ['phone', 'password', 'device']);
  // Login does not apply the registration length policy: a wrong-length password is simply a wrong password,
  // and the response must not reveal the policy. Only the type and the encoding are checked.
  if (typeof parsed.password !== 'string' || !isWellFormed(parsed.password) || parsed.password.length > 1024) {
    return reject();
  }
  return {
    phoneNormalized: requireNormalizedPhone(parsed.phone),
    password: parsed.password,
    device: parseDevice(parsed.device),
  };
}

export interface RoleSelectInput {
  /** Any bounded string; whether it is selectable is decided by the service (ROLE_NOT_AVAILABLE). */
  readonly role: string;
}

export function parseRoleSelectBody(body: unknown): RoleSelectInput {
  const parsed = exactObject(body, ['role']);
  if (typeof parsed.role !== 'string' || parsed.role.length < 1 || parsed.role.length > ROLE_MAX_LENGTH) {
    return reject();
  }
  return { role: parsed.role };
}
