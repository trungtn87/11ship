import { ShipperSettlementReader } from '../shipper-settlement/shipper-settlement-reader';
import { WalletReadRepository } from '../wallet/wallet-read-repository';
import { AccountActivityRegistry } from '../account-lifecycle/account-activity-registry';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../audit/audit-writer';
import { AuthPrincipal } from '../auth/auth-principal';
import { ClientActor } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { ShipperWalletParametersReader } from '../driver/shipper-wallet-parameters';
import { IdempotencyExecutor, JsonObject } from '../idempotency/idempotency-executor';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { WalletService } from '../wallet/wallet-service';
import { WithdrawalMoneyService } from '../wallet/withdrawal-money-service';
import { WithdrawalEventKind, WithdrawalRepository, WithdrawalRow } from '../wallet/withdrawal-repository';
import { DriverWalletAccess } from './driver-wallet-access';
import { encodeWithdrawalCursor, safeJsonNumber, WithdrawalListQuery } from './driver-wallet-validation';
import { maskAccount } from './driver-wallet-service';

const SCOPE_TYPE = 'user';
const RESOURCE = 'wallet_withdrawal';
const EVENT_CHANGED = 'wallet.withdrawal.changed.v1';
const OPERATION = { create: 'wallet.withdrawal.create.v1', cancel: 'wallet.withdrawal.cancel.v1' } as const;

/** What a person can quote to the support desk: the first eight hex digits of the id, upper-case. Derived, never stored, never a secret. */
export function requestCodeOf(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * The Shipper's own WITHDRAWAL requests (M04-C). A request asks for money to be paid out by hand; this service never debits the wallet: it reserves the amount (a
 * WITHDRAWAL hold, held += amount, balance unchanged) when the request is made and gives it back when the Shipper cancels a PENDING one. The debit happens only
 * when an administrator records the manual transfer as PAID (admin-withdrawal-service). The caller is the authenticated principal only. Each write is ONE transaction
 * opened by the idempotency executor, in the lock order of ADR-004 3.1: record -> user row -> CURRENT session row -> driver row FOR UPDATE -> wallet FOR UPDATE ->
 * withdrawal -> hold -> audit -> outbox -> the executor's record. A replay answers only after the CURRENT session, role and profile are authorized again.
 */
