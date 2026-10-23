import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor, LockedActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { FinancePermissionKey, FINANCE_PERMISSION_READ, FINANCE_PERMISSION_WITHDRAWAL_RECONCILE } from '../finance-access/finance-access-constants';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CommissionPolicy, CommissionPolicyRepository } from '../wallet/commission-policy-repository';
import { AdminLedgerCursor, AdminLedgerKind, WalletCursor, WalletReadRepository } from '../wallet/wallet-read-repository';
import { safeJsonNumber } from '../driver-wallet/driver-wallet-validation';
import { driverIdentityView } from './admin-finance-views';
import { AdminLedgerQuery, AdminWalletListQuery, CommissionBody, encodeLedgerCursor, encodeWalletCursor } from './admin-finance-read-validation';

const iso = (ms: number): string => new Date(ms).toISOString();

const COMMISSION_OPERATION = 'admin.wallet_commission_policy.change.v1';
const DRIFT_OPERATION = 'admin.wallet_reconciliation.check.v1';

/**
 * The read side of the administration's finance screens (M04-C): the overview, the wallets, the transactions and the reconciliation, plus the commission policy.
 * Every read needs `wallet.read` (SYSTEM implicit) asked again under the locks. Figures come from ONE statement each (one database snapshot), so a balance and the ledger it is
 * compared with can never be read at two moments. A difference between a balance, a held amount and the ledger / ACTIVE holds is REPORTED and never repaired: the one
 * write here is the audited "run the check" command, which records that a drift was seen (it changes no balance, hold or ledger row).
 * Personal data is masked on the server: the name to initials, the phone to its last three digits. No bank detail is ever returned by these reads.
 */
