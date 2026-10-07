import { TransactionRunner } from './idempotency-executor';

export const DEFAULT_CLEANUP_BATCH_SIZE = 100;
export const MAX_CLEANUP_BATCH_SIZE = 1000;

export interface CleanupResult {
  /** Phase 1: records whose replay material was removed (tombstone kept). */
  readonly replayCleared: number;
  /** Phase 2: records deleted after the dedupe window. */
  readonly recordsDeleted: number;
}

function assertBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_CLEANUP_BATCH_SIZE) {
    throw new RangeError('invalid cleanup batch size');
  }
}

/**
 * Callable cleanup primitive for app.idempotency_records (ADR-003 section 5). There is NO scheduler
 * here: a later slice or an operator calls it. Each phase is one short transaction that
 *  - claims a bounded batch with FOR UPDATE SKIP LOCKED (a row held by an executor is skipped, so
 *    cleanup never nulls or deletes a row that is being replayed);
 *  - re-checks eligibility against a fresh clock_timestamp() on the claimed rows, in the same
 *    transaction that holds their locks;
 *  - never takes an advisory lock (the executor takes advisory THEN row lock, cleanup only a row lock,
 *    so no lock-order cycle can form).
 * The executor's correctness does not depend on this ever running.
 */
export class IdempotencyCleanup {
  readonly #manager: TransactionRunner;

  constructor(manager: TransactionRunner) {
    this.#manager = manager;
  }

  /**
   * Phase 1: for records past their replay TTL, null ciphertext/IV/tag and KEEP the row (the
   * fingerprint tombstone keeps answering IDEMPOTENCY_REPLAY_EXPIRED / IDEMPOTENCY_KEY_REUSED).
   */
  async clearExpiredReplay(batchSize: number = DEFAULT_CLEANUP_BATCH_SIZE): Promise<number> {
    assertBatchSize(batchSize);
    return this.#manager.withTransaction(async (context) => {
      const claimed = await context.query<{ record_id: string }>(
        `SELECT record_id
           FROM app.idempotency_records
          WHERE replay_ciphertext IS NOT NULL AND replay_expires_at <= clock_timestamp()
          ORDER BY replay_expires_at, record_id
          LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (claimed.rows.length === 0) {
        return 0;
      }
      // Eligibility is evaluated again now that the rows are locked.
      const updated = await context.query(
        `UPDATE app.idempotency_records
            SET replay_ciphertext = NULL, replay_iv = NULL, replay_tag = NULL
          WHERE record_id = ANY($1::uuid[])
            AND replay_ciphertext IS NOT NULL
            AND replay_expires_at <= clock_timestamp()`,
        [claimed.rows.map((row) => row.record_id)],
      );
      return updated.rowCount ?? 0;
    });
  }

  /** Phase 2: delete records past their dedupe TTL (after this the key opens a new window). */
  async deleteExpiredRecords(batchSize: number = DEFAULT_CLEANUP_BATCH_SIZE): Promise<number> {
    assertBatchSize(batchSize);
    return this.#manager.withTransaction(async (context) => {
      const claimed = await context.query<{ record_id: string }>(
        `SELECT record_id
           FROM app.idempotency_records
          WHERE dedupe_expires_at <= clock_timestamp()
          ORDER BY dedupe_expires_at, record_id
          LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (claimed.rows.length === 0) {
        return 0;
      }
      const deleted = await context.query(
        `DELETE FROM app.idempotency_records
          WHERE record_id = ANY($1::uuid[])
            AND dedupe_expires_at <= clock_timestamp()`,
        [claimed.rows.map((row) => row.record_id)],
      );
      return deleted.rowCount ?? 0;
    });
  }

  /** One bounded pass of both phases, in order. */
  async runOnce(batchSize: number = DEFAULT_CLEANUP_BATCH_SIZE): Promise<CleanupResult> {
    assertBatchSize(batchSize);
    const replayCleared = await this.clearExpiredReplay(batchSize);
    const recordsDeleted = await this.deleteExpiredRecords(batchSize);
    return { replayCleared, recordsDeleted };
  }
}
