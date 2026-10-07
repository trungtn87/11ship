import { randomInt, timingSafeEqual } from 'node:crypto';
import { OtpHmacKey } from '../config/auth-config';
import { canonicalJson } from '../shared/json/safe-json';
import { OTP_DIGEST_DOMAIN, OTP_LENGTH } from './auth-constants';

// OTP generation and digest (M01-A1 task sections 12 and 13). The OTP is six ASCII digits drawn with
// crypto.randomInt (CSPRNG, unbiased), never Math.random. The database stores only an HMAC-SHA-256 digest
// under a key that is not in the database, because a bare hash of a six-digit space would be brute-forced
// in an instant if the table leaked.

export type RandomIntFn = (min: number, max: number) => number;

const OTP_SPACE = 10 ** OTP_LENGTH;
const OTP_SHAPE = new RegExp(`^[0-9]{${OTP_LENGTH}}$`);

export function generateOtp(random: RandomIntFn = randomInt): string {
  const value = random(0, OTP_SPACE);
  if (!Number.isInteger(value) || value < 0 || value >= OTP_SPACE) {
    throw new RangeError('random source returned an unexpected value');
  }
  return String(value).padStart(OTP_LENGTH, '0');
}

/** True for exactly six ASCII digits. */
export function isOtpShape(value: unknown): value is string {
  return typeof value === 'string' && OTP_SHAPE.test(value);
}

/**
 * HMAC-SHA-256 (lowercase hex) over the UTF-8 canonical JSON array
 *   ["11ship.auth.otp.v1", verification_id, phone_normalized, purpose, otp]
 * Binding the verification id, the phone and the purpose into the input means a digest cannot be moved to
 * another verification, number or purpose. An array of separate strings (never a delimiter-free
 * concatenation) keeps different field splits from producing the same input.
 */
export function computeOtpDigest(
  key: OtpHmacKey,
  verificationId: string,
  phoneNormalized: string,
  purpose: string,
  otp: string,
): string {
  return key.hmacSha256Hex(
    canonicalJson([OTP_DIGEST_DOMAIN, verificationId, phoneNormalized, purpose, otp]),
  );
}

const HEX_DIGEST = /^[0-9a-f]{64}$/;

/** Constant-time comparison of two 64-character lowercase hex digests. Anything else is simply "not equal". */
export function digestsEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX_DIGEST.test(a) || !HEX_DIGEST.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
