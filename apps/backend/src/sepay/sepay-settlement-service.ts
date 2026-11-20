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
import { SepaySettlementRepository } from './sepay-settlement-repository';
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
 * The ONE settlement of a verified SePay transfer (M04 step 1 and step 2). Both the webhook and the reconciliation job call it, each event in
 * its own database transaction, so there is exactly one credit decision and one credit writer. The caller owns the transaction; this service
 * never opens one. Order: the inbox row is recorded (any duplicate key -> nothing else happens); then the pure rule decides; then, when every
 * database check holds and the switch is on, the credit goes through TopupPostingService.creditTopup under the locks of ADR-004 3.1.
 * The credit is never decided from the amount and the time alone: the transfer code, the exact amount, the receiving account, an ACTIVE
 * driver, a PENDING request and the absence of an earlier bank record must all hold.
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

  /** Returns false when the event was already recorded (any source): nothing is changed. */
  async settle(context: TransactionContext, event: SepayTransferEvent, config: SepayConfig): Promise<boolean> {
    const inboxId = randomUUID();
    const recorded = await this.inbox.insertReceived(context, event, inboxId);
    if (!recorded) {
      // A repeat of an event already recorded (any state, any source): answer success, change nothing.
      return false;
    }
    const decision = decideTransfer(event);
    if (decision.kind === 'IGNORED') {
      await this.inbox.finish(context, inboxId, 'IGNORED', decision.reason, null);
      return true;
    }
    if (decision.kind === 'NEEDS_ADMIN') {
      await this.inbox.finish(context, inboxId, 'NEEDS_ADMIN', decision.reason, null);
      return true;
    }
    if (!config.autoTopupEnabled) {
      // Recorded as evidence only: nothing is credited while the switch is off.
      await this.inbox.finish(context, inboxId, 'RECEIVED', 'AUTO_TOPUP_DISABLED', null);
      return true;
    }
    await this.#credit(context, inboxId, event, decision.transferCode, decision.canonicalTransactionId);
    return true;
  }

  async #credit(context: TransactionContext, inboxId: string, event: SepayTransferEvent, transferCode: string, canonicalTransactionId: string): Promise<void> {
    const account = await this.lookups.findReceivingAccount(context, SEPAY_BANK_ID, event.accountNumber);
    if (account === undefined || !account.canReceive) {
      return this.#hold(context, inboxId, 'ACCOUNT_NOT_RECEIVING');
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
    if (await this.lookups.bankRecordExists(context, SEPAY_BANK_ID, account.systemAccountId, canonicalTransactionId)) {
      return this.#hold(context, inboxId, 'BANK_TRANSACTION_ALREADY_RECORDED');
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

  /** Queues the event for an Administrator with the reason; the inbox row is the evidence. Nothing is credited. */
  async #hold(context: TransactionContext, inboxId: string, reason: string): Promise<void> {
    await this.inbox.finish(context, inboxId, 'NEEDS_ADMIN', reason, null);
  }
}
