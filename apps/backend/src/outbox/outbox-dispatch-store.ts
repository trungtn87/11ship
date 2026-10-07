import { assertOutboxConfig, OutboxConfig } from '../config/outbox-config';
import { TechnicalError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { JsonObject } from '../shared/json/json-object';
import { TransactionContext } from '../transaction/transaction-context';
import { backoffDelayMs } from './outbox-backoff';
import { OutboxPublishEvent } from './outbox-publisher';

// ADR-003 §13.6 (state table) for app.outbox_events. Every persisted time decision is made INSIDE the SQL
// statement with the PostgreSQL clock (clock_timestamp(), sampled once per statement and truncated to the
// column's millisecond precision). There is no application clock anywhere in this file.
//
// Only DELIVERY columns are ever written: status, attempt_count, available_at, locked_at, lock_token,
// published_at, last_error_code. The immutable envelope (event_id, event_type, event_schema_version,
// resource_type, resource_id, resource_version, occurred_at, payload) is only ever READ.

/** The only two error codes a failed attempt may persist. Raw error codes/messages/stacks never reach the DB. */
export const OUTBOX_FAILURE_CODES = ['PUBLISH_FAILED', 'PUBLISH_TIMEOUT'] as const;
export type OutboxFailureCode = (typeof OUTBOX_FAILURE_CODES)[number];

/** Upper bound of exhausted rows that one claim transaction marks DEAD (they never take a publish slot). */
export const OUTBOX_DEAD_SWEEP_LIMIT = 100;

/** Structural subset of TransactionManager: the store opens only short transactions through it. */
export interface OutboxTransactionRunner {
  withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

/** What identifies one claim. Ack and fail are fenced by (eventId, lockToken). */
export interface OutboxLease {
  readonly eventId: string;
  readonly lockToken: string;
  /** attempt_count of the claim that issued the token; drives the backoff of a failure. */
  readonly attemptCount: number;
}

export interface ClaimedOutboxEvent extends OutboxPublishEvent {
  readonly lockToken: string;
}

export interface ClaimResult {
  /** Rows now PROCESSING under a fresh token. Only meaningful after the claim COMMIT was confirmed. */
  readonly events: readonly ClaimedOutboxEvent[];
  /** Due/stale rows with attempt_count >= max that this claim turned DEAD. */
  readonly deadCount: number;
}

/** What a failure transition did: scheduled a retry, ended the event as DEAD, or matched nothing. */
export type FailOutcome = 'RETRY_SCHEDULED' | 'DEAD' | 'NOOP';

/** The dispatcher talks to this port only, so it can be tested without a database. */
export interface OutboxDispatchStorePort {
  claim(limit: number): Promise<ClaimResult>;
  /** true when this call moved the row to PUBLISHED; false when token/status did not match (a no-op). */
  ack(lease: OutboxLease): Promise<boolean>;
  fail(lease: OutboxLease, code: OutboxFailureCode): Promise<FailOutcome>;
}

// Step 1 of a claim: due PENDING rows and stale PROCESSING rows that already used all their attempts become
// DEAD (lease cleared, event and payload kept). They are never published, and they never take a publish
// slot. One clock sample feeds every comparison of the statement.
const MARK_EXHAUSTED_DEAD_SQL = `
WITH clock AS MATERIALIZED (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS now
),
exhausted AS MATERIALIZED (
  SELECT e.event_id
    FROM app.outbox_events e, clock
   WHERE e.attempt_count >= $1::int
     AND (
       (e.status = 'PENDING' AND e.available_at <= clock.now)
       OR (e.status = 'PROCESSING' AND e.locked_at <= clock.now - $2::int * interval '1 millisecond')
     )
   ORDER BY e.event_id
   LIMIT $3::int
   FOR UPDATE OF e SKIP LOCKED
)
UPDATE app.outbox_events e
   SET status = 'DEAD', locked_at = NULL, lock_token = NULL
  FROM exhausted
 WHERE e.event_id = exhausted.event_id
RETURNING e.event_id`;

// Step 2 of a claim: due PENDING rows and stale PROCESSING rows with attempts left become PROCESSING with
// attempt_count + 1, a fresh random token (one per row) and locked_at = the PostgreSQL clock. SKIP LOCKED
// makes two concurrent claimers take disjoint rows. A lease is stale at equality (locked_at + lease <= now).
// Oldest due work first; the CASE is the sort key of whichever condition made the row claimable.
const CLAIM_SQL = `
WITH clock AS MATERIALIZED (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS now
),
due AS MATERIALIZED (
  SELECT e.event_id
    FROM app.outbox_events e, clock
   WHERE e.attempt_count < $1::int
     AND (
       (e.status = 'PENDING' AND e.available_at <= clock.now)
       OR (e.status = 'PROCESSING' AND e.locked_at <= clock.now - $2::int * interval '1 millisecond')
     )
   ORDER BY (CASE WHEN e.status = 'PENDING' THEN e.available_at ELSE e.locked_at END), e.event_id
   LIMIT $3::int
   FOR UPDATE OF e SKIP LOCKED
)
UPDATE app.outbox_events e
   SET status = 'PROCESSING',
       attempt_count = e.attempt_count + 1,
       lock_token = gen_random_uuid(),
       locked_at = clock.now
  FROM due, clock
 WHERE e.event_id = due.event_id
RETURNING e.event_id, e.event_type, e.event_schema_version, e.resource_type, e.resource_id,
          e.resource_version, e.occurred_at, e.payload, e.attempt_count, e.lock_token`;

// Ack: conditional on the exact (event_id, PROCESSING, lock_token). Any other state, or another token (a
// worker whose lease was reclaimed), matches zero rows and changes nothing.
const ACK_SQL = `
UPDATE app.outbox_events
   SET status = 'PUBLISHED',
       published_at = date_trunc('milliseconds', clock_timestamp()),
       locked_at = NULL,
       lock_token = NULL
 WHERE event_id = $1::uuid AND status = 'PROCESSING' AND lock_token = $2::uuid
RETURNING event_id`;

// Fail/timeout: same fence. attempt_count is read from the row: below the maximum the event goes back to
// PENDING at DB time + the precomputed backoff, at or above it the event is DEAD (available_at untouched).
// The lease is always cleared and the only error text ever written is one of the two fixed codes.
const FAIL_SQL = `
WITH clock AS MATERIALIZED (
  SELECT date_trunc('milliseconds', clock_timestamp()) AS now
)
UPDATE app.outbox_events e
   SET status = CASE WHEN e.attempt_count >= $3::int THEN 'DEAD' ELSE 'PENDING' END,
       available_at = CASE
         WHEN e.attempt_count >= $3::int THEN e.available_at
         ELSE clock.now + $4::int * interval '1 millisecond'
       END,
       locked_at = NULL,
       lock_token = NULL,
       last_error_code = $5::varchar
  FROM clock
 WHERE e.event_id = $1::uuid AND e.status = 'PROCESSING' AND e.lock_token = $2::uuid
RETURNING e.status`;

interface ClaimRow {
  event_id: string;
  event_type: string;
  event_schema_version: number;
  resource_type: string;
  resource_id: string;
  resource_version: string | number;
  occurred_at: Date;
  payload: JsonObject;
  attempt_count: number;
  lock_token: string;
}

function toClaimed(row: ClaimRow): ClaimedOutboxEvent {
  const resourceVersion = Number(row.resource_version);
  if (!Number.isSafeInteger(resourceVersion)) {
    throw new TechnicalError('internal', 'Outbox row has an unsupported resource version');
  }
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    eventSchemaVersion: row.event_schema_version,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    resourceVersion,
    occurredAt: row.occurred_at.toISOString(),
    payload: row.payload,
    attemptCount: row.attempt_count,
    lockToken: row.lock_token,
  };
}

/**
 * Database side of the outbox dispatcher: claim/reclaim, ack and fail, each as ONE short transaction
 * through the transaction coordinator (never a long one, never around a publisher).
 *
 * - Claim: exhausted due/stale rows -> DEAD; due PENDING and stale PROCESSING rows with attempts left ->
 *   PROCESSING + attempt_count + 1 + fresh token + locked_at, FOR UPDATE SKIP LOCKED. The result is only
 *   returned after PostgreSQL confirmed the COMMIT: if the COMMIT outcome is unknown, withTransaction throws
 *   and the caller gets NO events (so nothing from that batch can be published); recovery is the lease.
 * - Ack/fail: WHERE event_id AND status = 'PROCESSING' AND lock_token. A mismatch is a quiet no-op.
 * - Time: PostgreSQL clock only. Retry delay: min(cap, base * 2^(attempt_count - 1)), no jitter.
 * - It never writes the immutable envelope.
 */
export class OutboxDispatchStore implements OutboxDispatchStorePort {
  readonly #runner: OutboxTransactionRunner;
  readonly #config: OutboxConfig;

  constructor(runner: OutboxTransactionRunner, config: OutboxConfig) {
    assertOutboxConfig(config);
    this.#runner = runner;
    this.#config = config;
  }

  async claim(limit: number): Promise<ClaimResult> {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > this.#config.batchSize) {
      throw new RangeError('claim limit must be an integer between 0 and the batch size');
    }
    if (limit === 0) {
      return { events: [], deadCount: 0 };
    }
    const { maxAttempts, leaseMs } = this.#config;
    return this.#runner.withTransaction(async (context) => {
      const dead = await context.query(MARK_EXHAUSTED_DEAD_SQL, [
        maxAttempts,
        leaseMs,
        OUTBOX_DEAD_SWEEP_LIMIT,
      ]);
      const claimed = await context.query<ClaimRow>(CLAIM_SQL, [maxAttempts, leaseMs, limit]);
      return { events: claimed.rows.map(toClaimed), deadCount: dead.rows.length };
    });
  }

  async ack(lease: OutboxLease): Promise<boolean> {
    if (!isCanonicalUuid(lease.eventId) || !isCanonicalUuid(lease.lockToken)) {
      return false; // a malformed id or token can never match a row
    }
    return this.#runner.withTransaction(async (context) => {
      const result = await context.query(ACK_SQL, [lease.eventId, lease.lockToken]);
      return result.rows.length === 1;
    });
  }

  async fail(lease: OutboxLease, code: OutboxFailureCode): Promise<FailOutcome> {
    if (!OUTBOX_FAILURE_CODES.includes(code)) {
      throw new RangeError('unsupported outbox failure code');
    }
    if (!isCanonicalUuid(lease.eventId) || !isCanonicalUuid(lease.lockToken)) {
      return 'NOOP';
    }
    const delayMs = backoffDelayMs(
      lease.attemptCount,
      this.#config.backoffBaseMs,
      this.#config.backoffCapMs,
    );
    return this.#runner.withTransaction(async (context) => {
      const result = await context.query<{ status: string }>(FAIL_SQL, [
        lease.eventId,
        lease.lockToken,
        this.#config.maxAttempts,
        delayMs,
        code,
      ]);
      const status = result.rows[0]?.status;
      if (status === 'PENDING') {
        return 'RETRY_SCHEDULED';
      }
      if (status === 'DEAD') {
        return 'DEAD';
      }
      return 'NOOP';
    });
  }
}
