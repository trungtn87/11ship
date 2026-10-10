import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from './admin-auth-constants';

// TOTP (RFC 6238) over HOTP (RFC 4226), SHA-1, node:crypto only. A "step" is floor(unix seconds / 30).

const CODE_PATTERN = /^[0-9]{6}$/;

export function isTotpCodeShape(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value);
}

/** HOTP value for a counter, zero-padded to 6 digits (leading zeros are significant). */
export function hotp(secret: Buffer, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError('counter out of range');
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[19] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function stepAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / TOTP_PERIOD_SECONDS);
}

function codesEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a, 'ascii'), Buffer.from(b, 'ascii'));
}

/**
 * The accepted step for a submitted code, or undefined. Only the current and the previous step are tried (both are
 * always computed and compared in constant time), and a step is accepted only if it is greater than the last accepted
 * step of the factor, so a code can never be used twice and the accepted step only moves forward.
 */
export function matchTotp(
  secret: Buffer,
  code: string,
  nowUnixSeconds: number,
  lastAcceptedStep: number | null,
): number | undefined {
  if (!isTotpCodeShape(code)) {
    return undefined;
  }
  const current = stepAt(nowUnixSeconds);
  let accepted: number | undefined;
  for (const step of [current, current - 1]) {
    if (step < 0) {
      continue;
    }
    const equal = codesEqual(hotp(secret, step), code);
    if (equal && (lastAcceptedStep === null || step > lastAcceptedStep) && accepted === undefined) {
      accepted = step;
    }
  }
  return accepted;
}

export function buildOtpauthUri(input: { issuer: string; label: string; secretBase32: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.label)}`;
  const query = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
