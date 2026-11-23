import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { SepayTransferEvent } from './sepay-event';

export type InboxState = 'RECEIVED' | 'CREDITED' | 'NEEDS_ADMIN' | 'IGNORED' | 'LINKED';

/** The hold reasons that a later settlement may still pick up (the switch or a credential was off when the transfer arrived). */
export const RECOVERABLE_HOLD_REASONS: readonly string[] = ['AUTO_TOPUP_DISABLED', 'AUTO_TOPUP_NOT_CONFIGURED'];

/** An existing inbox row that carries the same event, by any of its keys. */
export interface InboxRowByIdentity {
  readonly inboxId: string;
  readonly state: InboxState;
  readonly reason: string | null;
}

/** One row of the Administrator's queue (NEEDS_ADMIN). The account is masked to its last four digits; the content is the bank text. */
export interface InboxQueueRow {
  readonly inboxId: string;
  readonly receivedAtMs: number;
  readonly transactionAtIso: string;
  readonly gateway: string;
  readonly accountLast4: string;
  readonly transferAmountVnd: number;
  readonly code: string | null;
  readonly referenceCode: string;
  readonly reason: string | null;
  readonly content: string;
}

interface InboxEventRow {
  webhook_event_id: string | null;
  sepay_transaction_uuid: string | null;
  gateway: string;
  account_number: string;
  transfer_type: 'in' | 'out';
  transfer_amount_vnd: string;
  transaction_text: string;
  transaction_at_iso: string;
  code: string | null;
  content: string;
  reference_code: string;
}

interface QueueDbRow {
  inbox_id: string;
  received_ms: string;
  transaction_at_iso: string;
  gateway: string;
  account_last4: string;
  transfer_amount_vnd: string;
  code: string | null;
  reference_code: string;
  reason_code: string | null;
  content: string;
}

/**
 * SQL of the SePay inbox only (sepay_transfer_inbox). Lookups on wallet tables are in wallet/topup-auto-lookup-repository.ts (package rule), and the
 * locks and the credit are the existing DriverRepository, TopupRequestRepository and TopupPostingService, in ADR-004 order.
 *
 * The runtime role has SELECT, INSERT and UPDATE on this table and nothing else. Every change below is an UPDATE guarded by the state it expects,
 * so two transactions that race on one row serialize on the row lock and the later one changes nothing (no FOR UPDATE, no LOCK TABLE).
 */