@Injectable()
export class DriverWithdrawalService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly access: DriverWalletAccess,
    private readonly wallets: WalletService,
    private readonly money: WithdrawalMoneyService,
    private readonly withdrawals: WithdrawalRepository,
    private readonly limits: ShipperWalletParametersReader,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly activity: AccountActivityRegistry,
    private readonly reads: WalletReadRepository,
    private readonly settlement: ShipperSettlementReader,
  ) {}

  async list(principal: AuthPrincipal, query: WithdrawalListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { driver } = await this.access.reader(context, principal);
      const wallet = await this.wallets.readWallet(context, driver.driverId);
      if (!wallet.provisioned) {
        return { items: [], next_cursor: null };
      }
      const rows = await this.withdrawals.listForWallet(context, wallet.walletId, { state: query.state, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return { items: page.map(view), next_cursor: rows.length > query.limit && last !== undefined ? encodeWithdrawalCursor(last.createdAtMs, last.withdrawalId) : null };
    });
  }

  async read(principal: AuthPrincipal, withdrawalId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { driver } = await this.access.reader(context, principal);
      const row = await this.withdrawals.findOwned(context, withdrawalId, driver.driverId);
      if (row === undefined) {
        throw new AppError('WITHDRAWAL_NOT_FOUND');
      }
      return view(row);
    });
  }

  async create(principal: AuthPrincipal, amountVnd: number, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      { scopeType: SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATION.create, idempotencyKey: key, logicalRequest: { amount_vnd: amountVnd }, replay: this.#replay(principal) },
      async (context) => {
        const { actor, driver } = await this.access.writer(context, principal);
        // The minimum is read from the database at this moment; a request made before a change keeps the amount it was made with.
        const limits = await this.limits.limits(context);
        if (driver.status !== 'CLOSING' && amountVnd < limits.withdrawMinVnd) {
          throw new AppError('WITHDRAWAL_AMOUNT_BELOW_MINIMUM');
        }
        const wallet = await this.money.lockWalletOfDriver(context, driver.driverId);
        if (wallet === undefined) {
          // No wallet means no money: nothing is created for a withdrawal.
          throw new AppError('WITHDRAWAL_INSUFFICIENT_AVAILABLE');
        }
        if (driver.status === 'CLOSING') {
          const obligations = await this.settlement.obligations(context, driver.driverId);
          if (obligations.activeWork) throw new AppError('DRIVER_HAS_ACTIVE_WORK');
          if (obligations.pendingFinance) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
          if ((await this.activity.activeWork(context, driver.userId)).length > 0) throw new AppError('DRIVER_HAS_ACTIVE_WORK');
          const pending = await this.reads.pendingTopupCount(context, wallet.walletId);
          if (pending > 0 || wallet.heldVnd !== 0n) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
          if (BigInt(amountVnd) !== wallet.balanceVnd) throw new AppError('WITHDRAWAL_INSUFFICIENT_AVAILABLE');
        }
        const row = await this.money.reserve(context, wallet, { driverId: driver.driverId, amountVnd: BigInt(amountVnd), createdByUserId: actor.userId });
        await this.#record(context, actor, requestId, OPERATION.create, 'created', 'CREATED', null, row, null);
        return { status: 201, replayGuard: { user_id: actor.userId }, payload: view(row) };
      },
    );
    return outcome.payload as JsonObject;
  }

  async cancel(principal: AuthPrincipal, withdrawalId: string, expectedVersion: number, key: string | readonly string[] | undefined, requestId: string): Promise<JsonObject> {
    const outcome = await this.executor.execute(
      {
        scopeType: SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATION.cancel,
        idempotencyKey: key,
        logicalRequest: { withdrawal_id: withdrawalId, expected_version: expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const { actor, driver } = await this.access.writer(context, principal);
        // ADR-004 3.1: the Shipper root, then the wallet, then the withdrawal (the source row).
        if ((await this.money.lockWalletOfDriver(context, driver.driverId)) === undefined) {
          throw new AppError('WITHDRAWAL_NOT_FOUND');
        }
        const current = await this.withdrawals.lockOwned(context, withdrawalId, driver.driverId);
        if (current === undefined) {
          throw new AppError('WITHDRAWAL_NOT_FOUND');
        }
        if (current.state !== 'PENDING') {
          throw new AppError('WITHDRAWAL_STATE_CONFLICT');
        }
        if (current.version !== expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        await this.money.release(context, current);
        const cancelled = await this.withdrawals.cancelByShipper(context, withdrawalId, expectedVersion, actor.userId);
        if (cancelled === undefined) {
          // Locked and checked just above: unreachable. Never guess; the whole transaction rolls back.
          throw new TechnicalError('internal', 'Withdrawal changed under its lock');
        }
        await this.#record(context, actor, requestId, OPERATION.cancel, 'cancelled', 'CANCELLED', 'PENDING', cancelled, null);
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: view(cancelled) };
      },
    );
    return outcome.payload as JsonObject;
  }

  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        await this.access.writer(context, principal);
        return true;
      },
    };
  }

  async #record(
    context: TransactionContext,
    actor: ClientActor,
    requestId: string,
    action: string,
    change: string,
    kind: WithdrawalEventKind,
    fromState: WithdrawalRow['state'] | null,
    row: WithdrawalRow,
    reasonCode: string | null,
  ): Promise<void> {
    await this.withdrawals.insertEvent(context, { eventId: randomUUID(), withdrawalId: row.withdrawalId, kind, fromState, toState: row.state, actorUserId: actor.userId, reasonCode, version: row.version });
    await this.audit.append(context, {
      requestId,
      actorType: 'USER',
      actorId: actor.userId,
      action,
      resourceType: RESOURCE,
      resourceId: row.withdrawalId,
      resourceVersion: row.version,
      outcome: 'SUCCESS',
      // The amount is money data the audit allowlist carries; no bank, account number or holder name ever.
      metadata: { change, state: row.state, amount_vnd: safeJsonNumber(row.amountVnd) },
    });
    // The event carries the identifier, the state and the version only: no amount owner, bank, phone, note or picture.
    await this.outbox.append(context, {
      eventType: EVENT_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: row.withdrawalId,
      resourceVersion: row.version,
      payload: { withdrawal_id: row.withdrawalId, state: row.state, version: row.version },
    });
  }
}

/** The Shipper's view of their own request: the destination MASKED to its last four digits (the full snapshot stays with the administration). */
function view(row: WithdrawalRow): JsonObject {
  return {
    withdrawal_id: row.withdrawalId,
    request_code: requestCodeOf(row.withdrawalId),
    amount_vnd: safeJsonNumber(row.amountVnd),
    state: row.state,
    version: row.version,
    can_cancel: row.state === 'PENDING',
    created_at: new Date(row.createdAtMs).toISOString(),
    resolved_at: row.resolvedAtMs === null ? null : new Date(row.resolvedAtMs).toISOString(),
    account: { bank_code: row.bankCode, bank_name: row.bankName, account_number_masked: maskAccount(row.accountNumber), account_holder: row.accountHolder },
  };
}
