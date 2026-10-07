// Outbox dispatcher configuration values and bounds (ADR-003 §8 and §13.6, task C1 §9). Pure data and
// validation: nothing here reads the environment or talks to a database. It lives in the config folder
// (not in outbox/) so that nothing that loads AppConfig, TransactionModule included, depends on outbox code.

export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 5;
export const MIN_OUTBOX_MAX_ATTEMPTS = 1;
export const MAX_OUTBOX_MAX_ATTEMPTS = 20;

export const DEFAULT_OUTBOX_BATCH_SIZE = 10;
export const MIN_OUTBOX_BATCH_SIZE = 1;
export const MAX_OUTBOX_BATCH_SIZE = 100;

export const DEFAULT_OUTBOX_PUBLISH_CONCURRENCY = 10;
export const MIN_OUTBOX_PUBLISH_CONCURRENCY = 1;
export const MAX_OUTBOX_PUBLISH_CONCURRENCY = 100;

export const DEFAULT_OUTBOX_PUBLISH_TIMEOUT_MS = 5000;
export const DEFAULT_OUTBOX_LEASE_MS = 30_000;
export const DEFAULT_OUTBOX_BACKOFF_BASE_MS = 1000;
export const DEFAULT_OUTBOX_BACKOFF_CAP_MS = 60_000;
export const MIN_OUTBOX_DURATION_MS = 100;
export const MAX_OUTBOX_DURATION_MS = 300_000;

/** The lease must outlive the publish timeout by at least this long (the ack/fail transition budget). */
export const OUTBOX_ACK_BUDGET_MS = 2000;

export interface OutboxConfig {
  /** Claims after which an event is DEAD instead of being retried (attempt_count >= maxAttempts). */
  readonly maxAttempts: number;
  /** Upper bound of events claimed in one cycle (the effective limit is also bound by free slots). */
  readonly batchSize: number;
  /** Maximum number of underlying publisher promises that are not yet settled, per dispatcher. */
  readonly publishConcurrency: number;
  /** After this long the publish outcome is unknown and the attempt is failed with PUBLISH_TIMEOUT. */
  readonly publishTimeoutMs: number;
  /** A PROCESSING row whose lease is older than this (PostgreSQL time) may be reclaimed. */
  readonly leaseMs: number;
  /** First retry delay: min(cap, base * 2^(attempt_count - 1)). No jitter. */
  readonly backoffBaseMs: number;
  readonly backoffCapMs: number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = Object.freeze({
  maxAttempts: DEFAULT_OUTBOX_MAX_ATTEMPTS,
  batchSize: DEFAULT_OUTBOX_BATCH_SIZE,
  publishConcurrency: DEFAULT_OUTBOX_PUBLISH_CONCURRENCY,
  publishTimeoutMs: DEFAULT_OUTBOX_PUBLISH_TIMEOUT_MS,
  leaseMs: DEFAULT_OUTBOX_LEASE_MS,
  backoffBaseMs: DEFAULT_OUTBOX_BACKOFF_BASE_MS,
  backoffCapMs: DEFAULT_OUTBOX_BACKOFF_CAP_MS,
});

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/** lease > publish timeout + 2000 ms: a live publish attempt can never be reclaimed under its own worker. */
export function isValidLeaseRelation(leaseMs: number, publishTimeoutMs: number): boolean {
  return leaseMs > publishTimeoutMs + OUTBOX_ACK_BUDGET_MS;
}

export function isValidBackoffRelation(baseMs: number, capMs: number): boolean {
  return baseMs <= capMs;
}

/**
 * Guards a config object handed straight to the store or dispatcher (the environment loader validates the
 * same bounds and relations). Throws a RangeError whose message carries no value.
 */
export function assertOutboxConfig(config: OutboxConfig): void {
  if (
    !isIntegerIn(config.maxAttempts, MIN_OUTBOX_MAX_ATTEMPTS, MAX_OUTBOX_MAX_ATTEMPTS) ||
    !isIntegerIn(config.batchSize, MIN_OUTBOX_BATCH_SIZE, MAX_OUTBOX_BATCH_SIZE) ||
    !isIntegerIn(config.publishConcurrency, MIN_OUTBOX_PUBLISH_CONCURRENCY, MAX_OUTBOX_PUBLISH_CONCURRENCY) ||
    !isIntegerIn(config.publishTimeoutMs, MIN_OUTBOX_DURATION_MS, MAX_OUTBOX_DURATION_MS) ||
    !isIntegerIn(config.leaseMs, MIN_OUTBOX_DURATION_MS, MAX_OUTBOX_DURATION_MS) ||
    !isIntegerIn(config.backoffBaseMs, MIN_OUTBOX_DURATION_MS, MAX_OUTBOX_DURATION_MS) ||
    !isIntegerIn(config.backoffCapMs, MIN_OUTBOX_DURATION_MS, MAX_OUTBOX_DURATION_MS) ||
    !isValidLeaseRelation(config.leaseMs, config.publishTimeoutMs) ||
    !isValidBackoffRelation(config.backoffBaseMs, config.backoffCapMs)
  ) {
    throw new RangeError('invalid outbox configuration');
  }
}
