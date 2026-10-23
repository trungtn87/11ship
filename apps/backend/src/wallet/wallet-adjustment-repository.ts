import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';

export interface AdjustmentRow {
  readonly adjustmentId: string;
  readonly walletId: string;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
  readonly amountVnd: bigint;
}

/** The SQL of the adjustment posting (M04): the adjustment record and its one ledger row. The wallet lock and the balance belong to TopupSettlementRepository. */
@Injectable()
export class WalletAdjustmentRepository {
  /** The adjustment already posted for this source, or undefined. A plain read under the wallet lock the caller holds. */
  async findBySource(context: TransactionContext, sourceType: 'COMPLAINT', sourceId: string): Promise<AdjustmentRow | undefined> {
    const result = await context.query<{ adjustment_id: string; wallet_id: string; direction: AdjustmentRow['direction']; amount_vnd: string }>(
      `SELECT adjustment_id::text AS adjustment_id, wallet_id::text AS wallet_id, direction, amount_vnd::text AS amount_vnd
         FROM app.wallet_adjustments WHERE source_type = $1 AND source_id = $2::uuid`,
      [sourceType, sourceId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { adjustmentId: row.adjustment_id, walletId: row.wallet_id, direction: row.direction, amountVnd: BigInt(row.amount_vnd) };
  }

  async insert(context: TransactionContext, input: { adjustmentId: string; walletId: string; sourceType: 'COMPLAINT'; sourceId: string; direction: AdjustmentRow['direction']; amountVnd: bigint; postedBy: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.wallet_adjustments (adjustment_id, wallet_id, source_type, source_id, direction, amount_vnd, posted_by, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6::bigint, $7::uuid, date_trunc('milliseconds', clock_timestamp()))`,
      [input.adjustmentId, input.walletId, input.sourceType, input.sourceId, input.direction, input.amountVnd.toString(), input.postedBy],
    );
  }

  async insertLedger(context: TransactionContext, input: { entryId: string; walletId: string; sequenceNo: number; kind: 'ADJUSTMENT_CREDIT' | 'ADJUSTMENT_DEBIT'; deltaVnd: bigint; balanceAfterVnd: bigint; adjustmentId: string }): Promise<void> {
    await context.query(
      `INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, adjustment_id)
       VALUES ($1::uuid, $2::uuid, $3::bigint, $4, $5::bigint, $6::bigint, date_trunc('milliseconds', clock_timestamp()), $7::uuid)`,
      [input.entryId, input.walletId, input.sequenceNo, input.kind, input.deltaVnd.toString(), input.balanceAfterVnd.toString(), input.adjustmentId],
    );
  }
}
