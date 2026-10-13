import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parser of the lock / unlock body (M01-ADMIN, D15). Exactly {expected_version, reason}: the target comes from the path,
// the actor from the session, the new status from the route. Anything else is ADMIN_INPUT_INVALID.

export const REASON_MAX_CODE_POINTS = 500;

export interface LockBody {
  readonly expectedVersion: number;
  /** Trimmed, 1..500 code points. */
  readonly reason: string;
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

export function parseLockBody(body: unknown): LockBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  const source = body as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== 2 || !Object.hasOwn(source, 'expected_version') || !Object.hasOwn(source, 'reason')) {
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
  return { expectedVersion: version, reason };
}
