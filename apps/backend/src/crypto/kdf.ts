import { hkdfSync } from 'node:crypto';

// HKDF-SHA-256 domain separation for Crypto format v1 (ADR-003 §13.3).
export const HKDF_SALT = Buffer.from('11ship.transactional-core.v1', 'utf8');
export const HKDF_INFO_REQUEST_HMAC = Buffer.from('request-hmac.v1', 'utf8');
export const HKDF_INFO_REPLAY_ENCRYPTION = Buffer.from('replay-aes-gcm.v1', 'utf8');
export const MASTER_KEY_BYTES = 32;
export const SUBKEY_BYTES = 32;

export interface DerivedSubkeys {
  readonly requestHmac: Buffer;
  readonly replayEncryption: Buffer;
}

export function deriveSubkeys(master: Buffer): DerivedSubkeys {
  return {
    requestHmac: Buffer.from(hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_REQUEST_HMAC, SUBKEY_BYTES)),
    replayEncryption: Buffer.from(
      hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_REPLAY_ENCRYPTION, SUBKEY_BYTES),
    ),
  };
}
