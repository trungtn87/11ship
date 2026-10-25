import { deriveLockKey, LockKey } from '../shared/lock-key';
import { OTP_IP_LOCK_DOMAIN, OTP_REQUEST_LOCK_DOMAIN } from './auth-constants';

/**
 * The two signed int32 arguments of pg_advisory_xact_lock(int, int) that serialize one OTP "lane":
 * (phone_normalized, purpose). They come from the SHA-256 of the canonical JSON array
 *   ["11ship.auth.otp.request.v1", phone_normalized, purpose]
 * so there is no delimiter-free concatenation, and a hash collision can only serialize two unrelated lanes
 * (correctness never depends on this lock being exclusive to one lane).
 */
export function otpRequestLockKey(phoneNormalized: string, purpose: string): LockKey {
  return deriveLockKey(OTP_REQUEST_LOCK_DOMAIN, [phoneNormalized, purpose]);
}

/**
 * Issue #117: the lock that serializes every OTP request of one PHONE, whatever the purpose or the app. The cooldown and the per-phone
 * quota are checked and the challenge row is written under it, so two requests (REGISTER and RESET_PASSWORD, 11Food and 11Ship) cannot
 * both pass the same check.
 */
export function otpPhoneLockKey(phoneNormalized: string): LockKey {
  return deriveLockKey(OTP_REQUEST_LOCK_DOMAIN, ['phone', phoneNormalized]);
}

/** The lock that serializes the quota check and the counter insert of one client-address identity (HMAC, never the address). */
export function otpIpLockKey(ipHmac: string): LockKey {
  return deriveLockKey(OTP_IP_LOCK_DOMAIN, [ipHmac]);
}
