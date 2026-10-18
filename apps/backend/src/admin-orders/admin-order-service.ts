import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ACTIVE_STATES } from '../delivery/delivery-constants';
import { DeliveryCancel } from '../delivery/delivery-cancel';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ORDER_OPERATIONS } from '../orders/order-constants';
import { OrderRecorder } from '../orders/order-recorder';
import { OrderRepository, OrderRow } from '../orders/order-repository';
import { assertFailedAndSettled } from '../orders/order-shop-service';
import { AdminListQuery, AdminOrderAction } from '../orders/order-validation';
import { OrderViews } from '../orders/order-views';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

type Right = 'view' | 'review' | 'lock';

const RIGHT: Readonly<Record<AdminOrderAction, Right>> = {
  'cancel-order': 'lock',
  'close-not-completed': 'review',
};

interface Authorized {
  readonly role: AdminRole;
  readonly actorId: string;
  readonly review: boolean;
  readonly lock: boolean;
}

/** `admin.order.action.v1.cancel_order`: dotted lower-case segments (the audit and the idempotency scope accept no hyphen). */
const operationOf = (name: AdminOrderAction): string => `${ORDER_OPERATIONS.adminAction}.${name.replace(/-/g, '_')}`;

export interface AdminActionInput {
  readonly expectedVersion: number;
  readonly reason: string;
}

/**
 * Order management for the administration web (M10.05): the list, the detail with the edits, the calls (deliveries) and the reasons, and the two exception
 * actions. SYSTEM, or an ADMIN whose CURRENT permission rows give VIEW on the SHOP or DRIVER app (read), the review right on DRIVER (closing as not completed) or
 * the lock right on DRIVER (cancelling a running order: it takes the Shipper off the delivery). The backend decides on every read and write under the actor's
 * locks. There is NO route that sets a status: each action has its own condition on the stored state, a mandatory reason and an audit row, and it never
 * touches money outside the delivery rules (the commission is given back by the delivery cancellation of M07, the ledger is never written here).
 * Lock order is the system's: the Shipper row first, then the delivery, then the Order.
 */
