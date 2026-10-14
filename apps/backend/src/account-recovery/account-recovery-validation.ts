import { BadRequestException } from '@nestjs/common';
import { exactObject, parseOtpVerifyBody, parsePassword } from '../auth/auth-validation';
import { requireNormalizedPhone } from '../auth/phone';

export interface ResetTestInput {
  readonly phoneNormalized: string;
  readonly password: string;
}

/**
 * Exactly {phone, password}: no code, proof, token, role or confirmation (the confirmation is checked by the client only).
 * Failures never echo the offending value.
 */
export function parseResetTestBody(body: unknown): ResetTestInput {
  const parsed = exactObject(body, ['phone', 'password']);
  return { phoneNormalized: requireNormalizedPhone(parsed.phone), password: parsePassword(parsed.password) };
}

/** GET /config takes no query and no body. */
export function assertNoInput(query: unknown, body: unknown): void {
  const empty = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
  if (!empty(query) || !(body === undefined || empty(body))) {
    throw new BadRequestException();
  }
}

export interface ResetOtpRequestInput {
  readonly phoneNormalized: string;
}

/** Step 1 of the OTP reset: exactly {phone}. */
export function parseResetOtpRequestBody(body: unknown): ResetOtpRequestInput {
  const parsed = exactObject(body, ['phone']);
  return { phoneNormalized: requireNormalizedPhone(parsed.phone) };
}

/** Step 2: exactly {otp}, six digits (same parser as the registration verify). */
export const parseResetOtpVerifyBody = parseOtpVerifyBody;

export interface ResetOtpInput {
  /** Raw proof token as sent; its shape is checked by the service. */
  readonly verificationToken: string;
  readonly password: string;
}

/** Step 3: exactly {verification_token, password}. The phone is NOT sent: it is the one the proof was issued to. */
export function parseResetOtpBody(body: unknown): ResetOtpInput {
  const parsed = exactObject(body, ['verification_token', 'password']);
  if (typeof parsed.verification_token !== 'string' || parsed.verification_token.length > 64) {
    throw new BadRequestException();
  }
  return { verificationToken: parsed.verification_token, password: parsePassword(parsed.password) };
}
