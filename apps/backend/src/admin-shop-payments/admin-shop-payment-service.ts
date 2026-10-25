import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { PERMISSION_SHOP_ENTITLEMENT_MANAGE, PERMISSION_SHOP_PAYMENT_READ, PERMISSION_SHOP_PAYMENT_RECORD, RequirablePermissionKey } from '../finance-access/finance-access-constants';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { ENTITLEMENT_MENU_EXPANDED, ENTITLEMENT_RESOURCE, FREE_VISIBLE_DISH_LIMIT, OUTBOX_SHOP_ENTITLEMENT_CHANGED, OUTBOX_SHOP_PAYMENT_CHANGED, SHOP_PAYMENT_RESOURCE } from '../shop-payment/shop-payment-constants';
import { EntitlementEvent, SettlementRow, ShopPaymentRepository, ShopPaymentRow } from '../shop-payment/shop-payment-repository';
import { summary } from '../shop-payment/shop-payment-service';
import { encodePaymentCursor } from '../shop-payment/shop-payment-validation';
import { AdminShopReadRepository } from '../admin-shops/admin-shop-read-repository';
import { ShopRepository } from '../shop/shop-repository';
import { BankIdentityGuard } from '../wallet/bank-identity-guard';
import { SystemBankAccountRepository } from '../wallet/system-bank-account-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdminPaymentListQuery, ConfirmInput, EntitlementInput, RejectInput } from './admin-shop-payment-validation';

type Command = 'confirm' | 'reject' | 'grant' | 'revoke';
const OPERATION: Readonly<Record<Command, string>> = {
  confirm: 'admin.shop_payment.confirm.v1',
  reject: 'admin.shop_payment.reject.v1',
  grant: 'admin.shop_entitlement.grant.v1',
  revoke: 'admin.shop_entitlement.revoke.v1',
};
/** A bank time later than the database clock by more than this is a typing error, not a payment. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const HISTORY_LIMIT = 20;
const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * Administration of the payments of SHOPS (#198). Three rights, each its own switch (SYSTEM holds all implicitly; an ADMIN only what SYSTEM granted, asked again
 * UNDER the locks of every call, FOR SHARE on the right's row):
 *   shop.payment.read       — the reconciliation queue and the detail;
 *   shop.payment.record     — record the money RECEIVED (confirm) or refuse the request (reject);
 *   shop.entitlement.manage — grant / revoke the manual dish right of a shop. A separate act: recording money opens nothing.
 *
 * Confirming is ONE transaction opened by the idempotency executor: record -> administrator -> right -> request FOR UPDATE (state, version read again) -> receiving
 * account FOR SHARE -> the bank transaction's advisory lock and a check against every recorded transfer (shop payments AND Shipper top-ups) -> the proof (immutable) ->
 * request CONFIRMED -> audit -> outbox. Two people confirming the same request, or two requests naming the same bank transaction, leave exactly one proof. A confirmation
 * touches no shop, no wallet, no ledger and grants no right. Granting / revoking locks the SHOP row (the same lock every menu write takes), so the dish limit is
 * decided against one consistent right.
 */
