import { TechnicalError } from '../common/app-errors';

export type CryptoFailureReason =
  | 'invalid_key_id'
  | 'invalid_key_material'
  | 'duplicate_key_id'
  | 'unknown_active_key'
  | 'invalid_keyring'
  | 'invalid_input'
  | 'invalid_envelope'
  | 'authentication_failed'
  | 'rng_failure';

/**
 * Fail-closed cryptographic failure. The message carries only a fixed reason: never a key id, key
 * material, ciphertext, IV, tag or plaintext. Over HTTP it becomes the generic 500 envelope.
 */
export class CryptoError extends TechnicalError {
  readonly reason: CryptoFailureReason;

  constructor(reason: CryptoFailureReason) {
    super('internal', `Cryptographic operation failed (${reason})`);
    this.name = 'CryptoError';
    this.reason = reason;
  }
}
