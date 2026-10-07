import { TechnicalError } from '../common/app-errors';
import { TransactionManager } from '../transaction/transaction-manager';

export interface CleanupResult {
  readonly replayPayloadsCleared: number;
  readonly tombstonesDeleted: number;
}

export class IdempotencyCleanup {
  readonly #transactions: TransactionManager;

  constructor(transactions: TransactionManager) {
    this.#transactions = transactions;
  }

  async runBatch(batchSize = 100): Promise<CleanupResult> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
      throw new RangeError('cleanup batchSize must be 1..500');
    }

    const replayPayloadsCleared = await this.#transactions.withTransaction(async (context) => {
      const result = await context.query(
        `WITH candidates AS (
          SELECT record_id
          FROM app.idempotency_records
          WHERE replay_expires_at <= clock_timestamp()
            AND replay_ciphertext IS NOT NULL
          ORDER BY replay_expires_at, record_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE app.idempotency_records AS r
        SET replay_ciphertext = NULL, replay_iv = NULL, replay_tag = NULL
        FROM candidates AS c
        WHERE r.record_id = c.record_id
          AND r.replay_expires_at <= clock_timestamp()
          AND r.replay_ciphertext IS NOT NULL
        RETURNING r.record_id`,
        [batchSize],
      );
      return result.rowCount ?? 0;
    });

    const tombstonesDeleted = await this.#transactions.withTransaction(async (context) => {
      const result = await context.query(
        `WITH candidates AS (
          SELECT record_id
          FROM app.idempotency_records
          WHERE dedupe_expires_at <= clock_timestamp()
          ORDER BY dedupe_expires_at, record_id
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        DELETE FROM app.idempotency_records AS r
        USING candidates AS c
        WHERE r.record_id = c.record_id
          AND r.dedupe_expires_at <= clock_timestamp()
        RETURNING r.record_id`,
        [batchSize],
      );
      return result.rowCount ?? 0;
    });

    if (replayPayloadsCleared < 0 || tombstonesDeleted < 0) {
      throw new TechnicalError('internal', 'Invalid cleanup result');
    }
    return { replayPayloadsCleared, tombstonesDeleted };
  }
}
