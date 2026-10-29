import { businessHoursRefreshMs } from '../shop/business-hours-refresh';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CUSTOMER_ROLE } from '../auth/auth-constants';
import { AuthPrincipal } from '../auth/auth-principal';
import { UserRepository } from '../auth/user-repository';
import { ClientActor, ClientSessionAuthority } from '../client-auth/client-session-authority';
import { AppError, TechnicalError } from '../common/app-errors';
import { CustomersService } from '../customers/customers-service';
import { M14RouteClient, RouteResult } from '../delivery/m14-route-client';
import { ShopSetupGate } from '../shop-setup/shop-setup-gate';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { MenuRepository, MenuItemRow } from '../menu/menu-repository';
import { ShippingFeeAgreementService } from '../shipping-policy/shipping-fee-agreement-service';
import { ShopAvailabilityReader, ShopSnapshot } from '../shop/shop-availability-reader';
import { ShopRepository } from '../shop/shop-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { IssueCode, MAX_LINE_QUANTITY, ORDER_OPERATIONS, ORDER_SCOPE_TYPE } from './order-constants';
import { OrderRecorder } from './order-recorder';
import { NewItem, OrderRepository, OrderRow } from './order-repository';
import { customerMayCancel, mergeCartLines, newOrderCode, scheduleInWindow, totalOf } from './order-rules';
import { CancelInput, CartInput, CheckoutInput, CustomerListQuery, LineInput, PlaceInput, ReorderInput } from './order-validation';
import { OrderViews } from './order-views';

interface ResolvedLine {
  readonly itemId: string;
  readonly name: string | null;
  readonly note: string | null;
  readonly quantity: number;
  /** The price in force NOW (null when the dish is not available). */
  readonly priceVnd: number | null;
  readonly issue: IssueCode | null;
}

interface PreparedCheckout {
  readonly pickup: { readonly lat: number; readonly lng: number } | null;
  readonly point: { readonly lat: number; readonly lng: number } | null;
}

type CheckedAddress = { text: string; lat: number | null; lng: number | null; sourceId: string | null };

type QuoteReason = 'PICKUP_PIN_MISSING' | 'DROPOFF_PIN_MISSING' | 'ROUTE_UNAVAILABLE' | 'ROUTE_TIMEOUT' | 'POLICY_NOT_CONFIGURED' | 'OUT_OF_PRICE_RANGE';
interface CheckoutQuote { readonly status: 'PRICED' | 'UNAVAILABLE'; readonly distanceM: number | null; readonly feeVnd: number | null; readonly reason: QuoteReason | null; readonly policyVersion: number | null; readonly snapshot: string; readonly quotedAtMs: number }

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * The customer's side of M10 (11Food): the cart, the check before sending, the Order, cancelling it before the shop confirms, the list and the detail, and
 * ordering again. The caller is the authenticated principal only: no user id, customer id, status, price total or version of someone else's record arrives
 * from a client. Every write that counts runs in ONE transaction opened by the idempotency executor: record -> user row -> CURRENT session row -> the shop
 * (FOR SHARE) -> the dishes (FOR SHARE, in id order) -> the Order. The server re-reads the shop, its hours, the dishes and their prices when the Order is sent;
 * a changed price or a dish that is no longer sold is never replaced silently: the customer is told to check and send again.
 */
