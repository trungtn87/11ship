import { ShipperSettlementReader } from '../shipper-settlement/shipper-settlement-reader';
import { WalletReadRepository } from '../wallet/wallet-read-repository';
import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { AccountActivityRegistry } from '../account-lifecycle/account-activity-registry';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { DriverBankRepository, DriverBankRow } from '../driver/driver-bank-repository';
import { DriverEventRepository } from '../driver/driver-event-repository';
import { DriverPatch, DriverRepository, DriverRow, NOW } from '../driver/driver-repository';
import { DRIVER_WALLET_PORT, DriverWalletPort } from '../driver/driver-wallet-port';
import { holderMatchesName } from '../driver/shipper-banks';
import { ShipperViewBuilder } from '../driver/shipper-view';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OutboxWriter } from '../outbox/outbox-writer';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ShipperListQuery } from './admin-shipper-validation';

const RESOURCE = 'driver';
const EVENT_STATE_CHANGED = 'driver.state_changed.v1';
const HISTORY_LIMIT = 50;
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** One administration command on a Shipper. The right it needs is part of its definition. */
export type ShipperCommand =
  | 'approve'
  | 'reject'
  | 'lock'
  | 'unlock'
  | 'classify'
  | 'bank_verify'
  | 'bank_reject'
  | 'closure_reject'
  | 'closure_finalize';

type Right = 'view' | 'review' | 'lock';
const RIGHT: Readonly<Record<ShipperCommand, Right>> = {
  approve: 'review',
  reject: 'review',
  lock: 'lock',
  unlock: 'lock',
  classify: 'review',
  bank_verify: 'review',
  bank_reject: 'review',
  closure_reject: 'review',
  closure_finalize: 'review',
};
const OPERATION: Readonly<Record<ShipperCommand, string>> = {
  approve: 'admin.shipper.approve.v1',
  reject: 'admin.shipper.reject.v1',
  lock: 'admin.shipper.lock.v1',
  unlock: 'admin.shipper.unlock.v1',
  classify: 'admin.shipper.classify.v1',
  bank_verify: 'admin.shipper.bank_verify.v1',
  bank_reject: 'admin.shipper.bank_reject.v1',
  closure_reject: 'admin.shipper.closure_reject.v1',
  closure_finalize: 'admin.shipper.closure_finalize.v1',
};

interface Authorized {
  readonly role: AdminRole;
  readonly actorId: string;
}

