import { createHash } from 'node:crypto';
import { canonicalJson } from './json/safe-json';

// Deterministic derivation of the two int32 arguments of PostgreSQL's pg_advisory_xact_lock(int, int).
// Two signed 32-bit integers are used instead of one bigint so no JavaScript Number ever has to
// hold an arbitrary 64-bit value. A hash collision only serializes two unrelated tuples; it can
// never make them share a result (that is guaranteed by the exact-key UNIQUE constraint, not here).
// This module only derives the keys; it takes no lock itself.

export const IDEMPOTENCY_LOCK_DOMAIN = '11ship.idempotency.lock.v1';

export type LockKey = readonly [number, number];

export function deriveLockKey(domain: string, parts: readonly string[]): LockKey {
  if (typeof domain !== 'string' || !parts.every((part) => typeof part === 'string')) {
    throw new TypeError('lock key parts must be strings');
  }
  const digest = createHash('sha256')
    .update(Buffer.from(canonicalJson([domain, ...parts]), 'utf8'))
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export function idempotencyLockKey(
  scopeType: string,
  scopeId: string,
  operationId: string,
  idempotencyKey: string,
): LockKey {
  return deriveLockKey(IDEMPOTENCY_LOCK_DOMAIN, [scopeType, scopeId, operationId, idempotencyKey]);
}
