import { deriveLockKey, LockKey } from '../shared/lock-key';
import { OTP_REQUEST_LOCK_DOMAIN } from './auth-constants';

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