interface Applied {
  readonly driver: DriverRow;
  readonly change: string;
  readonly reason?: string | null;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CommandInput {
  readonly expectedVersion: number;
  readonly reason?: string;
  readonly driverType?: 'EXTERNAL' | 'PLATFORM';
}

/**
 * Shipper management for the administration web (M03): the list, the detail and the review / activity commands. SYSTEM, or an ADMIN
 * whose CURRENT permission row for the DRIVER app has VIEW (read) and the right the command needs (review: approve, reject, bank,
 * classification, closure; lock: suspend and reopen). The backend decides on every read and write under the actor's locks after the
 * database clock was read; the screen only hides what it cannot use.
 *
 * A command is ONE transaction opened by the idempotency executor: record -> actor locks -> permission -> driver row FOR UPDATE ->
 * version and state checks -> write -> per-driver history -> audit -> outbox -> the executor's record. Two administrators racing on
 * the same Shipper serialize on the row; the second one finds a changed version / state and is refused. An administrator can never
 * act on their own Shipper profile. Nothing here touches roles, wallet balances or orders: suspending or closing only stops NEW
 * orders; orders in progress and the wallet are left exactly as they are.
 */
@Injectable()
export class AdminShipperService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly drivers: DriverRepository,
    private readonly banks: DriverBankRepository,
    private readonly events: DriverEventRepository,
    private readonly queries: DriverAdminQueryRepository,
    private readonly views: ShipperViewBuilder,
    private readonly activity: AccountActivityRegistry,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    private readonly walletReads: WalletReadRepository,
    private readonly settlement: ShipperSettlementReader,
    @Inject(DRIVER_WALLET_PORT) private readonly wallet: DriverWalletPort,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: ShipperListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'view');
      const total = await this.queries.count(context, query.filter);
      const rows = await this.queries.list(context, query.filter, { limit: query.limit, offset: query.offset });
      return {
        items: rows.map((row) => ({
          driver_id: row.driver.driverId,
          shipper_code: row.driver.shipperCode,
          full_name: row.driver.fullName,
          phone: row.phone,
          driver_type: row.driver.driverType,
          status: row.driver.status,
          review_state: row.driver.reviewState,
          accepting_deliveries: row.driver.acceptingDeliveries,
          bank_state: row.bankState,
          bank_name: row.bankName,
          submitted_at: iso(row.driver.submittedAtMs),
          updated_at: iso(row.driver.updatedAtMs),
          version: row.driver.version,
        })),
        total,
        limit: query.limit,
        offset: query.offset,
        q: query.q,
        status: query.filter.status ?? 'ALL',
      };
    });
  }

  async detail(sessionToken: string | undefined, driverId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'view');
      const driver = await this.#shared(context, driverId);
      return this.#detailView(context, driver);
    });
  }

  async command(
    command: ShipperCommand,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    driverId: string,
    input: CommandInput,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: OPERATION[command],
        idempotencyKey,
        // Everything that decides the effect; the executor only fingerprints it (a reason is never stored in the record).
        logicalRequest: { driver_id: driverId, expected_version: input.expectedVersion, reason: input.reason ?? null, driver_type: input.driverType ?? null },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, command) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, RIGHT[command]);
        const driver = await this.drivers.lockById(context, driverId);
        if (driver === undefined) {
          throw new AppError('DRIVER_NOT_FOUND');
        }
        if (driver.userId === auth.actorId) {
          throw new AppError('DRIVER_SELF_ACTION_FORBIDDEN');
        }
        if (driver.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const applied = await this.#apply(context, command, auth, driver, input);
        if (applied !== undefined) {
          await this.#record(context, command, auth, driver, applied, meta.requestId);
        }
        const current = applied?.driver ?? driver;
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, driver_id: driverId, command }, payload: await this.#detailView(context, current) };
      },
    );
  }

  async #apply(context: TransactionContext, command: ShipperCommand, auth: Authorized, driver: DriverRow, input: CommandInput): Promise<Applied | undefined> {
    switch (command) {
      case 'approve': {
        // The profile must have been sent for review, with a bank account of the Shipper's own name. Nothing else is required.
        if (driver.status !== 'PENDING' || driver.reviewState !== 'SUBMITTED') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        const bank = await this.banks.find(context, driver.driverId);
        if (driver.fullName.trim() === '' || bank === undefined || !holderMatchesName(driver.fullName, bank.accountHolder)) {
          throw new AppError('DRIVER_PROFILE_INCOMPLETE');
        }
        // The first activation needs real money already RECORDED by an administrator (M04 top-up confirmation): at least 100.000 VND confirmed and available. Approving
        // credits nothing and a Shipper's own "I have transferred" request never activates anybody (ADR-004 6).
        if (!(await this.wallet.fundingForActivation(context, driver.driverId)).funded) {
          throw new AppError('DRIVER_FUNDING_REQUIRED');
        }
        return { driver: await this.#write(context, driver, { status: 'ACTIVE', reviewState: 'APPROVED', reviewedAt: NOW, reviewedBy: auth.actorId, rejectionReason: null, acceptingDeliveries: false }), change: 'approved' };
      }
      case 'reject': {
        if (driver.status !== 'PENDING' || driver.reviewState !== 'SUBMITTED') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        const reason = this.#reason(input);
        return { driver: await this.#write(context, driver, { reviewState: 'REJECTED', reviewedAt: NOW, reviewedBy: auth.actorId, rejectionReason: reason }), change: 'rejected', reason };
      }
      case 'lock': {
        if (driver.status !== 'ACTIVE') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        const reason = this.#reason(input);
        // The switch goes off; orders already taken and the wallet stay exactly as they are.
        return {
          driver: await this.#write(context, driver, { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: NOW, acceptingDeliveries: false }),
          change: 'suspended',
          reason,
          detail: { accepting_stopped: driver.acceptingDeliveries },
        };
      }
      case 'unlock': {
        if (driver.status !== 'SUSPENDED') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        return { driver: await this.#write(context, driver, { status: 'ACTIVE', suspensionReason: null, suspendedAt: null }), change: 'reopened' };
      }
      case 'classify': {
        const type = input.driverType;
        if (type === undefined) {
          throw new TechnicalError('internal', 'Missing classification');
        }
        if (driver.status === 'CLOSED') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        if (type === driver.driverType) {
          return undefined;
        }
        // The classification is a label on the Shipper. It grants no role and no administration right: roles are not touched here.
        return { driver: await this.#write(context, driver, { driverType: type }), change: 'classified', detail: { from_type: driver.driverType, to_type: type } };
      }
      case 'bank_verify': {
        const bank = await this.#requireBank(context, driver);
        if (bank.verificationState === 'VERIFIED') {
          return undefined;
        }
        if (!holderMatchesName(driver.fullName, bank.accountHolder)) {
          throw new AppError('BANK_HOLDER_MISMATCH');
        }
        await this.banks.markVerified(context, driver.driverId, auth.actorId);
        return { driver: await this.#write(context, driver, {}), change: 'bank_verified', detail: { bank_code: bank.bankCode } };
      }
      case 'bank_reject': {
        const bank = await this.#requireBank(context, driver);
        const reason = this.#reason(input);
        await this.banks.markRejected(context, driver.driverId, reason);
        // An account that is not verified cannot back new orders.
        return {
          driver: await this.#write(context, driver, {}),
          change: 'bank_rejected',
          reason,
          detail: { bank_code: bank.bankCode, accepting_stopped: driver.acceptingDeliveries },
        };
      }
      case 'closure_reject': {
        if ((await this.walletReads.openWithdrawalCountOfDriver(context, driver.driverId)) > 0) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
        if (driver.status !== 'CLOSING' || driver.statusBeforeClosing === null) {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        const reason = this.#reason(input);
        return { driver: await this.#write(context, driver, { status: driver.statusBeforeClosing, statusBeforeClosing: null, closureRequestedAt: null, closureNote: null }), change: 'closure_rejected', reason };
      }
      case 'closure_finalize': {
        const obligations = await this.settlement.obligations(context, driver.driverId);
        if (obligations.activeWork) throw new AppError('DRIVER_HAS_ACTIVE_WORK');
        if (obligations.pendingFinance) throw new AppError('DRIVER_WALLET_NOT_SETTLED');
        if (driver.status !== 'CLOSING') {
          throw new AppError('DRIVER_STATE_CONFLICT');
        }
        // Deliveries in progress must be finished first, and the wallet settled with the Shipper: the balance is never lost.
        if ((await this.activity.activeWork(context, driver.userId)).length > 0) {
          throw new AppError('DRIVER_HAS_ACTIVE_WORK');
        }
        if (!(await this.wallet.settlementForClosure(context, driver.driverId)).settled) {
          throw new AppError('DRIVER_WALLET_NOT_SETTLED');
        }
        return { driver: await this.#write(context, driver, { status: 'CLOSED', acceptingDeliveries: false }), change: 'closed' };
      }
    }
  }

  async #record(context: TransactionContext, command: ShipperCommand, auth: Authorized, before: DriverRow, applied: Applied, requestId: string): Promise<void> {
    const after = applied.driver;
    await this.events.append(context, {
      driverId: after.driverId,
      eventType: `driver.${applied.change}`,
      fromStatus: before.status,
      toStatus: after.status,
      fromReviewState: before.reviewState,
      toReviewState: after.reviewState,
      actorType: 'ADMIN',
      actorId: auth.actorId,
      reason: applied.reason ?? null,
      ...(applied.detail === undefined ? {} : { detail: applied.detail }),
    });
    await this.audit.append(context, {
      requestId,
      actorType: auth.role,
      actorId: auth.actorId,
      action: OPERATION[command],
      resourceType: RESOURCE,
      resourceId: after.driverId,
      resourceVersion: after.version,
      outcome: 'SUCCESS',
      metadata: {
        driver_id: after.driverId,
        from_status: before.status,
        to_status: after.status,
        from_review_state: before.reviewState,
        to_review_state: after.reviewState,
        version: after.version,
        ...(applied.reason === undefined || applied.reason === null ? {} : { reason: applied.reason }),
        ...applied.detail,
      },
    });
    await this.outbox.append(context, {
      eventType: EVENT_STATE_CHANGED,
      eventSchemaVersion: 1,
      resourceType: RESOURCE,
      resourceId: after.driverId,
      resourceVersion: after.version,
      // No classification, no reason, no bank data: only what a monitor needs to know the state moved.
      payload: { driver_id: after.driverId, change: applied.change, status: after.status, review_state: after.reviewState, accepting_deliveries: after.acceptingDeliveries, version: after.version },
    });
  }

  #reason(input: CommandInput): string {
    if (input.reason === undefined) {
      throw new AppError('ADMIN_INPUT_INVALID');
    }
    return input.reason;
  }

  async #requireBank(context: TransactionContext, driver: DriverRow): Promise<DriverBankRow> {
    if (driver.status === 'CLOSED') {
      throw new AppError('DRIVER_STATE_CONFLICT');
    }
    const bank = await this.banks.find(context, driver.driverId);
    if (bank === undefined) {
      throw new AppError('DRIVER_PROFILE_INCOMPLETE');
    }
    return bank;
  }

  async #write(context: TransactionContext, driver: DriverRow, patch: DriverPatch): Promise<DriverRow> {
    const updated = await this.drivers.update(context, driver.driverId, driver.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  /** A plain read of the target for the detail screen. The administrator's own Shipper profile is readable (it is the same data). */
  async #shared(context: TransactionContext, driverId: string): Promise<DriverRow> {
    const result = await this.drivers.findById(context, driverId);
    if (result === undefined) {
      throw new AppError('DRIVER_NOT_FOUND');
    }
    return result;
  }

  async #detailView(context: TransactionContext, driver: DriverRow): Promise<JsonObject> {
    const owner = await this.views.build(context, driver);
    const history = await this.events.list(context, driver.driverId, HISTORY_LIMIT);
    return {
      ...owner,
      // The internal classification exists ONLY in the administration views.
      driver_type: driver.driverType,
      review: { reviewed_at: iso(driver.reviewedAtMs), reviewed_by: driver.reviewedBy },
      created_at: iso(driver.createdAtMs),
      updated_at: iso(driver.updatedAtMs),
      history: history.map((event) => ({
        event_id: event.eventId,
        event_type: event.eventType,
        from_status: event.fromStatus,
        to_status: event.toStatus,
        from_review_state: event.fromReviewState,
        to_review_state: event.toReviewState,
        actor_type: event.actorType,
        actor_id: event.actorId,
        reason: event.reason,
        detail: event.detail as JsonObject,
        created_at: iso(event.createdAtMs),
      })),
    };
  }

  /**
   * Actor locks in the module order, the CURRENT permission rows (ADMIN), the database clock after the last lock, then the right:
   * SYSTEM, or an ADMIN with VIEW and (for a command) the review or lock right on DRIVER. Nothing from the client decides it.
   */
  async #authorize(context: TransactionContext, known: SessionLookup, right: Right): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'ADMIN') {
      const row = rows.find((candidate) => candidate.app === 'DRIVER');
      if (row === undefined || !row.canView || (right === 'review' && !row.canReviewProfile) || (right === 'lock' && !row.canLock)) {
        throw new AppError('ADMIN_FORBIDDEN');
      }
    }
    return { role, actorId: known.userId };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, command: ShipperCommand): Promise<true> {
    if (guard.actor_user_id !== known.userId || guard.command !== command || !isCanonicalUuid(guard.driver_id)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, RIGHT[command]);
    return true;
  }
}
