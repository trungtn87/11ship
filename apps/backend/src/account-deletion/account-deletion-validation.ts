import { BadRequestException } from '@nestjs/common';
import { exactObject, isWellFormed } from '../auth/auth-validation';
import { requireNormalizedPhone } from '../auth/phone';

export interface AccountDeletionInput {
  readonly phoneNormalized: string;
  /** The current password exactly as typed: never trimmed or normalized. */
  readonly password: string;
}

/**
 * POST /v1/account-deletion/confirm: exactly {phone, password}. No OTP, no token, no role, no "confirm" flag (the consequences are shown by
 * the client before the button). Failures never echo the offending value.
 */
export function parseAccountDeletionBody(body: unknown): AccountDeletionInput {
  const parsed = exactObject(body, ['phone', 'password']);
  if (typeof parsed.password !== 'string' || parsed.password === '' || !isWellFormed(parsed.password) || parsed.password.length > 1024) {
    throw new BadRequestException();
  }
  return { phoneNormalized: requireNormalizedPhone(parsed.phone), password: parsed.password };
}
