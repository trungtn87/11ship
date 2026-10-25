import { Injectable } from '@nestjs/common';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { mayRecall } from '../delivery/delivery-rules';
import { DeliveryViews } from '../delivery/delivery-views';
import { JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ShopAvailabilityReader } from '../shop/shop-availability-reader';
import { TransactionContext } from '../transaction/transaction-context';
import { ACTIVE_STATES } from '../delivery/delivery-constants';
import { ItemRow, OrderEventRow, OrderListItem, OrderRepository, OrderRow } from './order-repository';
import { buildOrderStory, StoryAudience, StoryOrderEvent } from './order-story';
import { humanDeliveryReason } from '../delivery/delivery-reason-text';
import { publicContactOf } from '../shop-setup/shop-public-contact';
import { customerMayCancel, customerMayCancelAfterPickup, displayStatusOf, isEnded, mayCallShipper, needsAttention } from './order-rules';

// The JSON each reader of an Order gets. The server decides which fields are filled; a field the caller may not see is null (or absent). Money is a whole
// number or null (never 0 for "unknown"); times are ISO strings; `server_now` carries the SERVER clock so nothing depends on the phone clock. The fee and the
// dishes are separate figures: a total that would hide an unknown fee is not given (`expected_total_vnd` is null until the fee is known).

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function itemView(i: ItemRow): JsonObject {
  const changed = i.unitPriceVnd !== i.origUnitPriceVnd || i.quantity !== i.origQuantity || i.removedAtMs !== null;
  return {
    line_id: i.lineId,
    menu_item_id: i.menuItemId,
    name: i.name,
    note: i.note,
    quantity: i.quantity,
    unit_price_vnd: i.unitPriceVnd,
    line_total_vnd: i.removedAtMs === null ? i.unitPriceVnd * i.quantity : 0,
    removed: i.removedAtMs !== null,
    original: changed ? { quantity: i.origQuantity, unit_price_vnd: i.origUnitPriceVnd } : null,
  };
}

export function eventView(e: OrderEventRow, withDetails: boolean): JsonObject {
  return { at: iso(e.atMs), type: e.type, actor: e.actorType, note: e.note, ...(withDetails ? { details: e.details } : {}) };
}

/** The money of an Order: the dishes (original and current), what was paid directly, what is still to pay for the dishes, and the fee on its own. */
export function moneyView(o: OrderRow, latest: DeliveryRow | undefined): JsonObject {
  const fee = latest;
  const known = fee !== undefined && fee.feeVnd !== null;
  const feeAmount = known ? (fee.feeVnd as number) : null;
  const payer = fee?.feePayer ?? 'CUSTOMER';
  const status = fee !== undefined ? (known ? 'FINAL' : 'UNKNOWN') : o.feeEstimateVnd !== null ? 'ESTIMATE' : 'UNKNOWN';
  const dishesRemaining = o.itemsTotalVnd - o.paidVnd;
  // The expected total is given only when nobody has to guess the fee: a final fee paid by the customer adds to it, a fee paid by the shop does not.
  const expectedTotal = o.status === 'PENDING_CONFIRMATION' ? (o.feeEstimateVnd !== null ? o.itemsTotalVnd + o.feeEstimateVnd : null) : payer === 'SHOP' ? o.itemsTotalVnd : known ? o.itemsTotalVnd + (feeAmount as number) : null;
  return {
    items_original_total_vnd: o.itemsOriginalTotalVnd,
    items_total_vnd: o.itemsTotalVnd,
    paid_vnd: o.paidVnd,
    items_remaining_vnd: dishesRemaining,
    fee: { payer, amount_vnd: feeAmount, estimate_vnd: o.feeEstimateVnd, status, distance_m: fee?.routeDistanceM ?? o.feeEstimateDistanceM },
    expected_total_vnd: expectedTotal,
  };
}

@Injectable()
export class OrderViews {
  constructor(
    private readonly orders: OrderRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly deliveryViews: DeliveryViews,
    private readonly shops: ShopAvailabilityReader,
  ) {}