@Injectable()
export class SepaySettlementRepository {
  /**
   * Records a verified event. ANY unique key of the inbox is a duplicate: the webhook id, the transactions-API UUID, or the bank identity (the
   * same transfer seen by the webhook and by a reconciliation read). A duplicate inserts nothing and returns false. A concurrent duplicate waits
   * for the first transaction to end, then conflicts the same way.
   */
  async insertReceived(context: TransactionContext, event: SepayTransferEvent, inboxId: string): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.sepay_transfer_inbox
         (inbox_id, webhook_event_id, sepay_transaction_uuid, gateway, account_number, transfer_type, transfer_amount_vnd, transaction_at,
          code, content, reference_code, state, reason_code, topup_request_id, received_at, processed_at)
       VALUES ($1::uuid, $2::bigint, $3::uuid, $4, $5, $6, $7::bigint, $8::timestamptz, $9, $10, $11,
               'RECEIVED', NULL, NULL, date_trunc('milliseconds', clock_timestamp()), NULL)
       ON CONFLICT DO NOTHING`,
      [
        inboxId,
        event.webhookEventId === null ? null : event.webhookEventId.toString(),
        event.sepayTransactionUuid,
        event.gateway,
        event.accountNumber,
        event.transferType,
        event.transferAmountVnd.toString(),
        event.transactionAtIso,
        event.code,
        event.content,
        event.referenceCode,
      ],
    );
    return result.rowCount === 1;
  }

  /** The row that already holds this event, found by its webhook id, its transactions-API UUID or its bank identity. No lock. */
  async findByIdentity(context: TransactionContext, event: SepayTransferEvent): Promise<InboxRowByIdentity | undefined> {
    const result = await context.query<{ inbox_id: string; state: InboxState; reason_code: string | null }>(
      `SELECT inbox_id::text AS inbox_id, state, reason_code FROM app.sepay_transfer_inbox
        WHERE ($1::bigint IS NOT NULL AND webhook_event_id = $1::bigint)
           OR ($2::uuid IS NOT NULL AND sepay_transaction_uuid = $2::uuid)
           OR (reference_code <> '' AND account_number = $3 AND reference_code = $4 AND transfer_amount_vnd = $5::bigint AND transaction_at = $6::timestamptz)
        ORDER BY received_at LIMIT 1`,
      [
        event.webhookEventId === null ? null : event.webhookEventId.toString(),
        event.sepayTransactionUuid,
        event.accountNumber,
        event.referenceCode,
        event.transferAmountVnd.toString(),
        event.transactionAtIso,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { inboxId: row.inbox_id, state: row.state, reason: row.reason_code };
  }

  /** Recorded rows that were held only because the switch or a credential was off, oldest first. A read: each one is claimed on its own. */
  async listRecoverable(context: TransactionContext, limit: number): Promise<string[]> {
    const result = await context.query<{ inbox_id: string }>(
      `SELECT inbox_id::text AS inbox_id FROM app.sepay_transfer_inbox
        WHERE state = 'RECEIVED' AND reason_code = ANY($1::text[])
        ORDER BY received_at, inbox_id LIMIT $2::int`,
      [RECOVERABLE_HOLD_REASONS as string[], limit],
    );
    return result.rows.map((row) => row.inbox_id);
  }

  /**
   * CLAIMS one held row for a new settlement. The UPDATE only matches while the row is still a held RECEIVED row, so of two transactions that race
   * for it, the second waits for the first to end and then matches nothing. Returns the event as recorded, or undefined when the row is not held
   * any more (already settled by someone else). The caller must settle it in the same transaction.
   */
  async claimRecoverable(context: TransactionContext, inboxId: string): Promise<SepayTransferEvent | undefined> {
    const result = await context.query<InboxEventRow>(
      `UPDATE app.sepay_transfer_inbox SET state = 'RECEIVED'
        WHERE inbox_id = $1::uuid AND state = 'RECEIVED' AND reason_code = ANY($2::text[])
        RETURNING webhook_event_id::text AS webhook_event_id, sepay_transaction_uuid::text AS sepay_transaction_uuid, gateway, account_number,
                  transfer_type, transfer_amount_vnd::text AS transfer_amount_vnd,
                  to_char(transaction_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS transaction_text,
                  to_char(transaction_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS transaction_at_iso,
                  code, content, reference_code`,
      [inboxId, RECOVERABLE_HOLD_REASONS as string[]],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : toEvent(row);
  }

  /** Sets the outcome of one recorded event, by its inbox id. processed_at is the database clock; RECEIVED keeps it empty. */
  async finish(context: TransactionContext, inboxId: string, state: InboxState, reasonCode: string | null, topupRequestId: string | null): Promise<void> {
    const result = await context.query(
      `UPDATE app.sepay_transfer_inbox
          SET state = $2::varchar, reason_code = $3::varchar, topup_request_id = $4::uuid,
              processed_at = CASE WHEN $2::varchar = 'RECEIVED' THEN NULL ELSE date_trunc('milliseconds', clock_timestamp()) END
        WHERE inbox_id = $1::uuid`,
      [inboxId, state, reasonCode, topupRequestId],
    );
    if (result.rowCount !== 1) {
      throw new Error('SePay inbox row missing for its own event');
    }
  }

  /**
   * The Administrator confirmed a manual top-up whose bank reference is already in the inbox for the same receiving account and the same amount.
   * That evidence row is linked to the request (LINKED): it is no longer a queue item and no automatic credit can happen for it. A row that is
   * already final is left alone. Returns the number of rows linked.
   */
  async linkManualConfirmation(context: TransactionContext, input: { accountNumber: string; referenceCode: string; amountVnd: bigint; requestId: string }): Promise<number> {
    const result = await context.query(
      `UPDATE app.sepay_transfer_inbox i
          SET state = 'LINKED', reason_code = 'ADMIN_CONFIRMED', topup_request_id = $4::uuid,
              processed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE i.state IN ('RECEIVED', 'NEEDS_ADMIN') AND i.reference_code = $2 AND i.transfer_amount_vnd = $3::bigint
          AND i.account_number = $1`,
      [input.accountNumber, input.referenceCode, input.amountVnd.toString(), input.requestId],
    );
    return result.rowCount ?? 0;
  }

  /** The Administrator's queue: held transfers that need a decision, oldest first. Read only. */
  async listNeedsAdmin(context: TransactionContext, limit: number): Promise<InboxQueueRow[]> {
    const result = await context.query<QueueDbRow>(
      `SELECT inbox_id::text AS inbox_id, (extract(epoch FROM received_at) * 1000)::bigint::text AS received_ms,
              to_char(transaction_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS transaction_at_iso,
              gateway, right(account_number, 4) AS account_last4, transfer_amount_vnd::text AS transfer_amount_vnd, code, reference_code, reason_code, content
         FROM app.sepay_transfer_inbox WHERE state = 'NEEDS_ADMIN'
         ORDER BY received_at, inbox_id LIMIT $1::int`,
      [limit],
    );
    return result.rows.map((row) => ({
      inboxId: row.inbox_id,
      receivedAtMs: Number(row.received_ms),
      transactionAtIso: row.transaction_at_iso,
      gateway: row.gateway,
      accountLast4: row.account_last4,
      transferAmountVnd: Number(row.transfer_amount_vnd),
      code: row.code,
      referenceCode: row.reference_code,
      reason: row.reason_code,
      content: row.content,
    }));
  }

  /**
   * The Administrator closes a queue item that is not a Shipper top-up (for example money from another customer). Only a NEEDS_ADMIN row can be
   * closed, and only once. Returns the reason the row had before (for the audit trail), or undefined when it is not in the queue any more.
   */
  async dismissNeedsAdmin(context: TransactionContext, inboxId: string, reasonCode: string): Promise<{ previousReason: string | null } | undefined> {
    const before = await context.query<{ reason_code: string | null }>(
      `SELECT reason_code FROM app.sepay_transfer_inbox WHERE inbox_id = $1::uuid AND state = 'NEEDS_ADMIN'`,
      [inboxId],
    );
    const previous = before.rows[0];
    if (previous === undefined) {
      return undefined;
    }
    const result = await context.query(
      `UPDATE app.sepay_transfer_inbox SET state = 'IGNORED', reason_code = $2::varchar, processed_at = date_trunc('milliseconds', clock_timestamp())
        WHERE inbox_id = $1::uuid AND state = 'NEEDS_ADMIN'`,
      [inboxId, reasonCode],
    );
    return result.rowCount === 1 ? { previousReason: previous.reason_code } : undefined;
  }
}

function toEvent(row: InboxEventRow): SepayTransferEvent {
  return {
    webhookEventId: row.webhook_event_id === null ? null : Number(row.webhook_event_id),
    sepayTransactionUuid: row.sepay_transaction_uuid,
    gateway: row.gateway,
    transactionAtIso: row.transaction_at_iso,
    transactionDateText: row.transaction_text,
    accountNumber: row.account_number,
    code: row.code,
    content: row.content,
    transferType: row.transfer_type,
    transferAmountVnd: Number(row.transfer_amount_vnd),
    referenceCode: row.reference_code,
  };
}
