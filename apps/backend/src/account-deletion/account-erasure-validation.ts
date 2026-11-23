import { BadRequestException } from '@nestjs/common';
import { exactObject, isWellFormed } from '../auth/auth-validation';
import { isOtpShape } from '../auth/otp';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ErasureCodeInput {
  /** The owner agreed that a balance below the minimum withdrawal is forfeited (shown in the app before this request). */
  readonly acceptForfeit: boolean;
}

export interface ErasureConfirmInput extends ErasureCodeInput {
  readonly verificationId: string;
  readonly otp: string;
}

/** POST /v1/account/deletion/code: exactly {accept_forfeit}. */
export function parseErasureCodeBody(body: unknown): ErasureCodeInput {
  const parsed = exactObject(body, ['accept_forfeit']);
  if (typeof parsed.accept_forfeit !== 'boolean') {
    throw new BadRequestException();
  }
  return { acceptForfeit: parsed.accept_forfeit };
}

/** POST /v1/account/deletion/confirm: exactly {verification_id, otp, accept_forfeit}. Failures never echo the offending value. */
export function parseErasureConfirmBody(body: unknown): ErasureConfirmInput {
  const parsed = exactObject(body, ['verification_id', 'otp', 'accept_forfeit']);
  if (typeof parsed.verification_id !== 'string' || !UUID.test(parsed.verification_id) || !isOtpShape(parsed.otp) || !isWellFormed(parsed.otp)) {
    throw new BadRequestException();
  }
  if (typeof parsed.accept_forfeit !== 'boolean') {
    throw new BadRequestException();
  }
  return { verificationId: parsed.verification_id, otp: parsed.otp, acceptForfeit: parsed.accept_forfeit };
}
