import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { AdminActionInput, AdminDeliveryAction, AdminDeliveryListQuery } from '../delivery/admin-delivery-validation';
import { OPERATIONS } from '../delivery/delivery-constants';
import { DeliveryRecorder } from '../delivery/delivery-recorder';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DeliveryHandback } from '../delivery/delivery-handback';
import { dropoffAreaOf } from '../delivery/delivery-rules';
import { DeliveryViews } from '../delivery/delivery-views';
import { DriverAdminQueryRepository } from '../driver/driver-admin-query-repository';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { FINANCE_PERMISSION_READ } from '../finance-access/finance-access-constants';
import { FinanceAccessRepository } from '../finance-access/finance-access-repository';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { WalletReportReader } from '../wallet/wallet-report-reader';

type Right = 'view' | 'review' | 'lock';

/** What each action needs: reading the contact and settling the goods are a review; taking a Shipper off a delivery or changing the fee are a lock. */
const RIGHT: Readonly<Record<AdminDeliveryAction, Right>> = {
  'record-custody': 'review',
  'refer-m11': 'review',
  'release-assignment': 'lock',
  'adjust-after-pickup': 'lock',
};

interface Authorized {
  readonly role: AdminRole;
  readonly actorId: string;
  readonly review: boolean;
  readonly lock: boolean;
  /** The finance READ right (wallet.read): the commission hold / ledger facts of a delivery are money data, shown only with it. */
  readonly walletRead: boolean;
}

/** `admin.delivery.action.v1.record_custody`: dotted lower-case segments (the audit and the idempotency scope accept no hyphen). */
const operationOf = (name: AdminDeliveryAction): string => `${OPERATIONS.adminAction}.${name.replace(/-/g, '_')}`;