@Injectable()
export class OrderCustomerService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly authority: ClientSessionAuthority,
    private readonly users: UserRepository,
    private readonly orders: OrderRepository,
    private readonly recorder: OrderRecorder,
    private readonly views: OrderViews,
    private readonly menu: MenuRepository,
    private readonly shopRepo: ShopRepository,
    private readonly shopReader: ShopAvailabilityReader,
    private readonly customers: CustomersService,
    private readonly agreements: ShippingFeeAgreementService,
    private readonly routes: M14RouteClient,
    private readonly setupGate: ShopSetupGate,
  ) {}

  // ---- the caller ------------------------------------------------------------------------------------------------------------

  /** The ordering account: a CUSTOMER of the 11Food app, re-checked under the locks of THIS transaction. */
  async #customer(context: TransactionContext, principal: AuthPrincipal, mode: 'update' | 'share'): Promise<ClientActor> {
    const actor = await this.authority.lock(context, principal, mode);
    if (actor.app !== 'FOOD' || !(await this.users.hasRole(context, actor.userId, CUSTOMER_ROLE))) {
      throw new AppError('ROLE_NOT_AVAILABLE');
    }
    return actor;
  }

  #replay(principal: AuthPrincipal) {
    return {
      kind: 'sensitive' as const,
      authorize: async (context: TransactionContext, guard: JsonObject): Promise<true> => {
        if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId) {
          throw new TechnicalError('internal', 'Invalid replay guard');
        }
        await this.#customer(context, principal, 'update');
        return true;
      },
    };
  }

  // ---- the cart --------------------------------------------------------------------------------------------------------------

  /** The cart as the server sees it NOW: current names, prices and availability. Nothing in it is a price that was agreed. */
  async readCart(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const cart = await this.orders.findCart(context, actor.userId);
      if (cart === undefined) {
        return { cart: null };
      }
      return { cart: await this.#cartView(context, cart.shopId, cart.lines, cart.note, cart.version) };
    });
  }

  async #cartView(context: TransactionContext, shopId: string, lines: readonly { itemId: string; quantity: number; note: string | null; name: string }[], note: string | null, version: number): Promise<JsonObject> {
    const snapshot = await this.shopReader.snapshotOfShop(context, shopId);
    // Issue #190: a shop that is not set up (no schedule, no pickup point, no sellable dish) or is locked is not orderable, whatever its old status says.
    const gate = snapshot === undefined ? undefined : await this.setupGate.evaluate(context, snapshot);
    const dishes = new Map((await this.menu.listPublicItems(context, shopId)).map((d) => [d.itemId, d]));
    const out: JsonObject[] = [];
    let total = 0;
    // The cart has no destination: entry tier of the active M06 policy is only a provisional reference.
    const baseQuote = await this.agreements.estimate(context, 0);
    for (const line of lines) {
      const dish = gate?.publicVisible === true ? dishes.get(line.itemId) : undefined;
      if (dish !== undefined) {
        total += dish.priceVnd * line.quantity;
      }
      out.push({
        item_id: line.itemId,
        name: dish?.name ?? line.name,
        price_vnd: dish?.priceVnd ?? null,
        quantity: line.quantity,
        note: line.note,
        available: dish !== undefined,
        issue: dish === undefined ? 'ITEM_UNAVAILABLE' : null,
      });
    }
    return {
      next_refresh_ms: snapshot === undefined ? null : businessHoursRefreshMs(snapshot.hours, snapshot.availability.evaluatedAt),
      shop: { shop_id: shopId, name: snapshot?.name ?? null, online: gate?.acceptsOrders === true, reason: snapshot === undefined || gate === undefined ? 'SHOP_NOT_FOUND' : snapshot.status === 'ACTIVE' ? gate.availability.reason : 'SHOP_DISABLED' },
      lines: out,
      note,
      items_total_vnd: total,
      fee_estimate_vnd: baseQuote.status === 'PRICED' ? baseQuote.feeVnd : null,
      version,
    };
  }

  /** Replaces the whole cart (one shop, merged lines). The dishes must be of that shop and on sale now; the stored name is only a label. */
  async replaceCart(principal: AuthPrincipal, input: CartInput): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'update');
      const snapshot = await this.shopReader.snapshotOfShop(context, input.shopId);
      if (snapshot === undefined || snapshot.status !== 'ACTIVE' || !(await this.setupGate.evaluate(context, snapshot)).publicVisible) {
        throw new AppError('ORDER_SHOP_NOT_OPEN');
      }
      const merged = this.#merge(input.lines);
      const dishes = new Map((await this.menu.listPublicItems(context, input.shopId)).map((d) => [d.itemId, d]));
      const stored = merged.map((line) => {
        const dish = dishes.get(line.itemId);
        if (dish === undefined) {
          throw new AppError('ORDER_CART_CHANGED');
        }
        return { itemId: line.itemId, quantity: line.quantity, note: line.note, name: dish.name };
      });
      const row = await this.orders.upsertCart(context, actor.userId, input.shopId, stored, input.note);
      return { cart: await this.#cartView(context, row.shopId, row.lines, row.note, row.version) };
    });
  }

  async clearCart(principal: AuthPrincipal): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'update');
      await this.orders.deleteCart(context, actor.userId);
      return { cart: null };
    });
  }

  #merge(lines: readonly LineInput[]) {
    const merged = mergeCartLines(lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, note: l.note })));
    if (merged.some((l) => l.quantity > MAX_LINE_QUANTITY)) {
      throw new AppError('ORDER_INPUT_INVALID');
    }
    return merged;
  }

  // ---- the check before sending ----------------------------------------------------------------------------------------------

  /** Reads the places the fee estimate needs (the shop's pickup and the delivery pin) so the route can be asked of M14 OUTSIDE any transaction. */
  async #prepare(principal: AuthPrincipal, input: CheckoutInput): Promise<PreparedCheckout> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const snapshot = await this.shopReader.snapshotOfShop(context, input.shopId);
      let point: { lat: number; lng: number } | null = null;
      if (input.address.addressId !== null) {
        const found = await this.customers.findAddressForOrder(context, actor.userId, input.address.addressId);
        point = found?.latitude != null && found.longitude != null ? { lat: found.latitude, lng: found.longitude } : null;
      } else if (input.address.lat !== null && input.address.lng !== null) {
        point = { lat: input.address.lat, lng: input.address.lng };
      }
      const pickup = snapshot?.pickupLat != null && snapshot.pickupLng != null ? { lat: snapshot.pickupLat, lng: snapshot.pickupLng } : null;
      return { pickup, point };
    });
  }

  async #route(prepared: PreparedCheckout): Promise<RouteResult | null> {
    return prepared.pickup === null || prepared.point === null ? null : this.routes.routeResult(prepared.pickup, prepared.point);
  }

  /**
   * POST .../orders/preview : what the checkout shows. Never writes. Lists every reason the Order could not be sent right now (a dish gone, a closed shop, a wanted
   * time outside the hours, an unknown address) and the fee estimate of M06 when the pin and the route allow one (otherwise "chưa xác định", never 0).
   */
  async preview(principal: AuthPrincipal, input: CheckoutInput): Promise<JsonObject> {
    const prepared = await this.#prepare(principal, input);
    const leg = await this.#route(prepared);
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const checked = await this.#check(context, actor, input, null, false);
      const estimate = await this.#estimate(context, checked.shop, checked.address, prepared, leg);
      const lines = checked.lines.map((l) => ({ item_id: l.itemId, name: l.name, note: l.note, quantity: l.quantity, unit_price_vnd: l.priceVnd, issue: l.issue }));
      const total = totalOf(checked.lines.filter((l) => l.priceVnd !== null).map((l) => ({ unitPriceVnd: l.priceVnd as number, quantity: l.quantity })));
      return {
        next_refresh_ms: checked.shop === undefined ? null : businessHoursRefreshMs(checked.shop.hours, checked.shop.availability.evaluatedAt),
        ok: checked.blockers.length === 0 && checked.lines.every((l) => l.issue === null),
        blockers: checked.blockers,
        shop: { shop_id: input.shopId, name: checked.shop?.name ?? null, online: checked.shop?.status === 'ACTIVE' && checked.shop.availability.online },
        lines,
        items_total_vnd: total,
        fee: this.#quoteView(estimate),
        expected_total_vnd: estimate.feeVnd === null ? null : total + estimate.feeVnd,
        server_now: iso(await freshClockMs(context)),
      };
    });
  }

  async #estimate(context: TransactionContext, shop: ShopSnapshot | undefined, address: CheckedAddress | null, prepared: PreparedCheckout, route: RouteResult | null): Promise<CheckoutQuote> {
    const quotedAtMs = await freshClockMs(context);
    const currentPickup = shop?.pickupLat != null && shop.pickupLng != null ? { lat: shop.pickupLat, lng: shop.pickupLng } : null;
    const currentPoint = address?.lat != null && address.lng != null ? { lat: address.lat, lng: address.lng } : null;
    const snapshot = `${currentPickup?.lat ?? 'x'},${currentPickup?.lng ?? 'x'}>${currentPoint?.lat ?? 'x'},${currentPoint?.lng ?? 'x'}`;
    const unavailable = (reason: QuoteReason | null, distanceM: number | null = null, policyVersion: number | null = null): CheckoutQuote => ({ status: 'UNAVAILABLE', distanceM, feeVnd: null, reason, policyVersion, snapshot, quotedAtMs });
    if (currentPickup === null) return unavailable('PICKUP_PIN_MISSING');
    if (currentPoint === null) return unavailable('DROPOFF_PIN_MISSING');
    // The route belongs only to the coordinates captured before its HTTP call.
    // A concurrent edit makes this preview neutral and makes place() reject it;
    // the old leg must never be priced or persisted against the new snapshot.
    if (!this.#samePoint(prepared.pickup, currentPickup) || !this.#samePoint(prepared.point, currentPoint)) return unavailable(null);
    if (route === null || route.status === 'UNAVAILABLE') return unavailable(route?.reason === 'ROUTE_TIMEOUT' ? 'ROUTE_TIMEOUT' : 'ROUTE_UNAVAILABLE');
    const quote = await this.agreements.estimate(context, route.leg.distanceM);
    if (quote.status === 'PRICED') return { status: 'PRICED', feeVnd: quote.feeVnd, distanceM: route.leg.distanceM, reason: null, policyVersion: quote.policyVersionNo, snapshot, quotedAtMs };
    return unavailable(quote.reason === 'POLICY_NOT_CONFIGURED' ? 'POLICY_NOT_CONFIGURED' : quote.reason === 'OUT_OF_PRICE_RANGE' ? 'OUT_OF_PRICE_RANGE' : 'ROUTE_UNAVAILABLE', route.leg.distanceM);
  }

  #samePoint(left: { readonly lat: number; readonly lng: number } | null, right: { readonly lat: number; readonly lng: number } | null): boolean {
    return left !== null && right !== null && left.lat === right.lat && left.lng === right.lng;
  }

  #quoteView(q: CheckoutQuote): JsonObject {
    return { status: q.status, distance_m: q.distanceM, fee_vnd: q.feeVnd, estimate_vnd: q.feeVnd, reason: q.reason, version: q.policyVersion, policy_version: q.policyVersion, snapshot: q.snapshot, quoted_at: iso(q.quotedAtMs) };
  }

  /**
   * The shared check of a checkout against what the server holds NOW: the shop (status, hours, or hours at the wanted time), the dishes and their prices, the
   * address. `expected` carries the prices the customer saw (placing an Order); without it only availability is checked.
   */
  async #check(
    context: TransactionContext,
    actor: ClientActor,
    input: CheckoutInput,
    expected: ReadonlyMap<string, number> | null,
    lockAddress: boolean,
  ): Promise<{ shop: ShopSnapshot | undefined; lines: ResolvedLine[]; blockers: string[]; address: CheckedAddress | null }> {
    const blockers: string[] = [];
    const nowMs = await freshClockMs(context);
    const shop = await this.shopReader.snapshotOfShop(context, input.shopId);
    const gate = shop === undefined ? undefined : await this.setupGate.evaluate(context, shop);
    if (shop === undefined || gate === undefined || shop.status !== 'ACTIVE' || !gate.publicVisible) {
      // Not set up (issue #190) or locked: never open for a NEW order, whatever the schedule says. Orders already created are not touched by this check.
      blockers.push('SHOP_NOT_OPEN');
    } else if (input.scheduledForMs === null) {
      if (!gate.availability.online) {
        blockers.push('SHOP_NOT_OPEN');
      }
    } else {
      const window = scheduleInWindow(input.scheduledForMs, nowMs);
      const at = window === 'OK' ? await this.shopReader.snapshotOfShopAt(context, input.shopId, input.scheduledForMs) : undefined;
      if (window !== 'OK') {
        blockers.push(window === 'TOO_SOON' ? 'SCHEDULE_TOO_SOON' : 'SCHEDULE_TOO_FAR');
      } else if (at === undefined || !at.availability.online) {
        blockers.push('SCHEDULE_OUTSIDE_HOURS');
      }
    }
    const merged = this.#merge(input.lines);
    const dishes: MenuItemRow[] = shop === undefined ? [] : await this.menu.lockItemsShared(context, input.shopId, [...new Set(merged.map((l) => l.itemId))]);
    const byId = new Map(dishes.map((d) => [d.itemId, d]));
    const lines: ResolvedLine[] = merged.map((line) => {
      const dish = byId.get(line.itemId);
      if (dish === undefined || dish.status !== 'VISIBLE') {
        return { itemId: line.itemId, name: dish?.name ?? null, note: line.note, quantity: line.quantity, priceVnd: null, issue: 'ITEM_UNAVAILABLE' };
      }
      const seen = expected?.get(line.itemId);
      return { itemId: line.itemId, name: dish.name, note: line.note, quantity: line.quantity, priceVnd: dish.priceVnd, issue: seen !== undefined && seen !== dish.priceVnd ? 'ITEM_PRICE_CHANGED' : null };
    });
    let address: CheckedAddress | null = null;
    if (input.address.addressId !== null) {
      const found = lockAddress
        ? await this.customers.lockAddressForOrder(context, actor.userId, input.address.addressId)
        : await this.customers.findAddressForOrder(context, actor.userId, input.address.addressId);
      if (found === undefined) {
        blockers.push('ADDRESS_NOT_FOUND');
      } else {
        address = { text: found.addressDescription, lat: found.latitude, lng: found.longitude, sourceId: found.id };
      }
    } else if (input.address.addressText !== null) {
      address = { text: input.address.addressText, lat: input.address.lat, lng: input.address.lng, sourceId: null };
    }
    return { shop, lines, blockers, address };
  }

  // ---- placing the Order -----------------------------------------------------------------------------------------------------

  /**
   * POST /v1/customers/me/orders. Sends the Order: the server checks the shop, its hours (or the hours at the wanted time), every dish and its price against
   * what the customer saw, and the address; any difference is ORDER_CART_CHANGED / ORDER_SHOP_NOT_OPEN / ORDER_SCHEDULE_INVALID / ORDER_ADDRESS_INVALID and
   * nothing is created. The same `client_ref` (a retry after a lost reply, a reinstall) is the SAME Order, with the same Idempotency-Key or another.
   */
  async place(principal: AuthPrincipal, input: PlaceInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    const prepared = await this.#prepare(principal, input);
    const leg = await this.#route(prepared);
    return this.executor.execute(
      {
        scopeType: ORDER_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: ORDER_OPERATIONS.place,
        idempotencyKey: key,
        logicalRequest: {
          client_ref: input.clientRef,
          shop_id: input.shopId,
          lines: input.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity, note: l.note, price: l.expectedPriceVnd })),
          items_total_vnd: input.expectedItemsTotalVnd,
          expected_quote: input.expectedQuote,
          note: input.note,
          delivery_note: input.deliveryNote,
          recipient_name: input.recipientName,
          recipient_phone: input.recipientPhone,
          address_id: input.address.addressId,
          address_text: input.address.addressText,
          lat: input.address.lat,
          lng: input.address.lng,
          scheduled_for: iso(input.scheduledForMs),
        },
        replay: this.#replay(principal),
      },
      async (context) => {
        const actor = await this.#customer(context, principal, 'update');
        const existing = await this.orders.findByClientRef(context, actor.userId, input.clientRef);
        if (existing !== undefined) {
          return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.forCustomer(context, existing, true) };
        }
        // The shop first (FOR SHARE: it cannot be disabled or moved until this Order has committed), then the dishes in id order.
        const lockedShop = await this.shopRepo.lockShopShared(context, input.shopId);
        if (lockedShop === undefined) {
          throw new AppError('ORDER_SHOP_NOT_OPEN');
        }
        const expected = new Map<string, number>();
        for (const line of input.lines) {
          if (line.expectedPriceVnd !== null) {
            expected.set(line.itemId, line.expectedPriceVnd);
          }
        }
        const checked = await this.#check(context, actor, input, expected, true);
        if (checked.lines.some((l) => l.issue !== null)) {
          throw new AppError('ORDER_CART_CHANGED');
        }
        for (const blocker of checked.blockers) {
          if (blocker === 'SHOP_NOT_OPEN') throw new AppError('ORDER_SHOP_NOT_OPEN');
          if (blocker === 'ADDRESS_NOT_FOUND') throw new AppError('ORDER_ADDRESS_INVALID');
          throw new AppError('ORDER_SCHEDULE_INVALID');
        }
        const shop = checked.shop as ShopSnapshot;
        if (checked.address === null) {
          throw new AppError('ORDER_ADDRESS_INVALID');
        }
        if (input.expectedQuote === null || !input.expectedQuote.complete) {
          // Existing Orders are returned above before this guard, preserving a
          // lost-response retry from an older client. A new Order must prove
          // which priced or explicitly unavailable quote the customer saw.
          throw new AppError('ORDER_QUOTE_REQUIRED');
        }
        const priced = checked.lines.map((l) => ({ ...l, priceVnd: l.priceVnd as number }));
        const total = totalOf(priced.map((l) => ({ unitPriceVnd: l.priceVnd, quantity: l.quantity })));
        if (total !== input.expectedItemsTotalVnd) {
          throw new AppError('ORDER_CART_CHANGED');
        }
        const currentPickup = shop.pickupLat != null && shop.pickupLng != null ? { lat: shop.pickupLat, lng: shop.pickupLng } : null;
        const currentPoint = checked.address.lat != null && checked.address.lng != null ? { lat: checked.address.lat, lng: checked.address.lng } : null;
        if (
          ((prepared.pickup !== null || currentPickup !== null) && !this.#samePoint(prepared.pickup, currentPickup)) ||
          ((prepared.point !== null || currentPoint !== null) && !this.#samePoint(prepared.point, currentPoint))
        ) {
          throw new AppError('ORDER_QUOTE_CHANGED');
        }
        const estimate = await this.#estimate(context, shop, checked.address, prepared, leg);
        if (input.expectedQuote.status !== estimate.status || input.expectedQuote.distanceM !== estimate.distanceM || input.expectedQuote.feeVnd !== estimate.feeVnd || input.expectedQuote.reason !== estimate.reason || input.expectedQuote.policyVersion !== estimate.policyVersion || input.expectedQuote.snapshot !== estimate.snapshot) {
          throw new AppError('ORDER_QUOTE_CHANGED');
        }
        const items: NewItem[] = priced.map((l, index) => ({ lineId: randomUUID(), lineNo: index + 1, menuItemId: l.itemId, name: l.name as string, note: l.note, unitPriceVnd: l.priceVnd, quantity: l.quantity }));
        const orderId = randomUUID();
        let inserted = false;
        for (let attempt = 0; attempt < 6 && !inserted; attempt += 1) {
          inserted = await this.orders.insert(
            context,
            {
              orderId,
              code: newOrderCode(),
              clientRef: input.clientRef,
              customerUserId: actor.userId,
              shopId: shop.shopId,
              shopName: shop.name,
              shopPhone: shop.contactPhoneNormalized,
              shopAddressText: shop.addressText,
              recipientName: input.recipientName,
              recipientPhone: input.recipientPhone,
              addressText: checked.address.text,
              addressLat: checked.address.lat,
              addressLng: checked.address.lng,
              sourceAddressId: checked.address.sourceId,
              note: input.note,
              deliveryNote: input.deliveryNote,
              scheduledForMs: input.scheduledForMs,
              itemsTotalVnd: total,
              feeEstimateVnd: estimate.feeVnd,
              feeEstimateDistanceM: estimate.distanceM,
            },
            items,
          );
        }
        if (!inserted) {
          throw new TechnicalError('internal', 'Could not allocate an order code');
        }
        let order = await this.#reread(context, orderId);
        // The cart of this shop has become this Order.
        const cart = await this.orders.findCart(context, actor.userId);
        if (cart?.shopId === input.shopId) {
          await this.orders.deleteCart(context, actor.userId);
        }
        await this.recorder.record(context, {
          order,
          type: 'placed',
          actorType: 'CUSTOMER',
          actorId: actor.userId,
          operation: ORDER_OPERATIONS.place,
          requestId,
          details: {
            items: items.map((i) => ({ name: i.name, quantity: i.quantity, unit_price_vnd: i.unitPriceVnd, note: i.note })),
            items_total_vnd: total,
            quote_reason: estimate.status === 'UNAVAILABLE' ? estimate.reason : null,
          },
          metadata: { scheduled: input.scheduledForMs !== null },
        });
        // The canonical unavailable reason is part of the immutable placed event.
        // Re-project it for the create response; old events without the key stay neutral.
        order = await this.#reread(context, orderId);
        return { status: 201, replayGuard: { user_id: actor.userId }, payload: await this.views.forCustomer(context, order, true) };
      },
    );
  }

  /** Did a send that never answered reach the server? The attempt's own reference tells (the app asks before it sends again). */
  async lookup(principal: AuthPrincipal, clientRef: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const order = await this.orders.findByClientRef(context, actor.userId, clientRef);
      if (order === undefined) {
        throw new AppError('ORDER_NOT_FOUND');
      }
      return this.views.forCustomer(context, order, true);
    });
  }

  // ---- reading ---------------------------------------------------------------------------------------------------------------

  async list(principal: AuthPrincipal, query: CustomerListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const nowMs = await freshClockMs(context);
      const rows = await this.orders.listForCustomer(context, actor.userId, query.scope, query.limit, query.offset);
      return { orders: rows.map((row) => this.views.summary(row, false, nowMs)), limit: query.limit, offset: query.offset };
    });
  }

  async read(principal: AuthPrincipal, orderId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const actor = await this.#customer(context, principal, 'share');
      const order = await this.orders.findOfCustomer(context, orderId, actor.userId);
      if (order === undefined) {
        throw new AppError('ORDER_NOT_FOUND');
      }
      return this.views.forCustomer(context, order, true);
    });
  }

  // ---- cancelling ------------------------------------------------------------------------------------------------------------

  /**
   * "Hủy đơn" by the customer: only while the shop has not confirmed. After that the customer asks the shop. It races with the shop's confirmation on the Order row:
   * exactly one of the two commits, the other finds a new version (VERSION_CONFLICT) and reloads.
   */
  async cancel(principal: AuthPrincipal, orderId: string, input: CancelInput, key: string | readonly string[] | undefined, requestId: string): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: ORDER_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId: ORDER_OPERATIONS.customerCancel,
        idempotencyKey: key,
        logicalRequest: { order_id: orderId, expected_version: input.expectedVersion, reason: input.reason },
        replay: this.#replay(principal),
      },
      async (context) => {
        const actor = await this.#customer(context, principal, 'update');
        const locked = await this.orders.lockById(context, orderId);
        if (locked === undefined || locked.customerUserId !== actor.userId) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        if (locked.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        if (!customerMayCancel(locked.status)) {
          throw new AppError('ORDER_STATE_CONFLICT');
        }
        const after = await this.#update(context, locked, { status: 'CANCELLED_BY_CUSTOMER', endedNow: 'CUSTOMER', endReason: input.reason });
        await this.recorder.record(context, { order: after, type: 'cancelled_by_customer', actorType: 'CUSTOMER', actorId: actor.userId, note: input.reason, operation: ORDER_OPERATIONS.customerCancel, requestId });
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: await this.views.forCustomer(context, after, true) };
      },
    );
  }

  // ---- ordering again --------------------------------------------------------------------------------------------------------

  /**
   * "Đặt lại": the dishes of an earlier Order that are still on sale go into the cart at TODAY's price (the old price is never copied); the others are listed as
   * skipped. A cart of another shop is replaced only when the customer said so (`replace_cart`); the same shop's cart gets the dishes added.
   */
  async reorder(principal: AuthPrincipal, orderId: string, input: ReorderInput, key: string | readonly string[] | undefined): Promise<IdempotentOutcome> {
    return this.executor.execute(
      { scopeType: ORDER_SCOPE_TYPE, scopeId: principal.userId, operationId: 'order.reorder.v1', idempotencyKey: key, logicalRequest: { order_id: orderId, replace_cart: input.replaceCart }, replay: this.#replay(principal) },
      async (context) => {
        const actor = await this.#customer(context, principal, 'update');
        const order = await this.orders.findOfCustomer(context, orderId, actor.userId);
        if (order === undefined) {
          throw new AppError('ORDER_NOT_FOUND');
        }
        const snapshot = await this.shopReader.snapshotOfShop(context, order.shopId);
        if (snapshot === undefined || snapshot.status !== 'ACTIVE' || !(await this.setupGate.evaluate(context, snapshot)).publicVisible) {
          throw new AppError('ORDER_SHOP_NOT_OPEN');
        }
        const existing = await this.orders.findCart(context, actor.userId);
        if (existing !== undefined && existing.shopId !== order.shopId && !input.replaceCart) {
          throw new AppError('ORDER_CART_OTHER_SHOP');
        }
        const dishes = new Map((await this.menu.listPublicItems(context, order.shopId)).map((d) => [d.itemId, d]));
        const lines: { itemId: string; quantity: number; note: string | null; name: string }[] = [];
        const skipped: JsonObject[] = [];
        for (const line of await this.orders.listItems(context, order.orderId)) {
          const dish = dishes.get(line.menuItemId);
          if (dish === undefined) {
            skipped.push({ name: line.name, reason: 'ITEM_UNAVAILABLE' });
          } else {
            lines.push({ itemId: line.menuItemId, quantity: line.origQuantity, note: line.note, name: dish.name });
          }
        }
        if (lines.length === 0) {
          return { status: 200, replayGuard: { user_id: actor.userId }, payload: { cart: null, skipped } };
        }
        const base = existing !== undefined && existing.shopId === order.shopId ? existing.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, note: l.note })) : [];
        const merged = mergeCartLines([...base, ...lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, note: l.note }))]);
        const names = new Map([...(existing?.lines ?? []).map((l) => [l.itemId, l.name] as const), ...lines.map((l) => [l.itemId, l.name] as const)]);
        const stored = merged.map((l) => ({ ...l, quantity: Math.min(l.quantity, MAX_LINE_QUANTITY), name: names.get(l.itemId) ?? '' }));
        const row = await this.orders.upsertCart(context, actor.userId, order.shopId, stored, existing?.shopId === order.shopId ? existing.note : null);
        return { status: 200, replayGuard: { user_id: actor.userId }, payload: { cart: await this.#cartView(context, row.shopId, row.lines, row.note, row.version), skipped } };
      },
    );
  }

  // ---- shared ----------------------------------------------------------------------------------------------------------------

  async #update(context: TransactionContext, order: OrderRow, patch: Parameters<OrderRepository['update']>[3]): Promise<OrderRow> {
    const updated = await this.orders.update(context, order.orderId, order.version, patch);
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  async #reread(context: TransactionContext, orderId: string): Promise<OrderRow> {
    const row = await this.orders.findById(context, orderId);
    if (row === undefined) {
      throw new TechnicalError('internal', 'Order vanished after insert');
    }
    return row;
  }
}
