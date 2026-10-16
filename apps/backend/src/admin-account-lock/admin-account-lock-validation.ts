import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parser of the lock / unlock body (M01-ADMIN, D15). Exactly {expected_version, reason}: the target comes from the path,
// the actor from the session, the new status from the route. Anything else is ADMIN_INPUT_INVALID.

export const REASON_MAX_CODE_POINTS = 500;

/** Why an administrator locks an account (the third reason, DELETE_REQUEST, only comes from the delete command). */
export type AdminLockReason = 'VIOLATION' | 'SECURITY';

export interface LockBody {
  readonly expectedVersion: number;
  /** Trimmed, 1..500 code points. */
  readonly reason: string;
  /** Lock only: the category of the lock. Defaults to VIOLATION; it is never accepted on unlock or delete. */
  readonly lockReason: AdminLockReason;
}

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

export function parseTargetUserId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
}

/** `allowLockReason` = the lock command: it may carry the optional category. Unlock and delete take exactly {expected_version, reason}. */
export function parseLockBody(body: unknown, allowLockReason = false): LockBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  const source = body as Record<string, unknown>;
  const keys = Object.keys(source);
  const hasCategory = Object.hasOwn(source, 'lock_reason');
  if (
    keys.length !== (hasCategory ? 3 : 2) ||
    (hasCategory && !allowLockReason) ||
    !Object.hasOwn(source, 'expected_version') ||
    !Object.hasOwn(source, 'reason')
  ) {
    invalid();
  }
  if (hasCategory && source.lock_reason !== 'VIOLATION' && source.lock_reason !== 'SECURITY') {
    invalid();
  }
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    invalid();
  }
  if (typeof source.reason !== 'string') {
    invalid();
  }
  const reason = source.reason.trim();
  const length = [...reason].length;
  if (length < 1 || length > REASON_MAX_CODE_POINTS) {
    invalid();
  }
  return { expectedVersion: version, reason, lockReason: hasCategory ? (source.lock_reason as AdminLockReason) : 'VIOLATION' };
}