/** What needs a person, from the stored state only (M12-B): a stopped search nobody called again, goods still unsettled, an active delivery without a fee. */
export function signalsOf(state: string, feeVnd: number | null, custodyOpen: boolean, recalled: boolean): string[] {
  const signals: string[] = [];
  if (state === 'search_stopped' && !recalled) {
    signals.push('SEARCH_STOPPED');
  }
  if (custodyOpen) {
    signals.push('CUSTODY_OPEN');
  }
  if (feeVnd === null && ['waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering'].includes(state)) {
    signals.push('FEE_UNKNOWN');
  }
  return signals;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * Delivery management for the administration web (M07.07): the list with counters, the detail and the few exception actions. SYSTEM, or an ADMIN whose
 * CURRENT permission rows give VIEW on the SHOP or DRIVER app (read), the review right on DRIVER (the recipient's contact, settling the goods, passing
 * a case to M11) or the lock right on DRIVER (taking a Shipper off a delivery before pickup, correcting the fee or address after pickup). The backend
 * decides on every read and write under the actor's locks after the database clock was read.
 *
 * There is NO route that sets a status: every action has its own condition on the stored state, a mandatory reason and an audit row; a locked account
 * or a broken device is handled by "release-assignment" (the commission is given back and the search goes on inside its ORIGINAL window), and a
 * Shipper's account being locked never marks a delivery as delivered. Lock order is the same as everywhere: the Shipper row first, then the delivery.
 */
@Injectable()
export class AdminDeliveryService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly driverQueries: DriverAdminQueryRepository,
    private readonly views: DeliveryViews,
    private readonly recorder: DeliveryRecorder,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly commission: CommissionHoldService,
    private readonly handback: DeliveryHandback,
    private readonly walletReports: WalletReportReader,
    private readonly financeGrants: FinanceAccessRepository,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: AdminDeliveryListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'view');
      let driverIds: string[] | null = null;
      if (query.shipper !== '') {
        const found = await this.driverQueries.list(context, { pattern: { name: likeContains(foldVietnamese(query.shipper)), code: likeContains(query.shipper), phone: null }, status: null }, { limit: 50, offset: 0 });
        driverIds = found.map((row) => row.driver.driverId);
      }
      const page =
        driverIds !== null && driverIds.length === 0
          ? { rows: [], total: 0 }
          : await this.deliveries.listForAdmin(context, { q: query.q, state: query.state, goods: query.goods, basis: query.basis, fromMs: query.fromMs, toMs: query.toMs, shop: query.shop, shopId: query.shopId, driverIds, source: query.source, group: query.group }, { limit: query.limit, offset: query.offset });
      const names = new Map<string, string>();
      const items: JsonObject[] = [];
      for (const row of page.rows) {
        let shipper: JsonObject | null = null;
        if (row.driverId !== null) {
          if (!names.has(row.driverId)) {
            names.set(row.driverId, (await this.drivers.findById(context, row.driverId))?.fullName ?? '—');
          }
          shipper = { driver_id: row.driverId, name: names.get(row.driverId) ?? '—' };
        }
        const d = row.delivery;
        items.push({
          delivery_id: d.deliveryId,
          code: d.code,
          shop: { shop_id: d.shopId, name: d.shopName },
          shipper,
          state: d.state,
          goods_value_vnd: d.goodsValueVnd,
          fee_vnd: d.feeVnd,
          fee_status: d.feeVnd === null ? 'UNKNOWN' : 'FINAL',
          source: d.source,
          order_id: d.orderId,
          wait_seconds: row.waitSeconds,
          signals: signalsOf(d.state, d.feeVnd, row.incidentStatus === 'OPEN', row.recalled),
          incident_open: row.incidentStatus === 'OPEN',
          custody: row.custody,
          created_at: iso(d.createdAtMs),
          updated_at: iso(d.updatedAtMs),
        });
      }
      const counters = await this.deliveries.counters(context);
      return {
        items,
        total: page.total,
        limit: query.limit,
        offset: query.offset,
        counters: { searching: counters.searching, waiting_pickup: counters.waitingPickup, delivering: counters.delivering, needs_attention: counters.needsAttention },
      };
    });
  }

  async detail(sessionToken: string | undefined, deliveryId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const delivery = await this.deliveries.findById(context, deliveryId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      return this.#view(context, delivery, auth);
    });
  }

  async action(
    name: AdminDeliveryAction,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    deliveryId: string,
    input: AdminActionInput,
    idempotencyKey: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: operationOf(name),
        idempotencyKey,
        logicalRequest: { delivery_id: deliveryId, action: name, expected_version: input.expectedVersion, reason: input.reason, resolution: input.resolution, fee_vnd: input.feeVnd, address: input.recipientAddress },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, name) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, RIGHT[name]);
        // The Shipper holding the delivery (peeked) is locked BEFORE the delivery, as on every other path.
        const peek = await this.deliveries.findById(context, deliveryId);
        if (peek === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        const peeked = await this.deliveries.findActiveAssignment(context, deliveryId);
        if (peeked !== undefined) {
          await this.drivers.lockById(context, peeked.driverId);
        }
        const delivery = await this.deliveries.lockById(context, deliveryId);
        if (delivery === undefined) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        if ((await this.deliveries.findActiveAssignment(context, deliveryId))?.driverId !== peeked?.driverId) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.#apply(context, name, auth, delivery, input, meta.requestId);
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, delivery_id: deliveryId, action: name }, payload: await this.#view(context, after, auth) };
      },
    );
  }

  async #apply(context: TransactionContext, name: AdminDeliveryAction, auth: Authorized, delivery: DeliveryRow, input: AdminActionInput, requestId: string): Promise<DeliveryRow> {
    const operation = operationOf(name);
    switch (name) {
      case 'record-custody': {
        const incident = await this.deliveries.lockIncident(context, delivery.deliveryId);
        // The goods of a failed delivery, or of one the creator cancelled after pickup, are settled the same way.
        if ((delivery.state !== 'failed' && delivery.state !== 'cancelled_by_merchant') || incident === undefined || incident.status !== 'OPEN' || input.resolution === null) {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        const custody = input.resolution === 'GOODS_RETURNED' ? 'SHOP' : 'HANDLED';
        if (!(await this.deliveries.closeIncident(context, incident.incidentId, incident.version, custody, auth.actorId, input.reason))) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.#touch(context, delivery);
        await this.recorder.record(context, { delivery: after, type: input.resolution === 'GOODS_RETURNED' ? 'goods_returned_by_admin' : 'goods_handled_by_admin', actorType: 'ADMIN', actorId: auth.actorId, assignmentId: incident.assignmentId, driverId: incident.driverId, note: input.reason, operation, requestId, metadata: { custody } });
        return after;
      }
      case 'refer-m11': {
        const incident = await this.deliveries.lockIncident(context, delivery.deliveryId);
        if (incident === undefined || incident.m11ReferredAtMs !== null) {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        if (!(await this.deliveries.markReferred(context, incident.incidentId, incident.version, auth.actorId))) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.#touch(context, delivery);
        // M11 (complaints) is not connected: only the mark and the audit exist. No ticket is invented.
        await this.recorder.record(context, { delivery: after, type: 'referred_to_m11', actorType: 'ADMIN', actorId: auth.actorId, assignmentId: incident.assignmentId, driverId: incident.driverId, note: input.reason, operation, requestId });
        return after;
      }
      case 'release-assignment': {
        const assignment = await this.deliveries.lockActiveAssignment(context, delivery.deliveryId);
        if (assignment === undefined || (delivery.state !== 'accepted' && delivery.state !== 'location_confirmed')) {
          // After pickup the goods are with the Shipper: nothing here marks the delivery as delivered or lost.
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        // The same end of a Shipper's turn as their own "Hủy nhận đơn": the commission is released once and a fee only this Shipper had agreed goes back to the original.
        const { delivery: after, next } = await this.handback.endTurn(context, delivery, assignment, {
          status: 'RELEASED_BY_ADMIN',
          actor: 'ADMIN',
          reason: input.reason,
          stoppedReason: 'Hết thời gian tìm shipper sau khi Admin giải phóng shipper',
          nowMs: await freshClockMs(context),
        });
        await this.recorder.record(context, { delivery: after, type: 'released_by_admin', actorType: 'ADMIN', actorId: auth.actorId, assignmentId: assignment.assignmentId, driverId: assignment.driverId, note: input.reason, operation, requestId, metadata: { next_state: next } });
        return after;
      }
      case 'adjust-after-pickup': {
        if (delivery.pickedUpAtMs === null) {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        const patch: { feeVnd?: number; dropoffAddressText?: string; dropoffAreaText?: string | null } = {};
        const before: JsonObject = {};
        const next: JsonObject = {};
        if (input.feeVnd !== null && input.feeVnd !== delivery.feeVnd) {
          patch.feeVnd = input.feeVnd;
          before.fee_vnd = delivery.feeVnd;
          next.fee_vnd = input.feeVnd;
          const agreement = await this.agreements.readByDelivery(context, delivery.deliveryId);
          if (agreement !== undefined && agreement.status === 'LOCKED') {
            const adjusted = await this.agreements.act(context, { agreementId: agreement.agreementId, expectedVersion: agreement.version, requestId: randomUUID(), nowMs: await freshClockMs(context), action: { type: 'ADMIN_ADJUST', amountVnd: input.feeVnd, reason: input.reason.slice(0, 200) }, actorUserId: auth.actorId });
            if (adjusted.kind !== 'ok' && adjusted.kind !== 'replayed') {
              throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
            }
          }
        }
        if (input.recipientAddress !== null && input.recipientAddress !== delivery.dropoffAddressText) {
          patch.dropoffAddressText = input.recipientAddress;
          patch.dropoffAreaText = dropoffAreaOf(input.recipientAddress);
          before.address_text = delivery.dropoffAddressText;
          next.address_text = input.recipientAddress;
        }
        if (Object.keys(patch).length === 0) {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        // The only door through the database's fee lock: a transaction-local flag, set here, with the reason and the before / after in the audit row.
        await context.query(`SELECT set_config('app.m07_admin_adjust', 'on', true)`);
        const after = await this.#update(context, delivery, patch);
        const changed = [patch.feeVnd === undefined ? null : `phí ${String(before.fee_vnd)} → ${String(next.fee_vnd)}`, patch.dropoffAddressText === undefined ? null : 'địa chỉ giao'].filter((part) => part !== null).join(', ');
        await this.recorder.record(context, { delivery: after, type: 'adjusted_by_admin', actorType: 'ADMIN', actorId: auth.actorId, note: `Admin điều chỉnh ${changed}: ${input.reason}`.slice(0, 480), operation, requestId, metadata: { before, after: next } });
        return after;
      }
    }
  }

  /** Bumps the version of the delivery row (so a reader refreshes) without changing anything else. */
  #touch(context: TransactionContext, delivery: DeliveryRow): Promise<DeliveryRow> {
    return this.#update(context, delivery, {});
  }

  async #update(context: TransactionContext, delivery: DeliveryRow, patch: Parameters<DeliveryRepository['update']>[3]): Promise<DeliveryRow> {
    const updated = await this.deliveries.update(context, delivery.deliveryId, delivery.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  async #view(context: TransactionContext, delivery: DeliveryRow, auth: Authorized): Promise<JsonObject> {
    const incident = await this.deliveries.findIncident(context, delivery.deliveryId);
    const can: string[] = [];
    if (auth.review && (delivery.state === 'failed' || delivery.state === 'cancelled_by_merchant') && incident?.status === 'OPEN') {
      can.push('record-custody');
    }
    if (auth.review && incident !== undefined && incident.m11ReferredAtMs === null) {
      can.push('refer-m11');
    }
    if (auth.lock && (delivery.state === 'accepted' || delivery.state === 'location_confirmed')) {
      can.push('release-assignment');
    }
    if (auth.lock && delivery.pickedUpAtMs !== null) {
      can.push('adjust-after-pickup');
    }
    const view = await this.views.forAdmin(context, delivery, auth.review, can);
    if (!auth.walletRead) {
      return { ...view, money: { status: 'FORBIDDEN' } };
    }
    const assignments = await this.deliveries.listAssignments(context, delivery.deliveryId);
    const traces = await this.walletReports.commissionOf(context, assignments.map((assignment) => assignment.assignmentId));
    return {
      ...view,
      money: {
        status: 'OK',
        commissions: traces.map((trace) => ({
          assignment_id: trace.assignmentId,
          hold_status: trace.holdStatus,
          amount_vnd: trace.amountVnd,
          ledger_entry_id: trace.ledgerEntryId,
          ledger_at: trace.ledgerAtMs === null ? null : new Date(trace.ledgerAtMs).toISOString(),
        })),
      },
    };
  }

  /**
   * Actor locks in the module order, the CURRENT permission rows (ADMIN), the database clock after the last lock, then the right:
   * SYSTEM, or an ADMIN with VIEW on the SHOP or DRIVER app, and for an action the review or lock right on DRIVER. Nothing from the client decides it.
   */
  async #authorize(context: TransactionContext, known: SessionLookup, right: Right): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      return { role, actorId: known.userId, review: true, lock: true, walletRead: true };
    }
    const walletRead = (await this.financeGrants.listForUser(context, known.userId)).some((row) => row.permissionKey === FINANCE_PERMISSION_READ && row.state === 'GRANTED');
    const driver = rows.find((candidate) => candidate.app === 'DRIVER');
    const shop = rows.find((candidate) => candidate.app === 'SHOP');
    const mayView = (driver?.canView ?? false) || (shop?.canView ?? false);
    const review = (driver?.canView ?? false) && (driver?.canReviewProfile ?? false);
    const lock = (driver?.canView ?? false) && (driver?.canLock ?? false);
    if (!mayView || (right === 'review' && !review) || (right === 'lock' && !lock)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role, actorId: known.userId, review, lock, walletRead };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, name: AdminDeliveryAction): Promise<true> {
    if (guard.actor_user_id !== known.userId || guard.action !== name || !isCanonicalUuid(guard.delivery_id)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, RIGHT[name]);
    return true;
  }
}
