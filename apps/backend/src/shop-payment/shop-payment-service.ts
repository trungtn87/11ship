import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { DeliveryActors, ShopCaller } from '../delivery/delivery-actors';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { TopupRequestRepository } from '../wallet/topup-request-repository';
import { OUTBOX_SHOP_PAYMENT_CHANGED, SHOP_PAYMENT_RESOURCE, SHOP_PAYMENT_SCOPE_TYPE } from './shop-payment-constants';
import { ShopPaymentRepository, ShopPaymentRow } from './shop-payment-repository';
import { CreatePaymentInput, encodePaymentCursor, PaymentListQuery } from './shop-payment-validation';

const OPERATION = { create: 'shop.payment_request.create.v1', report: 'shop.payment_request.report.v1', cancel: 'shop.payment_request.cancel.v1' } as const;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * The shop's own payment requests (#198), behind the client session guard. The caller is the authenticated principal only: no shop id, user id or state
 * arrives from a client, and a request of another shop reads as not found. NOTHING here moves money or opens a right:
 *   - create: asks for an amount for a purpose; needs a real receiving account (SYSTEM configures it), takes no amount from a table;
 *   - report ("Tôi đã chuyển khoản"): writes ONE mark and an outbox event. It does not confirm, does not activate the shop and does not grant any right;
 *   - cancel: only while nothing was reported (after a report the money may be on its way, so only the administration resolves it).
 * Each write is ONE transaction opened by the idempotency executor, in the lock order user -> session -> membership -> shop -> request. A shop that is not ACTIVE
 * yet (still INCOMPLETE) or was disabled may still ask and report: paying is how it gets opened, and the M02 guards of the activation stay untouched.
 */
