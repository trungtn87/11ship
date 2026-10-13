import { BadRequestException } from '@nestjs/common';
import { exactObject, parsePassword } from '../auth/auth-validation';
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