@Injectable()
export class AdminFinanceReadService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly access: FinanceAccessParticipant,
    private readonly reads: WalletReadRepository,
    private readonly driverQueries: DriverAdminQueryRepository,
    private readonly policies: CommissionPolicyRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  overview(sessionToken: string | undefined): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const o = await this.reads.overview(context);
      const policy = await this.policies.current(context);
      return {
        wallets: o.wallets,
        total_balance_vnd: safeJsonNumber(o.totalBalanceVnd),
        total_held_vnd: safeJsonNumber(o.totalHeldVnd),
        total_available_vnd: safeJsonNumber(o.totalBalanceVnd - o.totalHeldVnd),
        topup_pending: { count: o.topupPending, amount_vnd: safeJsonNumber(o.topupPendingVnd) },
        withdrawal_pending: { count: o.withdrawalPending, amount_vnd: safeJsonNumber(o.withdrawalPendingVnd) },
        withdrawal_processing: { count: o.withdrawalProcessing },
        withdrawal_reconciliation: { count: o.withdrawalReconciliation, amount_vnd: safeJsonNumber(o.withdrawalReconciliationVnd) },
        last_24h: {
          topup: { count: o.topupConfirmed24h, amount_vnd: safeJsonNumber(o.topupConfirmed24hVnd) },
          withdrawal_paid: { count: o.withdrawalPaid24h, amount_vnd: safeJsonNumber(o.withdrawalPaid24hVnd) },
          commission: { count: o.commission24h, amount_vnd: safeJsonNumber(o.commission24hVnd) },
        },
        drift: { wallets: o.driftWallets, withdrawals: o.driftWithdrawals },
        commission_vnd: safeJsonNumber(policy.amountVnd),
      };
    });
  }

  wallets(sessionToken: string | undefined, query: AdminWalletListQuery): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      let driverIds: string[] | undefined;
      if (query.search !== null) {
        driverIds = await this.driverQueries.searchIds(context, query.search, 200);
      }
      const rows = driverIds !== undefined && driverIds.length === 0 ? [] : await this.reads.listWallets(context, { driverIds, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const identities = await this.driverQueries.identities(context, page.map((row) => row.driverId));
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({
          wallet_id: row.walletId,
          driver_id: row.driverId,
          shipper: driverIdentityView(identities.get(row.driverId)),
          balance_vnd: safeJsonNumber(row.balanceVnd),
          held_vnd: safeJsonNumber(row.heldVnd),
          available_vnd: safeJsonNumber(row.balanceVnd - row.heldVnd),
          updated_at: iso(row.updatedAtMs),
        })),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeWalletCursor(last.updatedAtMs, last.walletId) : null,
      };
    });
  }

  walletOf(sessionToken: string | undefined, driverId: string): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const wallet = await this.reads.findWalletByDriver(context, driverId);
      const identities = await this.driverQueries.identities(context, [driverId]);
      if (wallet === undefined) {
        if (!identities.has(driverId)) {
          throw new AppError('DRIVER_NOT_FOUND');
        }
        return { shipper: driverIdentityView(identities.get(driverId)), wallet: null, holds: [], recent: [] };
      }
      const holds = await this.reads.holds(context, wallet.walletId, { status: undefined, limit: 20 });
      const recent = await this.reads.listLedger(context, { kind: undefined, driverId, limit: 20, after: undefined });
      return {
        shipper: driverIdentityView(identities.get(driverId)),
        wallet: {
          wallet_id: wallet.walletId,
          balance_vnd: safeJsonNumber(wallet.balanceVnd),
          held_vnd: safeJsonNumber(wallet.heldVnd),
          available_vnd: safeJsonNumber(wallet.balanceVnd - wallet.heldVnd),
          version: wallet.version,
        },
        holds: holds.map((hold) => ({ hold_id: hold.holdId, purpose: hold.purpose, amount_vnd: safeJsonNumber(hold.amountVnd), status: hold.status, order_ref: hold.orderRef, created_at: iso(hold.createdAtMs), resolved_at: hold.resolvedAtMs === null ? null : iso(hold.resolvedAtMs) })),
        recent: recent.map(ledgerItem),
      };
    });
  }

  ledger(sessionToken: string | undefined, query: AdminLedgerQuery): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const rows = await this.reads.listLedger(context, { kind: query.kind, driverId: query.driverId, limit: query.limit + 1, after: query.after });
      const page = rows.slice(0, query.limit);
      const identities = await this.driverQueries.identities(context, [...new Set(page.map((row) => row.driverId))]);
      const last = page[page.length - 1];
      return {
        items: page.map((row) => ({ ...ledgerItem(row), driver_id: row.driverId, shipper: driverIdentityView(identities.get(row.driverId)) })),
        next_cursor: rows.length > query.limit && last !== undefined ? encodeLedgerCursor(last.atMs, last.rowId) : null,
      };
    });
  }

  /** The reconciliation screen: what the database says about every wallet right now. READ ONLY (the audited command below is the one that records a finding). */
  reconciliation(sessionToken: string | undefined): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const o = await this.reads.overview(context);
      const drift = await this.reads.driftWallets(context, 100);
      const identities = await this.driverQueries.identities(context, drift.map((row) => row.driverId));
      return {
        checked_wallets: o.wallets,
        drift_wallets: o.driftWallets,
        drift_withdrawals: o.driftWithdrawals,
        withdrawals_in_reconciliation: o.withdrawalReconciliation,
        drift: drift.map((row) => ({
          wallet_id: row.walletId,
          driver_id: row.driverId,
          shipper: driverIdentityView(identities.get(row.driverId)),
          balance_vnd: safeJsonNumber(row.balanceVnd),
          held_vnd: safeJsonNumber(row.heldVnd),
          ledger_sum_vnd: safeJsonNumber(row.ledgerSumVnd),
          last_balance_after_vnd: safeJsonNumber(row.lastBalanceAfterVnd),
          active_holds_vnd: safeJsonNumber(row.activeHoldsVnd),
        })),
      };
    });
  }

  /** Runs the check and RECORDS a finding (audit + outbox) when a drift exists. It never changes a balance, a hold or a ledger row. Needs the reconcile right. */
  runCheck(sessionToken: string | undefined, csrf: unknown, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.actor.precheck(sessionToken, { required: true, header: csrf }).then((known) =>
      this.executor.execute(
        {
          scopeType: PROVISIONING_SCOPE_TYPE,
          scopeId: known.userId,
          operationId: DRIFT_OPERATION,
          idempotencyKey: key,
          logicalRequest: {},
          replay: {
            kind: 'sensitive',
            authorize: async (context, guard) => {
              if (guard.actor_user_id !== known.userId) {
                throw new AppError('ADMIN_SESSION_INVALID');
              }
              await this.#authorize(context, known, FINANCE_PERMISSION_WITHDRAWAL_RECONCILE);
              return true;
            },
          },
        },
        async (context) => {
          const { locked } = await this.#authorize(context, known, FINANCE_PERMISSION_WITHDRAWAL_RECONCILE);
          const o = await this.reads.overview(context);
          if (o.driftWallets + o.driftWithdrawals > 0) {
            await this.audit.append(context, {
              requestId: meta.requestId,
              actorType: locked.checked.membership.adminRole,
              actorId: known.userId,
              action: DRIFT_OPERATION,
              resourceType: 'wallet_reconciliation',
              resourceId: null,
              outcome: 'SUCCESS',
              metadata: { drift_wallets: o.driftWallets, drift_withdrawals: o.driftWithdrawals, checked_wallets: o.wallets },
            });
            await this.outbox.append(context, {
              eventType: 'wallet.drift.detected.v1',
              eventSchemaVersion: 1,
              resourceType: 'wallet_reconciliation',
              resourceId: randomUUID(),
              resourceVersion: 1,
              payload: { drift_wallets: o.driftWallets, drift_withdrawals: o.driftWithdrawals },
            });
          }
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { checked_wallets: o.wallets, drift_wallets: o.driftWallets, drift_withdrawals: o.driftWithdrawals, recorded: o.driftWallets + o.driftWithdrawals > 0 } };
        },
      ),
    );
  }

  // ---- commission policy ---------------------------------------------------------------------------------------------------------------------------------

  commissionPolicy(sessionToken: string | undefined): Promise<JsonObject> {
    return this.#read(sessionToken, async (context) => {
      const rows = await this.policies.list(context, 30);
      return { current: policyView(rows[0] as CommissionPolicy), history: rows.map(policyView) };
    });
  }

  /** SYSTEM only. Appends a new policy version; it reaches only the assignments accepted AFTER it (each assignment snapshotted its own amount). */
  changeCommission(sessionToken: string | undefined, csrf: unknown, body: CommissionBody, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.actor.precheck(sessionToken, { required: true, header: csrf }).then((known) =>
      this.executor.execute(
        {
          scopeType: PROVISIONING_SCOPE_TYPE,
          scopeId: known.userId,
          operationId: COMMISSION_OPERATION,
          idempotencyKey: key,
          logicalRequest: { expected_version: body.expectedVersion, commission_vnd: body.commissionVnd },
          replay: {
            kind: 'sensitive',
            authorize: async (context, guard) => {
              if (guard.actor_user_id !== known.userId) {
                throw new AppError('ADMIN_SESSION_INVALID');
              }
              await this.#systemOnly(context, known);
              return true;
            },
          },
        },
        async (context) => {
          const locked = await this.#systemOnly(context, known);
          const current = await this.policies.lockCurrent(context);
          if (current.version !== body.expectedVersion) {
            throw new AppError('COMMISSION_POLICY_VERSION_CONFLICT');
          }
          if (BigInt(body.commissionVnd) === current.amountVnd) {
            throw new AppError('COMMISSION_POLICY_VERSION_CONFLICT');
          }
          const next = await this.policies.insertNext(context, current.version + 1, body.commissionVnd, known.userId);
          await this.audit.append(context, {
            requestId: meta.requestId,
            actorType: locked.checked.membership.adminRole,
            actorId: known.userId,
            action: COMMISSION_OPERATION,
            resourceType: 'wallet_commission_policy',
            resourceId: null,
            resourceVersion: next.version,
            outcome: 'SUCCESS',
            metadata: { old_value: safeJsonNumber(current.amountVnd), new_value: body.commissionVnd, policy_version: next.version },
          });
          await this.outbox.append(context, {
            eventType: 'wallet.commission_policy.changed.v1',
            eventSchemaVersion: 1,
            resourceType: 'wallet_commission_policy',
            resourceId: randomUUID(),
            resourceVersion: next.version,
            payload: { policy_version: next.version },
          });
          return { status: 200, replayGuard: { actor_user_id: known.userId }, payload: { current: policyView(next) } };
        },
      ),
    );
  }

  // ---- shell ---------------------------------------------------------------------------------------------------------------------------------------------

  async #read(sessionToken: string | undefined, work: (context: TransactionContext) => Promise<JsonObject>): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, FINANCE_PERMISSION_READ);
      return work(context);
    });
  }

  async #authorize(context: TransactionContext, known: SessionLookup, permission: FinancePermissionKey): Promise<{ locked: LockedActor; nowMs: number }> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const nowMs = await freshClockMs(context);
    await this.access.require(context, locked, permission, nowMs);
    return { locked, nowMs };
  }

  /** SYSTEM only: the actor under the locks, the clock after them, then the SYSTEM requirement (an ADMIN gets ADMIN_FORBIDDEN). */
  async #systemOnly(context: TransactionContext, known: SessionLookup): Promise<LockedActor> {
    const locked = await this.actor.lock(context, known, { user: 'write', factor: 'read' });
    this.actor.assertLive(locked, await freshClockMs(context));
    return locked;
  }
}

function policyView(policy: CommissionPolicy): JsonObject {
  return { version: policy.version, commission_vnd: safeJsonNumber(policy.amountVnd), created_at: iso(policy.createdAtMs) };
}

function ledgerItem(row: { rowId: string; atMs: number; kind: AdminLedgerKind; amountVnd: bigint; balanceAfterVnd: bigint | null; holdStatus: string | null; orderRef: string | null; sourceId: string | null }): JsonObject {
  return {
    id: row.rowId,
    kind: row.kind,
    amount_vnd: safeJsonNumber(row.amountVnd),
    balance_after_vnd: row.balanceAfterVnd === null ? null : safeJsonNumber(row.balanceAfterVnd),
    hold_status: row.holdStatus,
    order_ref: row.orderRef,
    source_id: row.sourceId,
    at: iso(row.atMs),
  };
}

export type { WalletCursor, AdminLedgerCursor };
