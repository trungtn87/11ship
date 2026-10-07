// Auth Core configuration values and bounds (M01-A1 task section 6, ADR-002). Pure data and validation:
// nothing here reads the environment or talks to a database. It lives in the config folder (not in auth/)
// so that nothing that loads AppConfig depends on auth code.
//
// Argon2 parameters are NOT here on purpose: they are constants of ADR-002 (see auth/password-hasher.ts)
// and must not be downgradeable through an environment variable.
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';

export const DEFAULT_AUTH_OTP_TTL_SECONDS = 300;
export const MIN_AUTH_OTP_TTL_SECONDS = 30;
export const MAX_AUTH_OTP_TTL_SECONDS = 600;

export const DEFAULT_AUTH_OTP_RESEND_SECONDS = 60;
export const MIN_AUTH_OTP_RESEND_SECONDS = 1;
export const MAX_AUTH_OTP_RESEND_SECONDS = 300;

export const DEFAULT_AUTH_OTP_MAX_ATTEMPTS = 5;
export const MIN_AUTH_OTP_MAX_ATTEMPTS = 1;
export const MAX_AUTH_OTP_MAX_ATTEMPTS = 10;

export const DEFAULT_AUTH_PROOF_TTL_SECONDS = 600;
export const MIN_AUTH_PROOF_TTL_SECONDS = 60;
export const MAX_AUTH_PROOF_TTL_SECONDS = 1800;

export const DEFAULT_AUTH_SESSION_TTL_SECONDS = 604_800;
export const MIN_AUTH_SESSION_TTL_SECONDS = 300;
export const MAX_AUTH_SESSION_TTL_SECONDS = 2_592_000;

export const AUTH_OTP_HMAC_SECRET_BYTES = 32;

// 32 bytes -> 43 base64 characters + one "=" pad (the same canonical shape as a crypto master key).
const SECRET_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The key that turns an OTP into its stored digest. The raw key bytes are held in a private field and are
 * never exposed: the only operation is the keyed digest. It serializes and inspects as a redaction, so a
 * configuration object that is logged or stringified by mistake cannot print the secret.
 */
export class OtpHmacKey {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (!Buffer.isBuffer(key) || key.length !== AUTH_OTP_HMAC_SECRET_BYTES) {
      throw new RangeError('OTP HMAC key must be exactly 32 bytes');
    }
    // A private copy: later mutation of the caller's buffer cannot change the key.
    this.#key = Buffer.from(key);
    Object.freeze(this);
  }

  /** HMAC-SHA-256 of the UTF-8 message, as lowercase hex (64 characters). */
  hmacSha256Hex(message: string): string {
    return createHmac('sha256', this.#key).update(message, 'utf8').digest('hex');
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  toString(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return 'OtpHmacKey { [REDACTED] }';
  }
}

/**
 * Parses AUTH_OTP_HMAC_SECRET: canonical standard base64 of EXACTLY 32 bytes. Returns undefined for any
 * other input (wrong length, wrong alphabet, missing or non-canonical padding, non-canonical trailing bits).
 * The value is never echoed.
 */
export function parseOtpHmacSecret(raw: string): OtpHmacKey | undefined {
  if (typeof raw !== 'string' || !SECRET_BASE64.test(raw)) {
    return undefined;
  }
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== AUTH_OTP_HMAC_SECRET_BYTES || bytes.toString('base64') !== raw) {
    return undefined;
  }
  return new OtpHmacKey(bytes);
}

export interface AuthConfig {
  /** How long an OTP can be verified, counted from the database clock at issue. */
  readonly otpTtlSeconds: number;
  /** Cooldown between OTP requests of one (phone, purpose) lane. */
  readonly otpResendSeconds: number;
  /** Wrong attempts after which a verification is LOCKED. */
  readonly otpMaxAttempts: number;
  /** How long a verification proof can be consumed by register. */
  readonly proofTtlSeconds: number;
  /** Absolute session lifetime. There is no refresh and no sliding renewal. */
  readonly sessionTtlSeconds: number;
  readonly otpHmacKey: OtpHmacKey;
}
