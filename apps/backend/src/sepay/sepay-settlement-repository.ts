import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { SepayTransferEvent } from './sepay-event';

export type InboxState = 'RECEIVED' | 'CREDITED' | 'NEEDS_ADMIN' | 'IGNORED';

/**
 * SQL of the SePay inbox only (sepay_transfer_inbox). Lookups on wallet tables are in wallet/topup-auto-lookup-repository.ts (package rule), and the
 * locks and the credit are the existing DriverRepository, TopupRequestRepository and TopupPostingService, in ADR-004 order.
 */
@Injectable()
export class SepaySettlementRepository {
  /**
   * Records a verified webhook event. The integer event id is UNIQUE: a repeat (SePay retries up to 8 times, or a concurrent delivery)
   * inserts nothing and returns false. A concurrent duplicate waits for the first transaction to end, then sees the same row.
   */
  async insertReceived(context: TransactionContext, event: SepayTransferEvent, inboxId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.sepay_transfer_inbox
         (inbox_id, webhook_event_id, gateway, account_number, transfer_type, transfer_amount_vnd, transaction_at, code, content, reference_code,
          state, reason_code, topup_request_id, received_at, processed_at)
       VALUES ($1::uuid, $2::bigint, $3, $4, $5, $6::bigint, $7::timestamptz, $8, $9, $10,
               'RECEIVED', NULL, NULL, date_trunc('milliseconds', clock_timestamp()), NULL)
       ON CONFLICT (webhook_event_id) DO NOTHING`,
      [inboxId, event.webhookEventId.toString(), event.gateway, event.accountNumber, event.transferType, event.transferAmountVnd.toString(), event.transactionAtIso, event.code, event.content, event.referenceCode],
    );
    return result.rowCount === 1;
  }

  /** Sets the outcome of one event. processed_at is the database clock; RECEIVED keeps it empty. */
  async finish(context: TransactionContext, webhookEventId: number, state: InboxState, reasonCode: string | null, topupRequestId: string | null): Promise<void> {
    const result = await context.query(
      `UPDATE app.sepay_transfer_inbox
          SET state = $2::varchar, reason_code = $3::varchar, topup_request_id = $4::uuid,
              processed_at = CASE WHEN $2::varchar = 'RECEIVED' THEN NULL ELSE date_trunc('milliseconds', clock_timestamp()) END
        WHERE webhook_event_id = $1::bigint`,
      [webhookEventId.toString(), state, reasonCode, topupRequestId],
    );
    if (result.rowCount !== 1) {
      throw new Error('SePay inbox row missing for its own event');
    }
  }
}
