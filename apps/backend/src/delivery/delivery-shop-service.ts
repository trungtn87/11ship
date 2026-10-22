import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { DriverRepository } from '../driver/driver-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { requireActiveShop } from '../shop/shop-guards';
import { AgreementOutcome, ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { CommissionHoldService } from '../wallet/commission-hold-service';
import { DELIVERY_SCOPE_TYPE, OPERATIONS } from './delivery-constants';
import { DeliveryActors, ShopCaller } from './delivery-actors';
import { ORDER_DELIVERY_PORT, OrderDeliveryPort } from './delivery-order-port';
import { DeliveryCancel } from './delivery-cancel';
import { DeliveryRecorder } from './delivery-recorder';
import { DeliveryRepository, DeliveryRow, NewDelivery } from './delivery-repository';
import { dropoffAreaOf, mayRecall, newDeliveryCode } from './delivery-rules';
import { CreateDeliveryInput, CustodyInput, ReasonInput, ShopListQuery, VersionInput } from './delivery-validation';
import { DeliveryViews } from './delivery-views';
import { M14RouteClient, RouteLeg } from './m14-route-client';

const LIST_LIMIT = 50;

interface Pickup {
  readonly lat: number;
  readonly lng: number;
}

/** What an Order hands to M07 when the shop calls a Shipper for it (the Order's confirmed snapshot). */
export interface OrderCallSpec {
  readonly orderId: string;
  readonly previousDeliveryId: string | null;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly addressText: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly feePayer: 'CUSTOMER' | 'SHOP';
  readonly note: string | null;
  readonly agreedFee: { reasonCode: import('../shipping-policy/shipping-fee-agreement').AgreementReason; reasonNote: string | null; amountVnd: number } | null;
  readonly route: RouteLeg | undefined;
  readonly routeFrom: Pickup | undefined;
  readonly requestId: string;
}

/**
 * The shop's side of M07 (11Food): call a Shipper, follow the request, cancel it before pickup, call again, answer a Shipper's fee counter-offer,
 * and settle the goods after a failed delivery. The caller is the authenticated principal only: there is no shop id, driver id, state or fee mode in
 * any path or body that a client could use to reach another shop's delivery.
 *
 * Each write is ONE transaction opened by the idempotency executor: record -> user row -> CURRENT session row -> shop (membership, shop) -> the
 * Shipper (driver) row when one holds the delivery -> the delivery row -> assignment -> wallet hold -> writes -> timeline -> audit -> outbox -> the
 * executor's record. The Shipper row is taken BEFORE the delivery row on every path (shop, Shipper, Admin, sweeper), so no two paths wait on each
 * other. A road distance is asked of M14 OUTSIDE any transaction. The transition that wins is decided by the delivery row: cancel and pickup race
 * on it and exactly one commits.
 */
@Injectable()
export class DeliveryShopService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: DeliveryActors,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly views: DeliveryViews,
    private readonly recorder: DeliveryRecorder,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly commission: CommissionHoldService,
    private readonly cancelling: DeliveryCancel,
    private readonly routes: M14RouteClient,
    @Inject(ORDER_DELIVERY_PORT) private readonly orders: OrderDeliveryPort,
  ) {}

  // ---- reads -----------------------------------------------------------------------------------------------------------------

  async list(principal: AuthPrincipal, query: ShopListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const nowMs = await freshClockMs(context);
      const rows = await this.deliveries.listForShop(context, shop.shopId, query.scope, query.q, query.limit, { filter: query.filter, fromMs: query.fromMs, toMs: query.toMs, offset: query.offset });
      return { deliveries: await Promise.all(rows.map((row) => this.views.forShop(context, row, nowMs, false))) };
    });
  }

  async read(principal: AuthPrincipal, deliveryId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      const delivery = await this.deliveries.findOfShop(context, deliveryId, shop.shopId);
      if (delivery === undefined) {
        throw new AppError('DELIVERY_NOT_FOUND');
      }
      return this.views.forShop(context, delivery, await freshClockMs(context), true);
    });
  }

  // ---- create / recall -------------------------------------------------------------------------------------------------------

  /** A direct call for an order outside the app: no Order record is created. The pickup is the shop's own position. */
  async create(principal: AuthPrincipal, input: CreateDeliveryInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const route = await this.routeFor(principal, input.lat, input.lng);
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.create,
        idempotencyKey: key,
        logicalRequest: {
          recipient_name: input.recipientName,
          recipient_phone: input.recipientPhone,
          address: input.addressText,
          lat: input.lat,
          lng: input.lng,
          goods: input.goodsDescription,
          value_vnd: input.goodsValueVnd,
          paid_vnd: input.paidVnd,
          fee_payer: input.feePayer,
          note: input.note,
          agreed_reason: input.agreedFee?.reasonCode ?? null,
          agreed_note: input.agreedFee?.reasonNote ?? null,
          agreed_amount: input.agreedFee?.amountVnd ?? null,
        },
        replay: this.#replay(principal),
      },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const created = await this.#createDelivery(context, caller, {
          source: 'DIRECT',
          orderId: null,
          previousDeliveryId: null,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          addressText: input.addressText,
          lat: input.lat,
          lng: input.lng,
          goodsDescription: input.goodsDescription,
          goodsValueVnd: input.goodsValueVnd,
          paidVnd: input.paidVnd,
          feePayer: input.feePayer,
          note: input.note,
          agreedFee: input.agreedFee,
          route: route?.leg,
          routeFrom: route?.from,
          requestId,
        });
        return { status: 201, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, created, await freshClockMs(context), true) };
      },
    );
  }

  /**
   * A call from a CONFIRMED order (M10), inside the transaction of the Order command (the caller holds the shop and the Order locked). The pickup is the
   * shop's own position, the goods are the Order's confirmed dishes, and the delivery is linked to the Order (and to the previous call, if any).
   */
  createForOrder(context: TransactionContext, caller: ShopCaller, spec: OrderCallSpec): Promise<DeliveryRow> {
    return this.#createDelivery(context, caller, { ...spec, source: 'ORDER' });
  }

  /**
   * A new delivery for the same goods after the old one stopped, was cancelled, or failed with the goods back at the shop (or dealt with). The old one
   * stays in the history; the new one is linked to it and gets a fresh 30-minute search. While the goods are with the Shipper or unknown it is refused.
   */
  async recall(principal: AuthPrincipal, deliveryId: string, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const old = await this.transactions.withTransaction(async (context) => {
      const { shop } = await this.actors.shopReader(context, principal);
      return { delivery: await this.deliveries.findOfShop(context, deliveryId, shop.shopId), shop };
    });
    if (old.delivery === undefined) {
      throw new AppError('DELIVERY_NOT_FOUND');
    }
    const route = await this.routeFor(principal, old.delivery.dropoffLat, old.delivery.dropoffLng);
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: OPERATIONS.recall, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId }, replay: this.#replay(principal) },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const previous = await this.deliveries.lockById(context, deliveryId);
        if (previous === undefined || previous.shopId !== caller.shop.shopId) {
          throw new AppError('DELIVERY_NOT_FOUND');
        }
        if (previous.orderId !== null) {
          // The Order must still be running (confirmed, not ended) for a new call; it is locked after the delivery, like every other path.
          await this.orders.assertMayCall(context, previous.orderId, caller.shop.shopId);
        }
        const incident = await this.deliveries.findIncident(context, deliveryId);
        if (!mayRecall(previous.state, incident?.status === 'OPEN')) {
          throw new AppError(previous.state === 'failed' ? 'RECALL_BLOCKED_GOODS_OUT' : 'DELIVERY_STATE_CONFLICT');
        }
        const agreement = await this.agreements.readByDelivery(context, previous.deliveryId);
        const created = await this.#createDelivery(context, caller, {
          source: previous.source,
          orderId: previous.orderId,
          previousDeliveryId: previous.deliveryId,
          recipientName: previous.recipientName,
          recipientPhone: previous.recipientPhone,
          addressText: previous.dropoffAddressText,
          lat: previous.dropoffLat,
          lng: previous.dropoffLng,
          goodsDescription: previous.goodsDescription,
          goodsValueVnd: previous.goodsValueVnd,
          paidVnd: previous.paidVnd,
          feePayer: previous.feePayer,
          note: previous.note,
          agreedFee:
            agreement !== undefined && agreement.feeMode === 'AGREED' && agreement.reasonCode !== null && agreement.proposedFeeVnd !== null
              ? { reasonCode: agreement.reasonCode, reasonNote: agreement.reasonNote, amountVnd: agreement.proposedFeeVnd }
              : null,
          route: route?.leg,
          routeFrom: route?.from,
          requestId,
        });
        return { status: 201, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, created, await freshClockMs(context), true) };
      },
    );
  }

  /** Asks M14 for the road distance shop -> drop-off, outside any transaction. Undefined when there is no drop-off position, no pickup position or no route. */
  async routeFor(principal: AuthPrincipal, lat: number | null, lng: number | null): Promise<{ leg: RouteLeg; from: Pickup } | undefined> {
    if (lat === null || lng === null) {
      return undefined;
    }
    const shop = await this.transactions.withTransaction((context) => this.actors.shopReader(context, principal));
    if (shop.shop.pickupLat === null || shop.shop.pickupLng === null) {
      return undefined;
    }
    const from = { lat: shop.shop.pickupLat, lng: shop.shop.pickupLng };
    const leg = await this.routes.route(from, { lat, lng });
    return leg === undefined ? undefined : { leg, from };
  }

  async #createDelivery(
    context: TransactionContext,
    caller: ShopCaller,
    spec: {
      source: 'DIRECT' | 'ORDER';
      orderId: string | null;
      previousDeliveryId: string | null;
      recipientName: string;
      recipientPhone: string;
      addressText: string;
      lat: number | null;
      lng: number | null;
      goodsDescription: string;
      goodsValueVnd: number;
      paidVnd: number;
      feePayer: 'CUSTOMER' | 'SHOP';
      note: string | null;
      agreedFee: { reasonCode: import('../shipping-policy/shipping-fee-agreement').AgreementReason; reasonNote: string | null; amountVnd: number } | null;
      route: RouteLeg | undefined;
      routeFrom: Pickup | undefined;
      requestId: string;
    },
  ): Promise<DeliveryRow> {
    const shop = caller.shop;
    requireActiveShop(shop);
    if (shop.pickupLat === null || shop.pickupLng === null) {
      // The pickup is the shop's own position (M02): without it there is nowhere to pick up from.
      throw new AppError('SHOP_PROFILE_INCOMPLETE');
    }
    // A distance measured from another position (the shop moved while the route was computed) is not used: the fee then stays unknown.
    const route = spec.route !== undefined && spec.routeFrom !== undefined && spec.routeFrom.lat === shop.pickupLat && spec.routeFrom.lng === shop.pickupLng ? spec.route : undefined;
    const hasPoint = spec.lat !== null && spec.lng !== null;
    const feeMode = spec.agreedFee !== null ? 'AGREED' : hasPoint ? 'STANDARD' : 'PICKUP_AGREEMENT';
    const deliveryId = randomUUID();
    const base: NewDelivery = {
      deliveryId,
      code: newDeliveryCode(),
      source: spec.source,
      orderId: spec.orderId,
      previousDeliveryId: spec.previousDeliveryId,
      shopId: shop.shopId,
      requestedBy: caller.actor.userId,
      shopName: shop.name,
      shopPhone: shop.contactPhoneNormalized,
      pickupAddressText: shop.addressText,
      pickupLat: shop.pickupLat,
      pickupLng: shop.pickupLng,
      recipientName: spec.recipientName,
      recipientPhone: spec.recipientPhone,
      dropoffAddressText: spec.addressText,
      dropoffAreaText: dropoffAreaOf(spec.addressText),
      dropoffLat: spec.lat,
      dropoffLng: spec.lng,
      goodsDescription: spec.goodsDescription,
      goodsValueVnd: spec.goodsValueVnd,
      paidVnd: spec.paidVnd,
      note: spec.note,
      feeMode,
      feePayer: spec.feePayer,
      feeVnd: null,
      routeDistanceM: route?.distanceM ?? null,
    };
    let inserted = false;
    for (let attempt = 0; attempt < 6 && !inserted; attempt += 1) {
      inserted = await this.deliveries.insert(context, attempt === 0 ? base : { ...base, code: newDeliveryCode() });
    }
    if (!inserted) {
      throw new TechnicalError('internal', 'Could not allocate a delivery code');
    }
    let delivery = await this.#reread(context, deliveryId);
    const nowMs = await freshClockMs(context);
    const common = { deliveryId, payer: spec.feePayer, distanceM: route?.distanceM ?? null, createdBy: caller.actor.userId, expiresAtMs: delivery.searchExpiresAtMs, requestId: randomUUID(), nowMs };
    if (spec.agreedFee !== null) {
      const outcome = await this.agreements.createAgreed(context, { ...common, reasonCode: spec.agreedFee.reasonCode, reasonNote: spec.agreedFee.reasonNote, proposedFeeVnd: spec.agreedFee.amountVnd });
      if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
        throw new AppError('DELIVERY_INPUT_INVALID');
      }
    } else if (feeMode === 'STANDARD') {
      const outcome = await this.agreements.createStandard(context, common);
      const fee = feeOf(outcome);
      if (fee !== undefined) {
        delivery = await this.#update(context, delivery, { feeVnd: fee });
      }
      // 'unpriced' (no route, beyond the last band, no fee table): the fee stays NULL and the mode stays STANDARD. Nothing is guessed or swapped.
    }
    await this.recorder.record(context, {
      delivery,
      type: spec.previousDeliveryId === null ? 'created' : 'recalled',
      actorType: 'SHOP',
      actorId: caller.actor.userId,
      note: spec.previousDeliveryId === null ? null : `Gọi lại từ ${spec.previousDeliveryId}`,
      operation: spec.previousDeliveryId === null ? OPERATIONS.create : OPERATIONS.recall,
      requestId: spec.requestId,
      metadata: { fee_mode: feeMode, source: spec.source },
    });
    return delivery;
  }

  // ---- cancel ----------------------------------------------------------------------------------------------------------------

  /**
   * "Hủy yêu cầu giao": ends the request, ends the Shipper's assignment if there is one and gives the commission back. The food order is not touched.
   * Before pickup only; after it the transition is refused (AFTER_PICKUP_NO_CANCEL) whatever the app shows.
   */
  async cancel(principal: AuthPrincipal, deliveryId: string, input: ReasonInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.cancel,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, reason: input.reason, expected_version: input.expectedVersion },
        replay: this.#replay(principal),
      },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const delivery = await this.lockForShop(context, caller, deliveryId);
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.cancelling.cancel(context, { type: 'SHOP', userId: caller.actor.userId }, delivery, input.reason, requestId, false);
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, after, await freshClockMs(context), true) };
      },
    );
  }

  // ---- fee agreement (the shop's part) ---------------------------------------------------------------------------------------

  counterAccept(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#feeCommand(principal, deliveryId, input, key, requestId, OPERATIONS.counterAccept, { type: 'SHOP_ACCEPT_COUNTER' }, 'fee_counter_accepted');
  }

  counterReject(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#feeCommand(principal, deliveryId, input, key, requestId, OPERATIONS.counterReject, { type: 'SHOP_REJECT_COUNTER' }, 'fee_counter_rejected');
  }

  /** The customer has no app yet: the shop records that the customer agreed to the amount (audited as such). */
  customerConfirm(principal: AuthPrincipal, deliveryId: string, input: VersionInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.#feeCommand(principal, deliveryId, input, key, requestId, OPERATIONS.customerConfirm, { type: 'CUSTOMER_CONFIRM', approve: true }, 'fee_customer_confirmed');
  }

  async #feeCommand(
    principal: AuthPrincipal,
    deliveryId: string,
    input: VersionInput,
    key: string | readonly string[] | undefined,
    requestId: string,
    operation: string,
    action: import('../shipping-policy/shipping-fee-agreement').AgreementAction,
    change: string,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: DELIVERY_SCOPE_TYPE, scopeId: principal.userId, operationId: operation, idempotencyKey: key, logicalRequest: { delivery_id: deliveryId, expected_version: input.expectedVersion }, replay: this.#replay(principal) },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const delivery = await this.lockForShop(context, caller, deliveryId);
        if (delivery.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (delivery.state !== 'waiting_driver' && delivery.state !== 'accepted' && delivery.state !== 'location_confirmed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const agreement = await this.agreements.readByDelivery(context, deliveryId);
        if (agreement === undefined) {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const outcome = await this.agreements.act(context, {
          agreementId: agreement.agreementId,
          expectedVersion: agreement.version,
          requestId: randomUUID(),
          nowMs: await freshClockMs(context),
          action,
          actorUserId: caller.actor.userId,
        });
        if (outcome.kind === 'conflict') {
          throw new AppError('VERSION_CONFLICT');
        }
        if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        let after = delivery;
        if (outcome.agreement.finalFeeVnd !== null && delivery.feeVnd === null) {
          after = await this.#update(context, delivery, { feeVnd: outcome.agreement.finalFeeVnd });
        } else {
          after = await this.#update(context, delivery, {});
        }
        await this.recorder.record(context, { delivery: after, type: change, actorType: 'SHOP', actorId: caller.actor.userId, operation, requestId, metadata: { agreement_status: outcome.agreement.status } });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, after, await freshClockMs(context), true) };
      },
    );
  }

  // ---- goods after a failed delivery -----------------------------------------------------------------------------------------

  /**
   * The shop settles the goods of a failed delivery: they are back at the shop (a new call becomes possible) or they were dealt with and no new delivery
   * is made (the incident is closed with a note). Until then the goods stay with whoever holds them and a new call for them is refused.
   */
  async resolveCustody(principal: AuthPrincipal, deliveryId: string, input: CustodyInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: DELIVERY_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: OPERATIONS.custody,
        idempotencyKey: key,
        logicalRequest: { delivery_id: deliveryId, resolution: input.resolution, note: input.note },
        replay: this.#replay(principal),
      },
      async (context) => {
        const caller = await this.actors.shopWriter(context, principal);
        const delivery = await this.lockForShop(context, caller, deliveryId);
        const incident = await this.deliveries.lockIncident(context, deliveryId);
        if (delivery.state !== 'failed' || incident === undefined || incident.status !== 'OPEN') {
          throw new AppError('DELIVERY_STATE_CONFLICT');
        }
        const custody = input.resolution === 'GOODS_RETURNED' ? 'SHOP' : 'HANDLED';
        if (!(await this.deliveries.closeIncident(context, incident.incidentId, incident.version, custody, caller.actor.userId, input.note))) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.#update(context, delivery, {});
        await this.recorder.record(context, {
          delivery: after,
          type: input.resolution === 'GOODS_RETURNED' ? 'goods_returned' : 'goods_handled',
          actorType: 'SHOP',
          actorId: caller.actor.userId,
          assignmentId: incident.assignmentId,
          driverId: incident.driverId,
          note: input.note,
          operation: OPERATIONS.custody,
          requestId,
          metadata: { custody },
        });
        return { status: 200, replayGuard: { user_id: caller.actor.userId }, payload: await this.views.forShop(context, after, await freshClockMs(context), true) };
      },
    );
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  /**
   * Locks in the global order: the Shipper holding the delivery (peeked without a lock) FIRST, then the delivery. If the Shipper changed between the
   * peek and the lock, nothing is done and the shop reloads (DELIVERY_STATE_CONFLICT).
   */
  async lockForShop(context: TransactionContext, caller: ShopCaller, deliveryId: string): Promise<DeliveryRow> {
    const peek = await this.deliveries.findOfShop(context, deliveryId, caller.shop.shopId);
    if (peek === undefined) {
      throw new AppError('DELIVERY_NOT_FOUND');
    }
    const peeked = await this.deliveries.findActiveAssignment(context, deliveryId);
    if (peeked !== undefined) {
      await this.drivers.lockById(context, peeked.driverId);
    }
    const delivery = await this.deliveries.lockById(context, deliveryId);
    if (delivery === undefined || delivery.shopId !== caller.shop.shopId) {
      throw new AppError('DELIVERY_NOT_FOUND');
    }
    const current = await this.deliveries.findActiveAssignment(context, deliveryId);
    if (current?.driverId !== peeked?.driverId) {
      throw new AppError('DELIVERY_STATE_CONFLICT');
    }
    return delivery;
  }

  async #update(context: TransactionContext, delivery: DeliveryRow, patch: Parameters<DeliveryRepository['update']>[3]): Promise<DeliveryRow> {
    const updated = await this.deliveries.update(context, delivery.deliveryId, delivery.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  async #reread(context: TransactionContext, deliveryId: string): Promise<DeliveryRow> {
    const row = await this.deliveries.findById(context, deliveryId);
    if (row === undefined) {
      throw new TechnicalError('internal', 'Delivery vanished after insert');
    }
    return row;
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

function feeOf(outcome: AgreementOutcome): number | undefined {
  return (outcome.kind === 'ok' || outcome.kind === 'replayed') && outcome.agreement.finalFeeVnd !== null ? outcome.agreement.finalFeeVnd : undefined;
}
