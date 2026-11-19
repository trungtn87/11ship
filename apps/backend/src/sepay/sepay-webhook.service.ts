import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, AppErrorCode, TechnicalError } from '../common/app-errors';
import { DriverRepository } from '../driver/driver-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { TopupRequestRepository } from '../wallet/topup-request-repository';
import { TopupPostingService } from '../wallet/topup-posting-service';
import { TopupAutoLookupRepository } from '../wallet/topup-auto-lookup-repository';
import { readSepayConfig, SEPAY_BANK_ID, SepayConfig } from './sepay-config';
import { parseSepayEvent, SepayTransferEvent } from './sepay-event';
import { SepaySettlementRepository } from './sepay-settlement-repository';
import { decideTransfer } from './sepay-transfer-rules';
import { verifySepaySignature } from './sepay-signature';

const RESOURCE = 'wallet_topup_request';
const EVENT_CHANGED = 'wallet.topup_request.changed.v1';
const ACTION_CREDITED = 'sepay.wallet_topup.credited.v1';
const ACTOR_ID = 'sepay_webhook';

/**
 * The posting failures that the automatic path turns into an Administrator's queue item instead of a failed webhook. Each one is raised by the
 * posting path BEFORE it writes a row, so the transaction is still clean when the item is recorded.
 */
const HELD_FOR_ADMIN: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>(['BANK_TRANSACTION_ALREADY_RECORDED', 'TOPUP_ACCOUNT_NOT_RECEIVING', 'TOPUP_WALLET_LIMIT_EXCEEDED']);

export interface WebhookResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/**
 * SePay transaction webhook (M04 step 1). Order of work, all decided on the server:
 *   1. configuration (fail closed: no secret or a wrong prefix -> 503, nothing stored);
 *   2. HMAC-SHA256 over the raw body and the timestamp, constant-time, five-minute window (401 / 400, nothing stored);
 *   3. strict payload validation (400, nothing stored);
 *   4. ONE database transaction: the event is recorded in the inbox (duplicate -> success, nothing else), then either classified for an
 *      Administrator, or, when every rule holds and the flag is on, credited through the SAME posting path as a manual confirmation, with the
 *      request resolved CONFIRMED by the SePay settler and an audit row and an outbox event.
 *   5. 200 {"success": true} only after that transaction commits. An error in step 4 rolls the whole thing back and SePay retries.
 * The credit is never decided from the amount and the time alone: the transfer code, the exact amount, the receiving account, an ACTIVE
 * driver, a PENDING request and the absence of an earlier bank record must all hold, under the locks of ADR-004 3.1 (driver, wallet, request).
 */
