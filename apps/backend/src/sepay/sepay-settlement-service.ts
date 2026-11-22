import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, AppErrorCode, TechnicalError } from '../common/app-errors';
import { DriverRepository } from '../driver/driver-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TopupRequestRepository } from '../wallet/topup-request-repository';
import { TopupPostingService } from '../wallet/topup-posting-service';
import { TopupAutoLookupRepository } from '../wallet/topup-auto-lookup-repository';
import { SEPAY_BANK_ID, SepayConfig } from './sepay-config';
import { SepayTransferEvent } from './sepay-event';
import { SepaySettlementRepository, InboxState } from './sepay-settlement-repository';
import { decideTransfer } from './sepay-transfer-rules';

const RESOURCE = 'wallet_topup_request';
const EVENT_CHANGED = 'wallet.topup_request.changed.v1';
const ACTION_CREDITED = 'sepay.wallet_topup.credited.v1';
const ACTOR_ID = 'sepay_webhook';

/**
 * The posting failures that the automatic path turns into an Administrator's queue item instead of a failed event. Each one is raised by the
 * posting path BEFORE it writes a row, so the transaction is still clean when the item is recorded.
 */
const HELD_FOR_ADMIN: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(['BANK_TRANSACTION_ALREADY_RECORDED', 'TOPUP_ACCOUNT_NOT_RECEIVING', 'TOPUP_WALLET_LIMIT_EXCEEDED']);

/**
 * The ONE settlement of a verified SePay transfer (M04 step 1 and step 2). The webhook, the reconciliation job and the recovery of held rows all
 * call it, each event in its own database transaction, so there is exactly one credit decision and one credit writer. The caller owns the
 * transaction; this service never opens one.
 *
 * Order for a new event: the inbox row is recorded (a duplicate by ANY key goes to the recovery check below, otherwise nothing changes); the pure
 * rule decides; then, only when the switch is on AND both credentials are set, the credit goes through TopupPostingService.creditTopup under the
 * locks of ADR-004 3.1. Anything else is kept as evidence with its reason.
 *
 * Bank identity: the credit writes the bank reference itself as canonical_transaction_id, the same key an Administrator types for a manual
 * confirmation. The bank-record unique key therefore refuses a second credit of one bank transfer, from any source, and the evidence row is linked to
 * the request that already holds it (LINKED) instead of being queued.
 */
@Injectable()
export class SepaySettlementService {
  constructor(
    private readonly inbox: SepaySettlementRepository,
    private readonly lookups: TopupAutoLookupRepository,
    private readonly drivers: DriverRepository,
    private readonly posting: TopupPostingService,
    private readonly requests: TopupRequestRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  /**
   * Settles one event. Returns false when the event was already recorded and nothing new was done (a repeat). A repeat of an event that was
   * held only for the switch or a credential is settled now when both are on (the recovery of held rows).
   */
  async settle(context: TransactionContext, event: SepayTransferEvent, config: SepayConfig): Promise<boolean> {
    const inboxId = randomUUID();
    const recorded = await this.inbox.insertReceived(context, event, inboxId);
    if (recorded) {
      await this.#decide(context, inboxId, event, config);
      return true;
    }
    const existing = await this.inbox.findByIdentity(context, event);
    if (existing === undefined) {
      // A unique key collided with a row that the same lookup cannot see: unreachable. Never guess; the transaction rolls back.
      throw new TechnicalError('internal', 'SePay inbox conflict without a matching row');
    }
    return this.recoverOne(context, existing.inboxId, config);
  }

  /**
   * Settles one HELD row (RECEIVED with a recoverable reason) if the switch and both credentials are on now. The row is claimed first, under its
   * own row lock: of two transactions racing for it, the second finds it no longer held and changes nothing. Returns false when nothing was done.
   */
  async recoverOne(context: TransactionContext, inboxId: string, config: SepayConfig): Promise<boolean> {
    if (!config.autoCreditReady) {
      return false;
    }
    const claimed = await this.inbox.claimRecoverable(context, inboxId);
    if (claimed === undefined) {
      return false;
    }
    await this.#decide(context, inboxId, claimed, config);
    return true;
  }

  /** The ids of held rows that may be settled now, oldest first (a read; each one is then claimed by recoverOne in its own transaction). */
  recoverableIds(context: TransactionContext, limit: number): Promise<string[]> {
    return this.inbox.listRecoverable(context, limit);
  }

  /** Decides one recorded event and either finishes it (IGNORED, NEEDS_ADMIN, held as evidence) or credits it. */
  async #decide(context: TransactionContext, inboxId: string, event: SepayTransferEvent, config: SepayConfig): Promise<void> {
    const decision = decideTransfer(event);
    if (decision.kind === 'IGNORED') {
      await this.inbox.finish(context, inboxId, 'IGNORED', decision.reason, null);
      return;
    }
    if (decision.kind === 'NEEDS_ADMIN') {
      await this.inbox.finish(context, inboxId, 'NEEDS_ADMIN', decision.reason, null);
      return;
    }
    if (!config.autoCreditReady) {
      // Recorded as evidence only: nothing is credited while the switch or a credential is missing. recoverOne settles it later.
      await this.inbox.finish(context, inboxId, 'RECEIVED', config.holdReason, null);
      return;
    }
    await this.#credit(context, inboxId, event, decision.transferCode, decision.canonicalTransactionId);
  }

