import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

export const SEPAY_CURSOR_KEY = 'SEPAY_COMPANY';

export interface ReconciliationCursor {
  /** The id of the last transaction of the last completely committed run; null on the very first run. */
  readonly lastTransactionUuid: string | null;
  /** The earliest time (epoch ms) the job may call SePay again after a 429; null when not backing off. */
  readonly notBeforeMs: number | null;
  /** When the cursor last moved (epoch ms), or when it was seeded. Used to tell a quiet period from a cursor that no longer moves. */
  readonly advancedAtMs: number;
}

/**
 * The one cursor row of the reconciliation job (app.sepay_reconciliation_cursor, seeded by the migration). The runtime may read and update it,
 * never insert or delete. The cursor moves only in [record] called after a whole run committed; a failed run writes only its outcome.
 */
@Injectable()
export class SepayReconciliationCursorRepository {
  async read(context: TransactionContext): Promise<ReconciliationCursor> {
    const result = await context.query<{ last_transaction_uuid: string | null; not_before_ms: string | null; advanced_ms: string }>(
      `SELECT last_transaction_uuid::text AS last_transaction_uuid,
              CASE WHEN not_before_at IS NULL THEN NULL ELSE (extract(epoch FROM not_before_at) * 1000)::bigint::text END AS not_before_ms,
              (extract(epoch FROM cursor_advanced_at) * 1000)::bigint::text AS advanced_ms
         FROM app.sepay_reconciliation_cursor WHERE cursor_key = $1`,
      [SEPAY_CURSOR_KEY],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('SePay reconciliation cursor row is missing');
    }
    return {
      lastTransactionUuid: row.last_transaction_uuid,
      notBeforeMs: row.not_before_ms === null ? null : Number(row.not_before_ms),
      advancedAtMs: Number(row.advanced_ms),
    };
  }

  /**
   * Records the outcome of a run. A null lastTransactionUuid keeps the stored cursor; a value moves it and stamps cursor_advanced_at (only after a
   * complete run). A null notBeforeMs clears any back-off.
   */
  async record(context: TransactionContext, input: { readonly lastTransactionUuid: string | null; readonly outcome: string; readonly notBeforeMs: number | null }): Promise<void> {
    const result = await context.query(
      `UPDATE app.sepay_reconciliation_cursor
          SET last_transaction_uuid = COALESCE($2::uuid, last_transaction_uuid),
              cursor_advanced_at = CASE WHEN $2::uuid IS NULL THEN cursor_advanced_at ELSE date_trunc('milliseconds', clock_timestamp()) END,
              last_outcome = $3::varchar,
              last_run_at = date_trunc('milliseconds', clock_timestamp()),
              not_before_at = CASE WHEN $4::bigint IS NULL THEN NULL ELSE to_timestamp($4::bigint / 1000.0) END,
              updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE cursor_key = $1`,
      [SEPAY_CURSOR_KEY, input.lastTransactionUuid, input.outcome, input.notBeforeMs === null ? null : input.notBeforeMs.toString()],
    );
    if (result.rowCount !== 1) {
      throw new Error('SePay reconciliation cursor row is missing');
    }
  }
}