@Injectable()
export class AdminShopPaymentService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly access: FinanceAccessParticipant,
    private readonly payments: ShopPaymentRepository,
    private readonly shops: ShopRepository,
    private readonly shopFacts: AdminShopReadRepository,
    private readonly bankIdentity: BankIdentityGuard,
    private readonly systemAccounts: SystemBankAccountRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  // ---- reads -------------------------------------------------------------------------------------------------------------------

  async list(sessionToken: string | undefined, query: AdminPaymentListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, PERMISSION_SHOP_PAYMENT_READ);
      const rows = await this.payments.listForAdmin(context, { state: query.state, reported: query.reported, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const names = await this.#shopNames(context, page.map((r) => r.shopId));
      return {
        items: page.map((r) => ({ ...summary(r), shop: { shop_id: r.shopId, name: names.get(r.shopId) ?? '' } })),
        next_cursor: rows.length > query.limit && last !== undefined ? encodePaymentCursor(last.createdAtMs, last.requestId) : null,
      };
    });
  }

  async detail(sessionToken: string | undefined, requestId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const { locked } = await this.#authorize(context, known, PERMISSION_SHOP_PAYMENT_READ);
      const row = await this.payments.findById(context, requestId);
      if (row === undefined) {
        throw new AppError('SHOP_PAYMENT_NOT_FOUND');
      }
      return this.#detailView(context, row, locked);
    });
  }

  /** The accounts a confirmation can name, MASKED (the same projection as the Shipper top-ups); needs the record right. */
  async receivingAccounts(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, PERMISSION_SHOP_PAYMENT_RECORD);
      const rows = await this.systemAccounts.list(context);
      return { accounts: rows.map((a) => ({ account_id: a.accountId, bank_id: a.bankId, account_number_masked: `****${a.accountNumber.slice(-4)}`, can_receive: a.canReceive })) };
    });
  }

  /** The manual right of one shop: its state, the visible dishes against the limit, and the history of grants / revocations. Needs the queue or the manage right. */
  async entitlements(sessionToken: string | undefined, shopId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const { locked } = await this.#authorizeAny(context, known, [PERMISSION_SHOP_PAYMENT_READ, PERMISSION_SHOP_ENTITLEMENT_MANAGE]);
      const shop = await this.shops.findById(context, shopId);
      if (shop === undefined) {
        throw new AppError('SHOP_NOT_FOUND');
      }
      return { shop: { shop_id: shop.shopId, name: shop.name, status: shop.status }, ...(await this.#standing(context, shopId)), may_manage: await this.access.has(context, locked, PERMISSION_SHOP_ENTITLEMENT_MANAGE) };
    });
  }

  // ---- money received ---------------------------------------------------------------------------------------------------------

  reject(sessionToken: string | undefined, csrfHeader: unknown, requestId: string, input: RejectInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#payment('reject', sessionToken, csrfHeader, requestId, { request_id: requestId, expected_version: input.expectedVersion, reason_code: input.reasonCode }, key, async (context, locked, row) => {
      const after = await this.#resolve(context, row, input.expectedVersion, 'REJECTED', locked, input.reasonCode);
      await this.#record(context, locked, meta.requestId, OPERATION.reject, after, { reason_code: input.reasonCode });
      return after;
    });
  }

  confirm(sessionToken: string | undefined, csrfHeader: unknown, requestId: string, input: ConfirmInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const logical = {
      request_id: requestId,
      expected_version: input.expectedVersion,
      actual_amount_vnd: input.actualAmountVnd,
      bank_id: input.bankId,
      system_owned_account_id: input.systemAccountId,
      canonical_transaction_id: input.canonicalTransactionId,
      received_at: input.receivedAtIso,
    };
    return this.#payment('confirm', sessionToken, csrfHeader, requestId, logical, key, async (context, locked, row, nowMs) => {
      if (input.receivedAtMs > nowMs + FUTURE_TOLERANCE_MS) {
        throw new AppError('ADMIN_INPUT_INVALID');
      }
      const account = await this.bankIdentity.lockReceivingAccount(context, input.systemAccountId);
      if (account === undefined || account.bankId !== input.bankId || !account.canReceive) {
        throw new AppError('TOPUP_ACCOUNT_NOT_RECEIVING');
      }
      // One bank transaction is one payment, ever: under the identity's own lock, so two confirmations (of any kind) cannot both pass.
      if ((await this.bankIdentity.usedByTopup(context, input.bankId, input.systemAccountId, input.canonicalTransactionId)) || (await this.payments.usedBySettlement(context, input.bankId, input.systemAccountId, input.canonicalTransactionId))) {
        throw new AppError('BANK_TRANSACTION_ALREADY_RECORDED');
      }
      await this.payments.insertSettlement(context, {
        settlementId: randomUUID(),
        requestId: row.requestId,
        shopId: row.shopId,
        bankId: input.bankId,
        systemAccountId: input.systemAccountId,
        canonicalTransactionId: input.canonicalTransactionId,
        amountVnd: input.actualAmountVnd,
        receivedAtIso: input.receivedAtIso,
        confirmedByUserId: locked.known.userId,
      });
      // The request becomes CONFIRMED in the same transaction (the database proves the pair again at COMMIT). Nothing else changes: no shop, no right.
      const after = await this.#resolve(context, row, input.expectedVersion, 'CONFIRMED', locked, null);
      await this.#record(context, locked, meta.requestId, OPERATION.confirm, after, { requested_amount_vnd: row.amountRequestedVnd, actual_amount_vnd: input.actualAmountVnd });
      return after;
    });
  }

  #payment(
    command: 'confirm' | 'reject',
    sessionToken: string | undefined,
    csrfHeader: unknown,
    requestId: string,
    logicalRequest: JsonObject,
    idempotencyKey: string | readonly string[] | undefined,
    apply: (context: TransactionContext, locked: LockedActor, row: ShopPaymentRow, nowMs: number) => Promise<ShopPaymentRow>,
  ): Promise<IdempotentOutcome> {
    return this.actor.precheck(sessionToken, { required: true, header: csrfHeader }).then((known) =>
      this.executor.execute(
        {
          scopeType: PROVISIONING_SCOPE_TYPE,
          scopeId: known.userId,
          operationId: OPERATION[command],
          idempotencyKey,
          logicalRequest,
          replay: this.#replay(known, PERMISSION_SHOP_PAYMENT_RECORD),
        },
        async (context) => {
          await setBusinessLockTimeout(context, this.#lockTimeoutMs);
          const { locked, nowMs } = await this.#authorize(context, known, PERMISSION_SHOP_PAYMENT_RECORD);
          const current = await this.payments.lockById(context, requestId);
          if (current === undefined) {
            throw new AppError('SHOP_PAYMENT_NOT_FOUND');
          }
          if (current.state !== 'PENDING') {
            throw new AppError('SHOP_PAYMENT_STATE_CONFLICT');
          }
          if (current.version !== (logicalRequest.expected_version as number)) {
            throw new AppError('VERSION_CONFLICT');
          }
          const after = await apply(context, locked, current, nowMs);
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: await this.#detailView(context, after, locked) };
        },
      ),
    );
  }

  async #resolve(context: TransactionContext, row: ShopPaymentRow, expectedVersion: number, state: 'CONFIRMED' | 'REJECTED', locked: LockedActor, reason: RejectInput['reasonCode'] | null): Promise<ShopPaymentRow> {
    const resolved = await this.payments.resolve(context, row.requestId, expectedVersion, state, locked.known.userId, reason);
    if (resolved === undefined) {
      // Locked and checked just above: unreachable. Never guess; the whole transaction rolls back.
      throw new AppError('SHOP_PAYMENT_STATE_CONFLICT');
    }
    return resolved;
  }

  async #record(context: TransactionContext, locked: LockedActor, requestId: string, action: string, row: ShopPaymentRow, detail: Readonly<Record<string, string | number>>): Promise<void> {
    await this.audit.append(context, {
      requestId,
      actorType: locked.checked.membership.adminRole,
      actorId: locked.known.userId,
      action,
      resourceType: SHOP_PAYMENT_RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      metadata: { state: row.state, shop_id: row.shopId, ...detail },
    });
    await this.outbox.append(context, {
      eventType: OUTBOX_SHOP_PAYMENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: SHOP_PAYMENT_RESOURCE,
      resourceId: row.requestId,
      resourceVersion: row.version,
      payload: { request_id: row.requestId, shop_id: row.shopId, state: row.state, version: row.version },
    });
  }

  // ---- manual entitlement ----------------------------------------------------------------------------------------------------

  grant(sessionToken: string | undefined, csrfHeader: unknown, shopId: string, input: EntitlementInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#entitlement('grant', sessionToken, csrfHeader, shopId, input, key, meta);
  }

  revoke(sessionToken: string | undefined, csrfHeader: unknown, shopId: string, input: EntitlementInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#entitlement('revoke', sessionToken, csrfHeader, shopId, input, key, meta);
  }

  #entitlement(command: 'grant' | 'revoke', sessionToken: string | undefined, csrfHeader: unknown, shopId: string, input: EntitlementInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.actor.precheck(sessionToken, { required: true, header: csrfHeader }).then((known) =>
      this.executor.execute(
        {
          scopeType: PROVISIONING_SCOPE_TYPE,
          scopeId: known.userId,
          operationId: OPERATION[command],
          idempotencyKey: key,
          logicalRequest: { shop_id: shopId, reason: input.reason, payment_request_id: input.paymentRequestId },
          replay: this.#replay(known, PERMISSION_SHOP_ENTITLEMENT_MANAGE),
        },
        async (context) => {
          await setBusinessLockTimeout(context, this.#lockTimeoutMs);
          const { locked } = await this.#authorize(context, known, PERMISSION_SHOP_ENTITLEMENT_MANAGE);
          // The shop row, FOR UPDATE: the lock every menu write of the shop takes, so a dish being added or shown waits for this change and then reads the new right.
          const shop = await this.shops.lockShopForUpdate(context, shopId);
          if (shop === undefined) {
            throw new AppError('SHOP_NOT_FOUND');
          }
          const granted = await this.payments.isGranted(context, shopId);
          if (command === 'grant' ? granted : !granted) {
            throw new AppError('SHOP_ENTITLEMENT_STATE_CONFLICT');
          }
          if (input.paymentRequestId !== null) {
            // A grant may follow ONE confirmed payment of THIS shop, once: the money was recorded by the other button, never assumed here.
            const payment = await this.payments.lockById(context, input.paymentRequestId);
            if (payment === undefined || payment.shopId !== shopId || payment.state !== 'CONFIRMED' || (await this.payments.grantOfPayment(context, payment.requestId)) !== undefined) {
              throw new AppError('SHOP_ENTITLEMENT_PAYMENT_NOT_CONFIRMED');
            }
          }
          const event = await this.payments.insertEntitlement(context, {
            grantId: randomUUID(),
            shopId,
            entitlement: ENTITLEMENT_MENU_EXPANDED,
            action: command === 'grant' ? 'GRANT' : 'REVOKE',
            reason: input.reason,
            actorUserId: known.userId,
            paymentRequestId: input.paymentRequestId,
          });
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: OPERATION[command],
            resourceType: ENTITLEMENT_RESOURCE,
            resourceId: shopId,
            resourceVersion: 1,
            outcome: 'SUCCESS',
            metadata: { entitlement: event.entitlement, action: event.action, reason: input.reason, payment_request_id: input.paymentRequestId ?? 'none' },
          });
          await this.outbox.append(context, {
            eventType: OUTBOX_SHOP_ENTITLEMENT_CHANGED,
            eventSchemaVersion: 1,
            resourceType: ENTITLEMENT_RESOURCE,
            resourceId: shopId,
            resourceVersion: 1,
            payload: { shop_id: shopId, entitlement: event.entitlement, action: event.action, payment_request_id: input.paymentRequestId },
          });
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { shop: { shop_id: shop.shopId, name: shop.name, status: shop.status }, ...(await this.#standing(context, shopId)) } };
        },
      ),
    );
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  async #detailView(context: TransactionContext, row: ShopPaymentRow, locked: LockedActor): Promise<JsonObject> {
    const shop = await this.shops.findById(context, row.shopId);
    const settlement = await this.payments.findSettlement(context, row.requestId);
    const grant = await this.payments.grantOfPayment(context, row.requestId);
    return {
      ...summary(row),
      shop: shop === undefined ? { shop_id: row.shopId, name: '', status: '' } : { shop_id: shop.shopId, name: shop.name, status: shop.status },
      settlement: settlement === undefined ? null : settlementView(settlement),
      entitlement: grant === undefined ? null : eventView(grant),
      ...(await this.#standing(context, row.shopId)),
      // What THIS administrator may do now: a hint for the buttons. Every command asks the server again.
      may_record: await this.access.has(context, locked, PERMISSION_SHOP_PAYMENT_RECORD),
      may_manage: await this.access.has(context, locked, PERMISSION_SHOP_ENTITLEMENT_MANAGE),
    };
  }

  async #standing(context: TransactionContext, shopId: string): Promise<JsonObject> {
    const latest = await this.payments.latestEntitlement(context, shopId);
    const expanded = latest?.action === 'GRANT';
    const visible = await this.shopFacts.countVisibleDishes(context, shopId);
    return {
      menu_expanded: expanded,
      menu_expanded_since: expanded && latest !== undefined ? iso(latest.atMs) : null,
      visible_count: visible,
      visible_limit: expanded ? null : FREE_VISIBLE_DISH_LIMIT,
      // After a revocation a shop may still show more than the limit: nothing is hidden for it; it cannot add or show another until it is back under.
      over_limit: !expanded && visible > FREE_VISIBLE_DISH_LIMIT,
      entitlement_history: (await this.payments.entitlementHistory(context, shopId, HISTORY_LIMIT)).map(eventView),
    };
  }

  async #shopNames(context: TransactionContext, shopIds: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of new Set(shopIds)) {
      const shop = await this.shops.findById(context, id);
      if (shop !== undefined) {
        names.set(id, shop.name);
      }
    }
    return names;
  }

  /** A replay answers only after the administrator, the session and the right were checked again, and never writes. */
  #replay(known: SessionLookup, permission: RequirablePermissionKey) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, replayGuard: JsonObject): Promise<true> => {
        if (replayGuard.actor_user_id !== known.userId) {
          throw new AppError('ADMIN_SESSION_INVALID');
        }
        await this.#authorize(context, known, permission);
        return true;
      },
    };
  }

  /** The administrator under the module's locks, the database clock read after them, then the right asked again (FOR SHARE). */
  async #authorize(context: TransactionContext, known: SessionLookup, permission: RequirablePermissionKey): Promise<{ locked: LockedActor; nowMs: number }> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    await this.access.require(context, locked, permission, nowMs);
    return { locked, nowMs };
  }

  /** Any of the rights opens a read (the shop's standing helps whoever may act on it). Refused only when none is held. */
  async #authorizeAny(context: TransactionContext, known: SessionLookup, permissions: readonly RequirablePermissionKey[]): Promise<{ locked: LockedActor; nowMs: number }> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    let first: unknown;
    for (const permission of permissions) {
      try {
        await this.access.require(context, locked, permission, nowMs);
        return { locked, nowMs };
      } catch (error) {
        first ??= error;
      }
    }
    throw first ?? new TechnicalError('internal', 'No permission to check');
  }
}

function settlementView(s: SettlementRow): JsonObject {
  return {
    settlement_id: s.settlementId,
    bank_id: s.bankId,
    system_account_id: s.systemAccountId,
    canonical_transaction_id: s.canonicalTransactionId,
    amount_vnd: s.amountVnd,
    received_at: iso(s.receivedAtMs),
    confirmed_by: s.confirmedByUserId,
    recorded_at: iso(s.createdAtMs),
  };
}

function eventView(e: EntitlementEvent): JsonObject {
  return { grant_id: e.grantId, entitlement: e.entitlement, action: e.action, reason: e.reason, actor_user_id: e.actorUserId, payment_request_id: e.paymentRequestId, at: iso(e.atMs) };
}