  /** The skeleton shared by every reader. */
  async #base(context: TransactionContext, o: OrderRow, items: readonly ItemRow[], latest: DeliveryRow | undefined, nowMs: number): Promise<JsonObject> {
    return {
      order_id: o.orderId,
      code: o.code,
      display_code: o.displayCode ?? o.code,
      status: o.status,
      display_status: displayStatusOf(o.status, latest?.state ?? null),
      version: o.version,
      shop: { shop_id: o.shopId, name: o.shopName, phone: o.shopPhone, address_text: o.shopAddressText },
      recipient: { name: o.recipientName, phone: o.recipientPhone, address_text: o.addressText, lat: o.addressLat, lng: o.addressLng },
      note: o.note,
      scheduled_for: iso(o.scheduledForMs),
      items: items.map(itemView),
      money: moneyView(o, latest),
      edited: o.editedAtMs !== null,
      change_reason: o.changeReason,
      confirmed_at: iso(o.confirmedAtMs),
      ended_at: iso(o.endedAtMs),
      end_actor: o.endActor,
      end_reason: o.endReason,
      created_at: iso(o.createdAtMs),
      updated_at: iso(o.updatedAtMs),
      server_now: iso(nowMs),
    };
  }

  /** The row of a list: no dishes, just what a card shows. */
  summary(item: OrderListItem, forShop: boolean, nowMs: number): JsonObject {
    const o = item.order;
    return {
      order_id: o.orderId,
      code: o.code,
      display_code: o.displayCode ?? o.code,
      status: o.status,
      display_status: displayStatusOf(o.status, item.latestDelivery),
      version: o.version,
      shop_name: o.shopName,
      recipient_name: o.recipientName,
      line_count: item.lineCount,
      items_total_vnd: o.itemsTotalVnd,
      scheduled_for: iso(o.scheduledForMs),
      edited: o.editedAtMs !== null,
      needs_attention: forShop && needsAttention(o.status, item.latestDelivery),
      created_at: iso(o.createdAtMs),
      ended_at: iso(o.endedAtMs),
      server_now: iso(nowMs),
    };
  }

  async #latest(context: TransactionContext, o: OrderRow): Promise<{ all: DeliveryRow[]; latest: DeliveryRow | undefined }> {
    const all = await this.deliveries.listOfOrder(context, o.orderId);
    return { all, latest: all[all.length - 1] };
  }

  /** The milestones of the order and of every call for a Shipper, in plain words (the raw `timeline` is kept for the Admin tools and old clients). */
  async #story(context: TransactionContext, o: OrderRow, all: readonly DeliveryRow[], audience: StoryAudience): Promise<JsonObject[]> {
    const events: StoryOrderEvent[] = (await this.orders.listEvents(context, o.orderId, 300)).map((e) => ({ atMs: e.atMs, type: e.type, actorType: e.actorType, note: e.note, details: e.details }));
    const calls = [];
    for (const d of all) {
      calls.push(await this.deliveryViews.storyOf(context, d));
    }
    return buildOrderStory(events, calls, audience).map((entry) => ({ at: entry.at, text: entry.text }));
  }

  async forCustomer(context: TransactionContext, o: OrderRow, detail: boolean): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const items = await this.orders.listItems(context, o.orderId);
    const { all, latest } = await this.#latest(context, o);
    const view = await this.#base(context, o, items, latest, nowMs);
    view.end_reason = humanDeliveryReason(o.endReason);
    // The shop's PUBLIC contact (phone, Zalo and Messenger links as the shop declared and the server validated), for the quick-contact buttons; it goes away
    // when the order has ended, like the number above it. Nothing private is added: the same projection the public shop page uses.
    const snapshot = isEnded(o.status) ? undefined : await this.shops.snapshotOfShop(context, o.shopId);
    const contact = snapshot === undefined ? undefined : publicContactOf(snapshot);
    view.shop = { ...(view.shop as JsonObject), contact: contact === undefined ? null : { phone: contact.phone, zalo_url: contact.zaloUrl, messenger_url: contact.messengerUrl } };
    view.delivery = latest === undefined ? null : await this.deliveryViews.forCustomer(context, latest, nowMs);
    view.delivery_count = all.length;
    // After pickup the customer (who created an ORDER) may cancel; the Shipper is told to call the shop and the goods stay with them until the shop settles them.
    view.can = { cancel: customerMayCancel(o.status), cancel_after_pickup: customerMayCancelAfterPickup(o.status, latest?.state ?? null), reorder: true };
    if (detail) {
      view.timeline = (await this.orders.listEvents(context, o.orderId, 200)).map((e) => eventView(e, true));
      view.story = await this.#story(context, o, all, 'customer');
    }
    return view;
  }

  async forShop(context: TransactionContext, o: OrderRow, detail: boolean): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const items = await this.orders.listItems(context, o.orderId);
    const { all, latest } = await this.#latest(context, o);
    const view = await this.#base(context, o, items, latest, nowMs);
    view.end_reason = humanDeliveryReason(o.endReason);
    const activeDelivery = all.some((d) => ACTIVE_STATES.includes(d.state));
    view.delivery = latest === undefined ? null : await this.deliveryViews.forShop(context, latest, nowMs, detail);
    view.deliveries = all.map((d) => ({ delivery_id: d.deliveryId, code: d.code, display_code: d.displayCode ?? d.code, state: d.state, previous_delivery_id: d.previousDeliveryId, created_at: iso(d.createdAtMs), ended_at: iso(d.endedAtMs), end_reason: humanDeliveryReason(d.endReason) }));
    view.schedule_conflict = await this.#scheduleConflict(context, o, nowMs);
    const running = o.status === 'PREPARING';
    view.can = {
      edit: o.status === 'PENDING_CONFIRMATION',
      confirm: o.status === 'PENDING_CONFIRMATION' && o.itemsTotalVnd > 0,
      reject: o.status === 'PENDING_CONFIRMATION',
      record_payment: running && !activeDelivery,
      call_shipper: mayCallShipper(o.status, latest?.state ?? null) && (latest === undefined || latest.state !== 'failed' || (await this.#goodsSettled(context, latest))),
      cancel: running && (latest === undefined || !['delivering', 'picked_up', 'completed'].includes(latest.state)),
      close_not_completed: running && latest?.state === 'failed' && (await this.#goodsSettled(context, latest)),
    };
    if (detail) {
      view.timeline = (await this.orders.listEvents(context, o.orderId, 300)).map((e) => eventView(e, true));
      view.story = await this.#story(context, o, all, 'shop');
    }
    return view;
  }

  async forAdmin(context: TransactionContext, o: OrderRow, can: readonly string[]): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const items = await this.orders.listItems(context, o.orderId);
    const { all, latest } = await this.#latest(context, o);
    const view = await this.#base(context, o, items, latest, nowMs);
    const calls: JsonObject[] = [];
    for (const d of all) {
      calls.push(await this.deliveryViews.forCustomer(context, d, nowMs));
    }
    view.customer = { user_id: o.customerUserId };
    view.deliveries = all.map((d) => ({ delivery_id: d.deliveryId, code: d.code, display_code: d.displayCode ?? d.code, state: d.state, previous_delivery_id: d.previousDeliveryId, created_at: iso(d.createdAtMs), ended_at: iso(d.endedAtMs), end_reason: d.endReason }));
    view.delivery = calls.length === 0 ? null : (calls[calls.length - 1] as JsonObject);
    view.timeline = (await this.orders.listEvents(context, o.orderId, 400)).map((e) => eventView(e, true));
    view.can = [...can];
    return view;
  }

  /** The shop changed its hours after accepting: the wanted time of a scheduled Order is no longer inside them. A warning only; nothing is cancelled. */
  async #scheduleConflict(context: TransactionContext, o: OrderRow, nowMs: number): Promise<boolean> {
    if (o.scheduledForMs === null || isEnded(o.status) || o.scheduledForMs <= nowMs) {
      return false;
    }
    const snapshot = await this.shops.snapshotOfShopAt(context, o.shopId, o.scheduledForMs);
    return snapshot === undefined || !snapshot.availability.online;
  }

  async #goodsSettled(context: TransactionContext, d: DeliveryRow): Promise<boolean> {
    if (d.state !== 'failed') {
      return true;
    }
    const incident = await this.deliveries.findIncident(context, d.deliveryId);
    return mayRecall(d.state, incident?.status === 'OPEN');
  }
}
