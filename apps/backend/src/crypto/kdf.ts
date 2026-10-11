import { hkdfSync } from 'node:crypto';

// HKDF-SHA-256 domain separation for Crypto format v1 (ADR-003 §13.3).
export const HKDF_SALT = Buffer.from('11ship.transactional-core.v1', 'utf8');
export const HKDF_INFO_REQUEST_HMAC = Buffer.from('request-hmac.v1', 'utf8');
export const HKDF_INFO_REPLAY_ENCRYPTION = Buffer.from('replay-aes-gcm.v1', 'utf8');
// Administration web authentication (M01-D-LOGIN): one purpose, one subkey. They never share a key with the
// replay subkeys above, so a value from one purpose can never be replayed as another.
export const HKDF_INFO_ADMIN_PASSWORD_BINDING = Buffer.from('admin-password-binding.v1', 'utf8');
export const HKDF_INFO_ADMIN_CSRF = Buffer.from('admin-csrf.v1', 'utf8');
export const HKDF_INFO_ADMIN_TOTP_ENCRYPTION = Buffer.from('admin-totp-aes-gcm.v1', 'utf8');
// M01-D-ADMIN-1B: the step-up operation fingerprint has its own purpose subkey. Added after the others; the existing
// derivations above are unchanged (their known-answer vectors in kdf.spec.ts still hold).
export const HKDF_INFO_ADMIN_OPERATION_HMAC = Buffer.from('admin-operation-hmac.v1', 'utf8');
// M01-D-ADMIN-1C: the activation OTP digest has its own purpose subkey (added last; earlier derivations unchanged).
export const HKDF_INFO_ADMIN_ACTIVATION_OTP_HMAC = Buffer.from('admin-activation-otp-hmac.v1', 'utf8');
export const MASTER_KEY_BYTES = 32;
export const SUBKEY_BYTES = 32;

export interface DerivedSubkeys {
  readonly requestHmac: Buffer;
  readonly replayEncryption: Buffer;
  readonly adminPasswordBinding: Buffer;
  readonly adminCsrf: Buffer;
  readonly adminTotpEncryption: Buffer;
  readonly adminOperation: Buffer;
  readonly adminActivationOtp: Buffer;
}

export function deriveSubkeys(master: Buffer): DerivedSubkeys {
  return {
    requestHmac: Buffer.from(hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_REQUEST_HMAC, SUBKEY_BYTES)),
    replayEncryption: Buffer.from(
      hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_REPLAY_ENCRYPTION, SUBKEY_BYTES),
    ),
    adminPasswordBinding: Buffer.from(
      hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_ADMIN_PASSWORD_BINDING, SUBKEY_BYTES),
    ),
    adminCsrf: Buffer.from(hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_ADMIN_CSRF, SUBKEY_BYTES)),
    adminTotpEncryption: Buffer.from(
      hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_ADMIN_TOTP_ENCRYPTION, SUBKEY_BYTES),
    ),
    adminOperation: Buffer.from(hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_ADMIN_OPERATION_HMAC, SUBKEY_BYTES)),
    adminActivationOtp: Buffer.from(
      hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO_ADMIN_ACTIVATION_OTP_HMAC, SUBKEY_BYTES),
    ),
  };
}
