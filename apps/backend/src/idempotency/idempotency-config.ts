// Idempotency configuration values and bounds (ADR-003 sections 3.2, 5 and 13.1/13.4). Pure data and
// validation: nothing here reads the environment or talks to a database.

export const DEFAULT_ADVISORY_WAIT_MS = 250;
export const MIN_ADVISORY_WAIT_MS = 1;
export const MAX_ADVISORY_WAIT_MS = 5000;

// PostgreSQL treats lock_timeout = 0 as "no timeout", so the business budget must be at least 1 ms.
export const DEFAULT_BUSINESS_LOCK_TIMEOUT_MS = 500;
export const MIN_BUSINESS_LOCK_TIMEOUT_MS = 1;
export const MAX_BUSINESS_LOCK_TIMEOUT_MS = 30_000;

export const DEFAULT_REPLAY_TTL_SECONDS = 900;
export const DEFAULT_DEDUPE_TTL_SECONDS = 604_800;
export const MIN_TTL_SECONDS = 1;
export const MAX_TTL_SECONDS = 604_800;

export interface IdempotencyConfig {
  /** How long a request waits for the advisory lock of its key before IDEMPOTENCY_BUSY. */
  readonly advisoryWaitMs: number;
  /** lock_timeout restored right after the advisory lock, for every business/row lock. */
  readonly businessLockTimeoutMs: number;
  /** Default replay window (seconds): after it the encrypted replay payload is not served. */
  readonly replayTtlSeconds: number;
  /** Default dedupe window (seconds): after it the key may open a new idempotency window. */
  readonly dedupeTtlSeconds: number;
}

/** Per-operation TTL override. It comes from a server-side registry, never from a client. */
export interface IdempotencyTtl {
  readonly replaySeconds: number;
  readonly dedupeSeconds: number;
}

export const DEFAULT_IDEMPOTENCY_CONFIG: IdempotencyConfig = Object.freeze({
  advisoryWaitMs: DEFAULT_ADVISORY_WAIT_MS,
  businessLockTimeoutMs: DEFAULT_BUSINESS_LOCK_TIMEOUT_MS,
  replayTtlSeconds: DEFAULT_REPLAY_TTL_SECONDS,
  dedupeTtlSeconds: DEFAULT_DEDUPE_TTL_SECONDS,
});

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** 1 <= replay <= dedupe <= 604800 (seconds), integers only. */
export function isValidTtl(replaySeconds: number, dedupeSeconds: number): boolean {
  return (
    isIntegerIn(replaySeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS) &&
    isIntegerIn(dedupeSeconds, MIN_TTL_SECONDS, MAX_TTL_SECONDS) &&
    replaySeconds <= dedupeSeconds
  );
}

/**
 * Guards a config object handed straight to the executor (the environment loader validates the same
 * bounds and, in addition, the relation to the database statement timeout). Throws a RangeError whose
 * message carries no value.
 */
export function assertIdempotencyConfig(config: IdempotencyConfig): void {
  if (
    !isIntegerIn(config.advisoryWaitMs, MIN_ADVISORY_WAIT_MS, MAX_ADVISORY_WAIT_MS) ||
    !isIntegerIn(config.businessLockTimeoutMs, MIN_BUSINESS_LOCK_TIMEOUT_MS, MAX_BUSINESS_LOCK_TIMEOUT_MS) ||
    !isValidTtl(config.replayTtlSeconds, config.dedupeTtlSeconds)
  ) {
    throw new RangeError('invalid idempotency configuration');
  }
}
