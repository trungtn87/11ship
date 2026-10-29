import { Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { ACTIVE_STATES } from '../delivery/delivery-constants';
import { DeliveryActors, ShopCaller } from '../delivery/delivery-actors';
import { DeliveryCancel } from '../delivery/delivery-cancel';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { mayRecall } from '../delivery/delivery-rules';
import { DeliveryShopService } from '../delivery/delivery-shop-service';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { requireActiveShop } from '../shop/shop-guards';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { ORDER_OPERATIONS, ORDER_SCOPE_TYPE } from './order-constants';
import { OrderRecorder } from './order-recorder';
import { OrderRepository, OrderRow } from './order-repository';
import { goodsDescriptionOf, totalOf } from './order-rules';
import { CallInput, ConfirmInput, EditInput, PaymentInput, ReasonInput, ShopListQuery, VersionInput } from './order-validation';
import { OrderViews } from './order-views';

/**
 * The shop's side of M10 (11Food): the list and detail of the Orders, editing before confirmation, confirming or refusing, the paid amount,
 * calling a Shipper (M07), cancelling the dish order and closing it as not completed. The caller is the authenticated principal only: the only identifier in a
 * path is the Order, resolved against the caller's OWN shop, so another shop's Order reads as not found.
 *
 * Each write is ONE transaction opened by the idempotency executor. The lock order is the whole system's: record -> user -> CURRENT session -> shop -> Shipper
 * (driver) -> delivery -> ORDER. A command that can touch a running delivery (cancel the dish order) takes the Shipper and the delivery BEFORE the Order, exactly
 * like the Shipper's own pickup and complete, so cancel-vs-pickup and complete-vs-cancel are decided on the delivery row and exactly one commits.
 * There is no "ready" step: "Gọi shipper" itself means the dishes are ready (Owner decision 2026-10-23).
 */
@Injectable()
export class OrderShopService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: DeliveryActors,
    private readonly orders: OrderRepository,
    private readonly recorder: OrderRecorder,
    private readonly views: OrderViews,
    private readonly deliveries: DeliveryRepository,
    private readonly deliveryShop: DeliveryShopService,
    private readonly cancelling: DeliveryCancel,
  ) {}

  // ---- reads -----------------------------------------------------------------------------------------------------------------

  async list(principal: AuthPrincipal, query: ShopListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const nowMs = await freshClockMs(context);
      const rows = await this.orders.listForShop(context, shop.shopId, { filter: query.filter, q: query.q, fromMs: query.fromMs, toMs: query.toMs }, query.limit, query.offset);
      const counts = await this.orders.countsForShop(context, shop.shopId);
      return { orders: rows.map((row) => this.views.summary(row, true, nowMs)), counts, limit: query.limit, offset: query.offset };
    });
  }

  async read(principal: AuthPrincipal, orderId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const order = await this.orders.findOfShop(context, orderId, shop.shopId);
      if (order === undefined) {
        throw new AppError('ORDER_NOT_FOUND');
      }
      return this.views.forShop(context, order, true);
    });
  }

  // ---- before confirmation ---------------------------------------------------------------------------------------------------

  /**
   * Corrects the Order before confirming it: a new quantity or unit price for a line, or removal of a line. The shop has contacted the customer first (the app
   * says so); the change is recorded with who and when, and the original lines stay visible next to the new ones. Not possible once confirmed.
   */
  async edit(principal: AuthPrincipal, orderId: string, input: EditInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.edit, key, { expected_version: input.expectedVersion, changes: input.changes.map((c) => ({ line: c.lineId, q: c.quantity, p: c.unitPriceVnd, r: c.remove })) }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PENDING_CONFIRMATION');
      const lines = new Map((await this.orders.listItems(context, orderId)).map((l) => [l.lineId, l]));
      const details: JsonObject[] = [];
      for (const change of input.changes) {
        const line = lines.get(change.lineId);
        if (line === undefined || line.removedAtMs !== null) {
          throw new AppError('ORDER_INPUT_INVALID');
        }
        const next = { quantity: change.quantity ?? line.quantity, unitPriceVnd: change.unitPriceVnd ?? line.unitPriceVnd };
        if (!change.remove && next.quantity === line.quantity && next.unitPriceVnd === line.unitPriceVnd) {
          continue;
        }
        await this.orders.updateItem(context, line.lineId, change.remove ? { remove: true } : { quantity: change.quantity ?? undefined, unitPriceVnd: change.unitPriceVnd ?? undefined });
        details.push({
          line_id: line.lineId,
          name: line.name,
          before: { quantity: line.quantity, unit_price_vnd: line.unitPriceVnd, removed: false },
          after: change.remove ? { quantity: line.quantity, unit_price_vnd: line.unitPriceVnd, removed: true } : { quantity: next.quantity, unit_price_vnd: next.unitPriceVnd, removed: false },
        });
      }
      if (details.length === 0) {
        throw new AppError('ORDER_INPUT_INVALID');
      }
      const after = await this.#itemsChanged(context, order);
      await this.recorder.record(context, {
        order: after,
        type: 'edited',
        actorType: 'SHOP',
        actorId: caller.actor.userId,
        operation: ORDER_OPERATIONS.edit,
        requestId,
        details: { changes: details, items_total_vnd: after.itemsTotalVnd },
        notify: false,
      });
      return after;
    });
  }

  /** Writes the new total the lines now add up to (the database re-checks it equals the lines at commit). */
  async #itemsChanged(context: TransactionContext, order: OrderRow): Promise<OrderRow> {
    const items = await this.orders.listItems(context, order.orderId);
    return this.#update(context, order, { itemsTotalVnd: totalOf(items.map((i) => ({ unitPriceVnd: i.unitPriceVnd, quantity: i.quantity, removed: i.removedAtMs !== null }))), editedNow: true });
  }

  /**
   * Confirms the Order: "Đang chuẩn bị". An Order without a dish is refused; an Order that was edited needs the reason (the customer sees the original, the
   * confirmed version and the reason). From here the dishes and their amount are locked (the database refuses any change).
   */
  async confirm(principal: AuthPrincipal, orderId: string, input: ConfirmInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.confirm, key, { expected_version: input.expectedVersion, change_reason: input.changeReason }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PENDING_CONFIRMATION');
      requireActiveShop(caller.shop);
      const items = await this.orders.listItems(context, orderId);
      if (order.itemsTotalVnd < 1 || !items.some((i) => i.removedAtMs === null)) {
        throw new AppError('ORDER_EMPTY');
      }
      if (order.editedAtMs !== null && (input.changeReason === null || input.changeReason.trim() === '')) {
        throw new AppError('ORDER_CHANGE_REASON_REQUIRED');
      }
      const after = await this.#update(context, order, { status: 'PREPARING', confirmedNow: true, ...(order.editedAtMs !== null ? { changeReason: input.changeReason } : {}) });
      await this.recorder.record(context, {
        order: after,
        type: 'confirmed',
        actorType: 'SHOP',
        actorId: caller.actor.userId,
        note: order.editedAtMs !== null ? input.changeReason : null,
        operation: ORDER_OPERATIONS.confirm,
        requestId,
        details: { edited: order.editedAtMs !== null, original_total_vnd: order.itemsOriginalTotalVnd, confirmed_total_vnd: after.itemsTotalVnd },
      });
      return after;
    });
  }

  /** Refuses the Order (before confirmation) with a reason the customer is told. */
  async reject(principal: AuthPrincipal, orderId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.reject, key, { expected_version: input.expectedVersion, reason: input.reason }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PENDING_CONFIRMATION');
      const after = await this.#update(context, order, { status: 'REJECTED_BY_SHOP', endedNow: 'SHOP', endReason: input.reason });
      await this.recorder.record(context, { order: after, type: 'rejected', actorType: 'SHOP', actorId: caller.actor.userId, note: input.reason, operation: ORDER_OPERATIONS.reject, requestId });
      return after;
    });
  }

  // ---- while preparing -------------------------------------------------------------------------------------------------------

  /**
   * Compatibility for the APK built before the "ready" step went away (Owner decision 2026-10-23): the old button still posts here. The caller's right to the
   * Order and its state are checked like any shop command (another shop's Order is not found, a settled one is a state conflict), and the Order comes back as it
   * is. Nothing is written and no event is recorded: "Gọi shipper" itself means the dishes are ready, and nothing depends on this call.
   */
  async readyCompat(principal: AuthPrincipal, orderId: string, input: VersionInput, key: string | readonly string[] | undefined): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.readyCompat, key, { expected_version: input.expectedVersion }, async (_context, _caller, order) => {
      this.#expect(order, input.expectedVersion, 'PREPARING');
      return order;
    });
  }

  /**
   * Records how much of the dishes was paid directly (customer to shop). It is information noted by the person allowed to note it, not proof of a bank
   * transfer, and no money moves through the app. It is fixed into a delivery when one is called, so it cannot change while a delivery is in progress.
   */
  async payment(principal: AuthPrincipal, orderId: string, input: PaymentInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.payment, key, { expected_version: input.expectedVersion, paid_vnd: input.paidVnd }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PREPARING');
      if (input.paidVnd > order.itemsTotalVnd) {
        throw new AppError('ORDER_PAYMENT_INVALID');
      }
      if ((await this.deliveries.listOfOrder(context, orderId)).some((d) => ACTIVE_STATES.includes(d.state))) {
        throw new AppError('ORDER_PAYMENT_LOCKED');
      }
      if (input.paidVnd === order.paidVnd) {
        return order;
      }
      const after = await this.#update(context, order, { paidVnd: input.paidVnd });
      await this.recorder.record(context, {
        order: after,
        type: 'payment_recorded',
        actorType: 'SHOP',
        actorId: caller.actor.userId,
        operation: ORDER_OPERATIONS.payment,
        requestId,
        details: { paid_vnd: input.paidVnd, previous_paid_vnd: order.paidVnd },
        notify: false,
      });
      return after;
    });
  }

  // ---- calling a Shipper (M07) -----------------------------------------------------------------------------------------------

  /**
   * "Gọi shipper": creates the delivery (M07) from the CONFIRMED snapshot of the Order. At most one delivery is active per Order; a new call after a stopped
   * search, a cancelled request or a failed delivery whose goods are back with the shop links to the previous one and keeps the history. While the goods are with the
   * Shipper or unknown, a new call is refused. The road distance is asked of M14 outside any transaction.
   */
  async callShipper(principal: AuthPrincipal, orderId: string, input: CallInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const routeResult = await this.#routeOf(principal, orderId);
    return this.#command(principal, orderId, ORDER_OPERATIONS.callShipper, key, { expected_version: input.expectedVersion, fee_payer: input.feePayer, agreed: input.agreedFee }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PREPARING');
      requireActiveShop(caller.shop);
      if (input.agreedFee === null && routeResult.reason !== undefined) throw new AppError(routeResult.reason);
      const all = await this.deliveries.listOfOrder(context, orderId);
      if (all.some((d) => ACTIVE_STATES.includes(d.state))) {
        throw new AppError('ORDER_STATE_CONFLICT');
      }
      const latest = all[all.length - 1];
      if (latest !== undefined && latest.state === 'failed') {
        const incident = await this.deliveries.findIncident(context, latest.deliveryId);
        if (!mayRecall(latest.state, incident?.status === 'OPEN')) {
          throw new AppError('RECALL_BLOCKED_GOODS_OUT');
        }
      }
      const items = (await this.orders.listItems(context, orderId)).filter((i) => i.removedAtMs === null);
      const delivery = await this.deliveryShop.createForOrder(context, caller, {
        orderId,
        previousDeliveryId: latest?.deliveryId ?? null,
        recipientName: order.recipientName,
        recipientPhone: order.recipientPhone,
        addressText: order.addressText,
        lat: order.addressLat,
        lng: order.addressLng,
        goodsDescription: goodsDescriptionOf(items),
        goodsValueVnd: order.itemsTotalVnd,
        paidVnd: order.paidVnd,
        feePayer: input.feePayer,
        note: order.note,
        dropoffNote: order.deliveryNote,
        agreedFee: input.agreedFee,
        estimatedDistanceM: order.feeEstimateDistanceM,
        route: routeResult.route?.leg,
        routeFrom: routeResult.route?.from,
        requestId,
      });
      // The Order row itself did not change; its version moves so that a screen showing it reloads the new call.
      const after = await this.#update(context, order, {});
      await this.recorder.record(context, {
        order: after,
        type: latest === undefined ? 'shipper_called' : 'shipper_called_again',
        actorType: 'SHOP',
        actorId: caller.actor.userId,
        operation: ORDER_OPERATIONS.callShipper,
        requestId,
        details: { delivery_id: delivery.deliveryId, delivery_code: delivery.code, previous_delivery_id: latest?.deliveryId ?? null },
        notify: false,
      });
      return after;
    });
  }

  async #routeOf(principal: AuthPrincipal, orderId: string): Promise<Awaited<ReturnType<DeliveryShopService['routeForQuote']>>> {
    if (!isCanonicalUuid(orderId)) {
      return { reason: 'ROUTE_UNAVAILABLE' };
    }
    const point = await this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const order = await this.orders.findOfShop(context, orderId, shop.shopId);
      return order === undefined ? undefined : { lat: order.addressLat, lng: order.addressLng };
    });
    return point === undefined ? { reason: 'ROUTE_UNAVAILABLE' } : this.deliveryShop.routeForQuote(principal, point.lat, point.lng);
  }

  // ---- ending ----------------------------------------------------------------------------------------------------------------

  /**
   * "Hủy đơn món": ends the Order AND the delivery that is still waiting for pickup (the Shipper's assignment ends and the commission set aside is given back).
   * After pickup it is refused (the goods are with the Shipper); while the goods of a failed delivery are with the Shipper or unknown it is refused as well.
   */
  async cancel(principal: AuthPrincipal, orderId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: ORDER_SCOPE_TYPE, scopeId: principal.userId, operationId: ORDER_OPERATIONS.shopCancel, idempotencyKey: key, logicalRequest: { order_id: orderId, expected_version: input.expectedVersion, reason: input.reason }, replay: this.#replay(principal) },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        // The delivery in progress (peeked) and its Shipper are locked BEFORE the Order, the order every other path uses.
        if ((await this.orders.findOfShop(context, orderId, caller.shop.shopId)) === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        const running = (await this.deliveries.listOfOrder(context, orderId)).find((d) => ACTIVE_STATES.includes(d.state));
        const delivery = running === undefined ? undefined : await this.deliveryShop.lockForShop(context, caller, running.deliveryId);
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined || order.shopId !== caller.shop.shopId) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        this.#expect(order, input.expectedVersion, 'PREPARING');
        await this.#assertGoodsAllowCancel(context, orderId, delivery);
        if (delivery !== undefined) {
          if (delivery.state === 'delivering' || delivery.state === 'picked_up') {
            throw new AppError('AFTER_PICKUP_NO_CANCEL');
          }
          await this.cancelling.cancel(context, { type: 'SHOP', userId: caller.actor.userId }, delivery, `Hủy đơn món: ${input.reason}`.slice(0, 300), requestId, true);
        }
        const after = await this.#update(context, order, { status: 'CANCELLED_BY_SHOP', endedNow: 'SHOP', endReason: input.reason });
        await this.recorder.record(context, {
          order: after,
          type: 'cancelled_by_shop',
          actorType: 'SHOP',
          actorId: caller.actor.userId,
          note: input.reason,
          operation: ORDER_OPERATIONS.shopCancel,
          requestId,
          metadata: { delivery_ended: delivery !== undefined },
        });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, after, true) };
      },
    );
  }

  /** The goods of a FAILED delivery stay the Shipper's responsibility until the shop settles them: until then the Order cannot be ended. */
  async #assertGoodsAllowCancel(context: TransactionContext, orderId: string, active: DeliveryRow | undefined): Promise<void> {
    if (active !== undefined) {
      return;
    }
    const all = await this.deliveries.listOfOrder(context, orderId);
    const latest = all[all.length - 1];
    if (latest?.state === 'failed') {
      const incident = await this.deliveries.findIncident(context, latest.deliveryId);
      if (!mayRecall(latest.state, incident?.status === 'OPEN')) {
        throw new AppError('RECALL_BLOCKED_GOODS_OUT');
      }
    }
  }

  /** The delivery failed and the goods were dealt with (back at the shop or handled): the shop closes the Order as "Không hoàn tất", with the reason. */
  async closeNotCompleted(principal: AuthPrincipal, orderId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#command(principal, orderId, ORDER_OPERATIONS.closeNotCompleted, key, { expected_version: input.expectedVersion, reason: input.reason }, async (context, caller, order) => {
      this.#expect(order, input.expectedVersion, 'PREPARING');
      await this.#assertFailedAndSettled(context, orderId);
      const after = await this.#update(context, order, { status: 'NOT_COMPLETED', endedNow: 'SHOP', endReason: input.reason });
      await this.recorder.record(context, { order: after, type: 'not_completed', actorType: 'SHOP', actorId: caller.actor.userId, note: input.reason, operation: ORDER_OPERATIONS.closeNotCompleted, requestId });
      return after;
    });
  }

  async #assertFailedAndSettled(context: TransactionContext, orderId: string): Promise<void> {
    await assertFailedAndSettled(this.deliveries, context, orderId);
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  /** A command that touches only the Order row: user, session, shop, then the Order, in one idempotent transaction. */
  #command(
    principal: AuthPrincipal,
    orderId: string,
    operation: string,
    key: string | readonly string[] | undefined,
    logical: JsonObject,
    run: (context: TransactionContext, caller: ShopCaller, order: OrderRow) => Promise<OrderRow>,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: ORDER_SCOPE_TYPE, scopeId: principal.userId, operationId: operation, idempotencyKey: key, logicalRequest: { order_id: orderId, ...logical }, replay: this.#replay(principal) },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const order = await this.orders.lockById(context, orderId);
        if (order === undefined || order.shopId !== caller.shop.shopId) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        const after = await run(context, caller, order);
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, after, true) };
      },
    );
  }

  #expect(order: OrderRow, expectedVersion: number, status: OrderRow['status']): void {
    if (order.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT');
    }
    if (order.status !== status) {
      throw new AppError('ORDER_STATE_CONFLICT');
    }
  }

  async #update(context: TransactionContext, order: OrderRow, patch: Parameters<OrderRepository['update']>[3]): Promise<OrderRow> {
    const updated = await this.orders.update(context, order.orderId, order.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  /** A replay answers only after the CURRENT session, the SHOP context and the shop are authorized again under the same locks. */
  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        await this.actors.shopWriter(context, principal);
        return true;
      },
    };
  }
}

/** The latest delivery of the Order failed and its goods incident is closed (the shop has the goods or they were dealt with). Shared with the Admin path. */
export async function assertFailedAndSettled(deliveries: DeliveryRepository, context: TransactionContext, orderId: string): Promise<void> {
  const all = await deliveries.listOfOrder(context, orderId);
  const latest = all[all.length - 1];
  if (latest === undefined || latest.state !== 'failed' || all.some((d) => ACTIVE_STATES.includes(d.state))) {
    throw new AppError('ORDER_STATE_CONFLICT');
  }
  const incident = await deliveries.findIncident(context, latest.deliveryId);
  if (incident === undefined || incident.status === 'OPEN') {
    throw new AppError('RECALL_BLOCKED_GOODS_OUT');
  }
}