@Injectable()
export class AdminOrderService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly orders: OrderRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly views: OrderViews,
    private readonly recorder: OrderRecorder,
    private readonly cancelling: DeliveryCancel,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async list(sessionToken: string | undefined, query: AdminListQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      await this.#authorize(context, known, 'view');
      const nowMs = await freshClockMs(context);
      const page = await this.orders.listForAdmin(context, { q: query.q, status: query.status, shop: query.shop, fromMs: query.fromMs, toMs: query.toMs }, query.limit, query.offset);
      return {
        items: page.rows.map((row) => ({ ...this.views.summary(row, true, nowMs), shop_name: row.order.shopName, recipient_phone: null })),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  async detail(sessionToken: string | undefined, orderId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const order = await this.orders.findById(context, orderId);
      if (order === undefined) {
        throw new AppError('ORDER_NOT_FOUND');
      }
      return this.#view(context, order, auth);
    });
  }

  async action(
    name: AdminOrderAction,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    orderId: string,
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
        logicalRequest: { order_id: orderId, action: name, expected_version: input.expectedVersion, reason: input.reason },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, name) },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, RIGHT[name]);
        if ((await this.orders.findById(context, orderId)) === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        // The delivery in progress (peeked) and its Shipper are locked BEFORE the Order, as on every other path.
        const running = (await this.deliveries.listOfOrder(context, orderId)).find((d) => ACTIVE_STATES.includes(d.state));
        let delivery: DeliveryRow | undefined;
        if (running !== undefined) {
          const peeked = await this.deliveries.findActiveAssignment(context, running.deliveryId);
          if (peeked !== undefined) {
            await this.drivers.lockById(context, peeked.driverId);
          }
          delivery = await this.deliveries.lockById(context, running.deliveryId);
          if (delivery === undefined || (await this.deliveries.findActiveAssignment(context, running.deliveryId))?.driverId !== peeked?.driverId) {
            throw new AppError('DELIVERY_STATE_CONFLICT');
          }
        }
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        if (order.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (order.status !== 'PREPARING') {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        const after = await this.#apply(context, name, auth, order, delivery, input, meta.requestId);
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, order_id: orderId, action: name }, payload: await this.#view(context, after, auth) };
      },
    );
  }

  async #apply(context: TransactionContext, name: AdminOrderAction, auth: Authorized, order: OrderRow, delivery: DeliveryRow | undefined, input: AdminActionInput, requestId: string): Promise<OrderRow> {
    const operation = operationOf(name);
    if (name === 'cancel-order') {
      if (delivery !== undefined) {
        // Before pickup only: after it the goods are with the Shipper and nothing here cancels them (AFTER_PICKUP_NO_CANCEL).
        await this.cancelling.cancel(context, { type: 'ADMIN', userId: auth.actorId }, delivery, `Admin hủy đơn món: ${input.reason}`.slice(0, 300), requestId, true);
      } else {
        const all = await this.deliveries.listOfOrder(context, order.orderId);
        const latest = all[all.length - 1];
        if (latest?.state === 'failed') {
          const incident = await this.deliveries.findIncident(context, latest.deliveryId);
          if (incident?.status === 'OPEN') {
            throw new AppError('RECALL_BLOCKED_GOODS_OUT');
          }
        }
      }
      const after = await this.#update(context, order, { status: 'CANCELLED_BY_SHOP', endedNow: 'ADMIN', endReason: input.reason });
      await this.recorder.record(context, { order: after, type: 'cancelled_by_admin', actorType: 'ADMIN', actorId: auth.actorId, note: input.reason, operation, requestId, metadata: { delivery_ended: delivery !== undefined } });
      return after;
    }
    await assertFailedAndSettled(this.deliveries, context, order.orderId);
    const after = await this.#update(context, order, { status: 'NOT_COMPLETED', endedNow: 'ADMIN', endReason: input.reason });
    await this.recorder.record(context, { order: after, type: 'not_completed_by_admin', actorType: 'ADMIN', actorId: auth.actorId, note: input.reason, operation, requestId });
    return after;
  }

  async #update(context: TransactionContext, order: OrderRow, patch: Parameters<OrderRepository['update']>[3]): Promise<OrderRow> {
    const updated = await this.orders.update(context, order.orderId, order.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  async #view(context: TransactionContext, order: OrderRow, auth: Authorized): Promise<JsonObject> {
    const can: string[] = [];
    if (order.status === 'PREPARING') {
      const all = await this.deliveries.listOfOrder(context, order.orderId);
      const latest = all[all.length - 1];
      const picked = latest !== undefined && (latest.state === 'delivering' || latest.state === 'picked_up');
      if (auth.lock && !picked) {
        can.push('cancel-order');
      }
      if (auth.review && latest?.state === 'failed') {
        can.push('close-not-completed');
      }
    }
    return this.views.forAdmin(context, order, can);
  }

  /** The same rule as the delivery administration: SYSTEM, or an ADMIN with VIEW on the SHOP or DRIVER app; review / lock need the right on DRIVER. */
  async #authorize(context: TransactionContext, known: SessionLookup, right: Right): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      return { role, actorId: known.userId, review: true, lock: true };
    }
    const driver = rows.find((candidate) => candidate.app === 'DRIVER');
    const shop = rows.find((candidate) => candidate.app === 'SHOP');
    const mayView = (driver?.canView ?? false) || (shop?.canView ?? false);
    const review = (driver?.canView ?? false) && (driver?.canReviewProfile ?? false);
    const lock = (driver?.canView ?? false) && (driver?.canLock ?? false);
    if (!mayView || (right === 'review' && !review) || (right === 'lock' && !lock)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role, actorId: known.userId, review, lock };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, name: AdminOrderAction): Promise<true> {
    if (guard.actor_user_id !== known.userId || guard.action !== name || !isCanonicalUuid(guard.order_id)) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, RIGHT[name]);
    return true;
  }
}