@Injectable()
export class ShopPaymentService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: DeliveryActors,
    private readonly payments: ShopPaymentRepository,
    private readonly accounts: TopupRequestRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async receivingAccounts(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      await this.actors.shopReader(context, principal);
      const accounts = await this.accounts.listReceivingAccounts(context);
      return { accounts: accounts.map((a) => ({ bank_id: a.bankId, account_number: a.accountNumber, account_holder: a.accountHolder })) };
    });
  }

  async list(principal: AuthPrincipal, query: PaymentListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const rows = await this.payments.listForShop(context, shop.shopId, { state: query.state, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return { items: page.map(summary), next_cursor: rows.length > query.limit && last !== undefined ? encodePaymentCursor(last.createdAtMs, last.requestId) : null };
    });
  }

  async read(principal: AuthPrincipal, requestId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const row = await this.payments.findOwned(context, requestId, shop.shopId);
      if (row === undefined) {
        throw new AppError('SHOP_PAYMENT_NOT_FOUND');
      }
      return this.#detail(context, row);
    });
  }

  async create(principal: AuthPrincipal, input: CreatePaymentInput, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SHOP_PAYMENT_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.create,
        idempotencyKey: key,
        logicalRequest: { purpose: input.purpose, amount_vnd: input.amountVnd },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, shop } = await this.actors.shopWriter(context, principal);
        if ((await this.accounts.listReceivingAccounts(context)).length === 0) {
          // A request is only taken when there is a real account to pay to: otherwise the shop could believe an address exists.
          throw new AppError('SHOP_PAYMENT_RECEIVING_ACCOUNT_NOT_CONFIGURED');
        }
        if ((await this.payments.findOpen(context, shop.shopId, input.purpose)) !== undefined) {
          throw new AppError('SHOP_PAYMENT_OPEN_EXISTS');
        }
        const row = await this.payments.insertPending(context, { requestId: randomUUID(), shopId: shop.shopId, purpose: input.purpose, amountVnd: input.amountVnd, createdByUserId: actor.userId });
        await this.#record(context, actor.userId, requestId, OPERATION.create, 'created', row);
        return { status: 201, replayGuard: guard(actor.userId, shop.shopId), payload: summary(row) };
      },
    );
    return outcome.payload as JsonObject;
  }

  async report(principal: AuthPrincipal, paymentId: string, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SHOP_PAYMENT_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.report,
        idempotencyKey: key,
        logicalRequest: { request_id: paymentId },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, shop } = await this.actors.shopWriter(context, principal);
        const current = await this.payments.lockOwned(context, paymentId, shop.shopId);
        if (current === undefined) {
          throw new AppError('SHOP_PAYMENT_NOT_FOUND');
        }
        if (current.state !== 'PENDING') {
          throw new AppError('SHOP_PAYMENT_STATE_CONFLICT');
        }
        if (current.reportedAtMs !== null) {
          // Already reported (another key, another device): the mark is written once; the answer is the same request, nothing new is recorded.
          return { status: 200, replayGuard: guard(actor.userId, shop.shopId), payload: summary(current) };
        }
        const reported = await this.payments.markReported(context, paymentId, actor.userId);
        if (reported === undefined) {
          throw new TechnicalError('internal', 'Payment request changed under its lock');
        }
        await this.#record(context, actor.userId, requestId, OPERATION.report, 'reported', reported);
        return { status: 200, replayGuard: guard(actor.userId, shop.shopId), payload: summary(reported) };
      },
    );
    return outcome.payload as JsonObject;
  }

  async cancel(principal: AuthPrincipal, paymentId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SHOP_PAYMENT_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.cancel,
        idempotencyKey: key,
        logicalRequest: { request_id: paymentId, expected_version: expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, shop } = await this.actors.shopWriter(context, principal);
        const current = await this.payments.lockOwned(context, paymentId, shop.shopId);
        if (current === undefined) {
          throw new AppError('SHOP_PAYMENT_NOT_FOUND');
        }
        if (current.state !== 'PENDING' || current.reportedAtMs !== null) {
          throw new AppError('SHOP_PAYMENT_STATE_CONFLICT');
        }
        if (current.version !== expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const cancelled = await this.payments.cancelPending(context, paymentId, expectedVersion, actor.userId);
        if (cancelled === undefined) {
          throw new TechnicalError('internal', 'Payment request changed under its lock');
        }
        await this.#record(context, actor.userId, requestId, OPERATION.cancel, 'cancelled', cancelled);
        return { status: 200, replayGuard: guard(actor.userId, shop.shopId), payload: summary(cancelled) };
      },
    );
    return outcome.payload as JsonObject;
  }

  /** A replay answers only after the CURRENT session, shop context and ownership are authorized again under the same locks. */
  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, replayGuard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(replayGuard.user_id) || replayGuard.user_id !== principal.userId || !isCanonicalUuid(replayGuard.shop_id)) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        const caller: ShopCaller = await this.actors.shopWriter(context, principal);
        if (caller.shop.shopId !== replayGuard.shop_id) {
          throw new AppError('SHOP_NOT_FOUND');
        }
        return true;
      },
    };
  }

  async #detail(context: TransactionContext, row: ShopPaymentRow): Promise<JsonObject> {
    const settlement = row.state === 'CONFIRMED' ? await this.payments.findSettlement(context, row.requestId) : undefined;
    const grant = await this.payments.grantOfPayment(context, row.requestId);
    return {
      ...summary(row),
      // What was RECEIVED (the administrator's record), never the bank reference or the account.
      received_amount_vnd: settlement === undefined ? null : settlement.amountVnd,
      received_at: settlement === undefined ? null : iso(settlement.receivedAtMs),
      entitlement: grant === undefined ? null : { kind: grant.entitlement, granted_at: iso(grant.atMs) },
      menu_expanded: await this.payments.isGranted(context, row.shopId),
    };
  }

  async #record(context: TransactionContext, actorUserId: string, requestId: string, action: string, change: string, row: ShopPaymentRow): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: actorUserId,
      action,
      resourceType: SHOP_PAYMENT_RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      metadata: { change, state: row.state },
    });
    // The event carries identifiers, the state and the version only: no amount, bank or account.
    await this.outbox.append(context, {
      eventType: OUTBOX_SHOP_PAYMENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: SHOP_PAYMENT_RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      payload: { request_id: row.requestId, shop_id: row.shopId, state: row.state, version: row.version },
    });
  }
}

const guard = (userId: string, shopId: string): JsonObject => ({ user_id: userId, shop_id: shopId });

/** What both sides see of a request (the administration adds its own fields). */
export function summary(row: ShopPaymentRow): JsonObject {
  const awaiting = row.state === 'PENDING' && row.reportedAtMs !== null;
  return {
    request_id: row.requestId,
    purpose: row.purpose,
    amount_requested_vnd: row.amountRequestedVnd,
    state: row.state,
    reject_reason_code: row.rejectReasonCode,
    version: row.version,
    created_at: iso(row.createdAtMs),
    reported_at: row.reportedAtMs === null ? null : iso(row.reportedAtMs),
    resolved_at: row.resolvedAtMs === null ? null : iso(row.resolvedAtMs),
    // "Chờ kiểm tra": reported, not resolved yet. The shop may report while PENDING and not yet reported; it may withdraw only before reporting.
    awaiting_check: awaiting,
    can_report: row.state === 'PENDING' && row.reportedAtMs === null,
    can_cancel: row.state === 'PENDING' && row.reportedAtMs === null,
  };
}

