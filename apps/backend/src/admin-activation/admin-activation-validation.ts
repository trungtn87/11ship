import { AppError } from '../common/app-errors';
import { parseCanonicalToken } from '../auth/tokens';
import { parsePassword } from '../auth/auth-validation';
import { isTotpCodeShape } from '../admin-auth/totp';
import { isOtpShape } from '../auth/otp';
import { MAX_BODY_BYTES } from './admin-activation-constants';

// Strict parsers of the activation bodies. Every failure is the same 400 ADMIN_INPUT_INVALID: it never says which field
// failed and never echoes the value (contract section 6.1).

function invalidInput(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function exactObject(body: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidInput();
  }
  const present = Object.keys(body);
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    return invalidInput();
  }
  return body as Record<string, unknown>;
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;.*)?$/i;

export function isJsonContentType(header: unknown): boolean {
  return typeof header === 'string' && JSON_CONTENT_TYPE.test(header);
}

/** The declared body size (the framework's body parser already enforces the real limit). Absent length is allowed. */
export function declaredBodyTooLarge(contentLength: unknown): boolean {
  if (typeof contentLength !== 'string') {
    return false;
  }
  const value = Number(contentLength);
  return !Number.isSafeInteger(value) || value < 0 || value > MAX_BODY_BYTES;
}

/** A body without a declared length (chunked) is measured after parsing, so the 4 KiB cap cannot be bypassed. */
export function serializedBodyTooLarge(body: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8') > MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

/** `{}`: restart, OTP request and enrollment carry nothing. */
export function parseEmptyBody(body: unknown): void {
  exactObject(body, []);
}

/** `{ "token": "<43-char canonical base64url>" }`. */
export function parseStartBody(body: unknown): string {
  const parsed = exactObject(body, ['token']);
  return parseCanonicalToken(parsed.token) ?? invalidInput();
}

/** `{ "code": "123456" }` for the SMS OTP. */
export function parseOtpCodeBody(body: unknown): string {
  const parsed = exactObject(body, ['code']);
  return isOtpShape(parsed.code) ? parsed.code : invalidInput();
}

/** `{ "code": "123456" }` for the authenticator code. */
export function parseTotpCodeBody(body: unknown): string {
  const parsed = exactObject(body, ['code']);
  return isTotpCodeShape(parsed.code) ? parsed.code : invalidInput();
}

/** `{ "password": "..." }` with the existing registration password policy (no new number). */
export function parsePasswordBody(body: unknown): string {
  const parsed = exactObject(body, ['password']);
  try {
    return parsePassword(parsed.password);
  } catch {
    return invalidInput();
  }
}