@Injectable()
export class SepayWebhookService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly inbox: SepaySettlementRepository,
    private readonly lookups: TopupAutoLookupRepository,
    private readonly drivers: DriverRepository,
    private readonly posting: TopupPostingService,
    private readonly requests: TopupRequestRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async receive(input: { readonly rawBody: Buffer; readonly timestampHeader: unknown; readonly signatureHeader: unknown; readonly nowSeconds: number; readonly env: NodeJS.ProcessEnv }): Promise<WebhookResponse> {
    const config = readSepayConfig(input.env);
    if (config.webhookSecret === null || config.misconfiguration !== null) {
      return { status: 503, body: { success: false, error: 'SEPAY_NOT_CONFIGURED' } };
    }
    const verdict = verifySepaySignature({ secret: config.webhookSecret, timestampHeader: input.timestampHeader, signatureHeader: input.signatureHeader, rawBody: input.rawBody, nowSeconds: input.nowSeconds });
    if (verdict === 'MISSING_HEADERS' || verdict === 'BAD_SIGNATURE') {
      return { status: 401, body: { success: false, error: 'SIGNATURE_INVALID' } };
    }
    if (verdict === 'BAD_TIMESTAMP' || verdict === 'EXPIRED') {
      return { status: 400, body: { success: false, error: 'TIMESTAMP_OUT_OF_WINDOW' } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody.toString('utf8')) as unknown;
    } catch {
      return { status: 400, body: { success: false, error: 'BODY_INVALID' } };
    }
    const event = parseSepayEvent(parsed);
    if (event === undefined) {
      return { status: 400, body: { success: false, error: 'PAYLOAD_INVALID' } };
    }
    await this.transactions.withTransaction((context) => this.#settle(context, event, config));
    return { status: 200, body: { success: true } };
  }

  async #settle(context: TransactionContext, event: SepayTransferEvent, config: SepayConfig): Promise<void> {
    const recorded = await this.inbox.insertReceived(context, event, randomUUID());
    if (!recorded) {
      // A repeat of an event already recorded (any state): answer success, change nothing.
      return;
    }
    const decision = decideTransfer(event);
    if (decision.kind === 'IGNORED') {
      await this.inbox.finish(context, event.webhookEventId, 'IGNORED', decision.reason, null);
      return;
    }
    if (decision.kind === 'NEEDS_ADMIN') {
      await this.inbox.finish(context, event.webhookEventId, 'NEEDS_ADMIN', decision.reason, null);
      return;
    }
    if (!config.autoTopupEnabled) {
      // Recorded as evidence only: nothing is credited while the switch is off.
      await this.inbox.finish(context, event.webhookEventId, 'RECEIVED', 'AUTO_TOPUP_DISABLED', null);
      return;
    }
    await this.#credit(context, event, decision.transferCode, decision.canonicalTransactionId);
  }

  async #credit(context: TransactionContext, event: SepayTransferEvent, transferCode: string, canonicalTransactionId: string): Promise<void> {
    const account = await this.lookups.findReceivingAccount(context, SEPAY_BANK_ID, event.accountNumber);
    if (account === undefined || !account.canReceive) {
      return this.#hold(context, event, 'ACCOUNT_NOT_RECEIVING');
    }
    const found = await this.lookups.findRequestByCode(context, transferCode);
    if (found === undefined) {
      return this.#hold(context, event, 'NO_REQUEST_FOR_CODE');
    }
    // ADR-004 3.1 order: the Shipper root, then the wallet, then the request. Decisions are made only after these locks.
    const driver = await this.drivers.lockById(context, found.driverId);
    if (driver === undefined || driver.status !== 'ACTIVE') {
      return this.#hold(context, event, 'DRIVER_NOT_ACTIVE');
    }
    if (!(await this.posting.lockWalletOf(context, found.walletId, found.driverId))) {
      return this.#hold(context, event, 'WALLET_NOT_FOUND');
    }
    const request = await this.requests.lockById(context, found.requestId);
    if (request === undefined || request.walletId !== found.walletId || request.driverId !== found.driverId) {
      return this.#hold(context, event, 'REQUEST_NOT_FOUND');
    }
    if (request.state !== 'PENDING') {
      return this.#hold(context, event, 'REQUEST_NOT_PENDING');
    }
    if (BigInt(event.transferAmountVnd) !== request.amountRequestedVnd) {
      return this.#hold(context, event, 'AMOUNT_MISMATCH');
    }
    if (await this.lookups.bankRecordExists(context, SEPAY_BANK_ID, account.systemAccountId, canonicalTransactionId)) {
      return this.#hold(context, event, 'BANK_TRANSACTION_ALREADY_RECORDED');
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
        return this.#hold(context, event, error.code);
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
      metadata: { webhook_event_id: event.webhookEventId, actual_amount_vnd: event.transferAmountVnd },
    });
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: found.requestId,
      resourceVersion: resolved.version,
      payload: { request_id: found.requestId, state: resolved.state, version: resolved.version },
    });
    await this.inbox.finish(context, event.webhookEventId, 'CREDITED', null, found.requestId);
  }

  /** Queues the event for an Administrator with the reason; the inbox row is the evidence. Nothing is credited. */
  async #hold(context: TransactionContext, event: SepayTransferEvent, reason: string): Promise<void> {
    await this.inbox.finish(context, event.webhookEventId, 'NEEDS_ADMIN', reason, null);
  }
}
