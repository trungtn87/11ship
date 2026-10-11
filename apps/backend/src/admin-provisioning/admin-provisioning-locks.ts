import { AdminLimiterKey } from '../config/admin-auth-config';
import { deriveLockKey } from '../shared/lock-key';
import { TransactionContext } from '../transaction/transaction-context';
import { PHONE_LOCK_DOMAIN, PHONE_LOCK_LIMITER_KIND } from './admin-provisioning-constants';

// The two lock statements of M01-D-ADMIN-1B that are not row locks of a repository (contract sections 8.1 and 8.5).

/**
 * Owner decision: a 1B transaction that does NOT go through the idempotency executor sets lock_timeout with
 * set_config(..., is_local = true) BEFORE its first lock, from the validated businessLockTimeoutMs. The value dies with
 * the transaction; TransactionManager is not changed. (Executor routes already get the same budget from the executor.)
 */
export async function setBusinessLockTimeout(context: TransactionContext, businessLockTimeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(businessLockTimeoutMs) || businessLockTimeoutMs < 1) {
    throw new RangeError('businessLockTimeoutMs must be a positive integer');
  }
  await context.query("SELECT set_config('lock_timeout', $1, true)", [`${businessLockTimeoutMs}ms`]);
}

/** The two int32 arguments of the L3 phone advisory lock. The phone is keyed with the limiter key, never used raw. */
export function phoneLockKey(limiterKey: AdminLimiterKey, phoneNormalized: string): readonly [number, number] {
  return deriveLockKey(PHONE_LOCK_DOMAIN, [limiterKey.bucketKey(PHONE_LOCK_LIMITER_KIND, phoneNormalized)]);
}

/** L3: serializes every 1B write of one phone (create, reissue, revoke). Transaction-scoped: released at COMMIT/ROLLBACK. */
export async function lockPhone(context: TransactionContext, limiterKey: AdminLimiterKey, phoneNormalized: string): Promise<void> {
  const [first, second] = phoneLockKey(limiterKey, phoneNormalized);
  await context.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [first, second]);
}