  async #credit(context: TransactionContext, inboxId: string, event: SepayTransferEvent, transferCode: string, canonicalTransactionId: string): Promise<void> {
    const account = await this.lookups.findReceivingAccount(context, SEPAY_BANK_ID, event.accountNumber);
    if (account === undefined || !account.canReceive) {
      return this.#hold(context, inboxId, 'ACCOUNT_NOT_RECEIVING');
    }
    if (await this.lookups.bankRecordExists(context, SEPAY_BANK_ID, account.systemAccountId, canonicalTransactionId)) {
      return this.#alreadyRecorded(context, inboxId, account.systemAccountId, canonicalTransactionId);
    }
    const found = await this.lookups.findRequestByCode(context, transferCode);
    if (found === undefined) {
      return this.#hold(context, inboxId, 'NO_REQUEST_FOR_CODE');
    }
    // ADR-004 3.1 order: the Shipper root, then the wallet, then the request. Decisions are made only after these locks.
    const driver = await this.drivers.lockById(context, found.driverId);
    if (driver === undefined || driver.status !== 'ACTIVE') {
      return this.#hold(context, inboxId, 'DRIVER_NOT_ACTIVE');
    }
    if (!(await this.posting.lockWalletOf(context, found.walletId, found.driverId))) {
      return this.#hold(context, inboxId, 'WALLET_NOT_FOUND');
    }
    const request = await this.requests.lockById(context, found.requestId);
    if (request === undefined || request.walletId !== found.walletId || request.driverId !== found.driverId) {
      return this.#hold(context, inboxId, 'REQUEST_NOT_FOUND');
    }
    if (request.state !== 'PENDING') {
      return this.#hold(context, inboxId, 'REQUEST_NOT_PENDING');
    }
    if (BigInt(event.transferAmountVnd) !== request.amountRequestedVnd) {
      return this.#hold(context, inboxId, 'AMOUNT_MISMATCH');
    }
    try {
      await this.posting.creditTopup(context, {
        walletId: found.walletId,
        driverId: found.driverId,
        requestId: found.requestId,
        bankId: SEPAY_BANK_ID,
        systemAccountId: account.systemAccountId,
        canonicalTransactionId,
        actualAmountVnd: BigInt(event.transferAmountVnd),
        receivedAtIso: event.transactionAtIso,
        settledBy: { kind: 'SEPAY_WEBHOOK' },
      });
    } catch (error) {
      // Only the refusals the posting path raises before its first write are held here; anything else rolls the whole event back.
      if (error instanceof AppError && HELD_FOR_ADMIN.has(error.code)) {
        if (error.code === 'BANK_TRANSACTION_ALREADY_RECORDED') {
          // Another transaction recorded this bank reference first (it is visible now): link the evidence instead of queueing it.
          return this.#alreadyRecorded(context, inboxId, account.systemAccountId, canonicalTransactionId);
        }
        return this.#hold(context, inboxId, error.code);
      }
      throw error;
    }
    const resolved = await this.requests.resolve(context, found.requestId, request.version, 'CONFIRMED', { kind: 'SEPAY_WEBHOOK' });
    if (resolved === undefined) {
      // Locked and checked just above: unreachable. Never guess; the whole transaction rolls back.
      throw new TechnicalError('internal', 'Top-up request changed under its lock');
    }
    await this.audit.append(context, {
      requestId: randomUUID(),
      actorType: 'SYSTEM',
      actorId: ACTOR_ID,
      action: ACTION_CREDITED,
      resourceType: RESOURCE,
      resourceId: found.requestId,
      resourceVersion: resolved.version,
      outcome: 'SUCCESS',
      metadata: {
        actual_amount_vnd: event.transferAmountVnd,
        ...(event.webhookEventId === null ? {} : { webhook_event_id: event.webhookEventId }),
        ...(event.sepayTransactionUuid === null ? {} : { sepay_transaction_uuid: event.sepayTransactionUuid }),
      },
    });
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: found.requestId,
      resourceVersion: resolved.version,
      payload: { request_id: found.requestId, state: resolved.state, version: resolved.version },
    });
    await this.inbox.finish(context, inboxId, 'CREDITED', null, found.requestId);
  }

  /**
   * The bank reference is already recorded on this account (by an earlier automatic credit or by an Administrator). The evidence row is linked to
   * the request that holds that bank record (LINKED). If no request can be named (for example a withdrawal record), it is queued for an Administrator.
   */
  async #alreadyRecorded(context: TransactionContext, inboxId: string, systemAccountId: string, canonicalTransactionId: string): Promise<void> {
    const requestId = await this.lookups.requestIdOfBankRecord(context, SEPAY_BANK_ID, systemAccountId, canonicalTransactionId);
    if (requestId === undefined) {
      return this.#hold(context, inboxId, 'BANK_TRANSACTION_ALREADY_RECORDED');
    }
    await this.inbox.finish(context, inboxId, 'LINKED', 'ALREADY_RECORDED', requestId);
  }

  /** Queues the event for an Administrator with the reason; the inbox row is the evidence. Nothing is credited. */
  async #hold(context: TransactionContext, inboxId: string, reason: string): Promise<void> {
    const state: InboxState = 'NEEDS_ADMIN';
    await this.inbox.finish(context, inboxId, state, reason, null);
  }
}
