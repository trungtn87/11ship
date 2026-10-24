import { randomInt } from 'node:crypto';
import { DeliveryState } from '../delivery/delivery-constants';
import { ENDED_STATUSES, MAX_LINE_QUANTITY, OrderStatus, SCHEDULE_MAX_AHEAD_MS, SCHEDULE_MIN_LEAD_MS } from './order-constants';

// M10 pure rules: no I/O and no clock of their own (the caller passes the database time). What the apps show as a status, a permission or a total
// comes from here, so it is the same on every path and testable without a database.

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newOrderCode(): string {
  let code = 'DH-';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  }
  return code;
}

export interface CartLine {
  readonly itemId: string;
  readonly quantity: number;
  readonly note: string | null;
}

const noteKey = (note: string | null): string => (note === null ? '' : note.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase());

/**
 * One cart has one line per (dish, note): the same dish with the same note adds up, the same dish with another note stays on its own line. The order
 * of first appearance is kept. A quantity that would pass the per-line limit is clamped by the caller's validation, not silently here.
 */
export function mergeCartLines(lines: readonly CartLine[]): CartLine[] {
  const merged: CartLine[] = [];
  const index = new Map<string, number>();
  for (const line of lines) {
    const key = `${line.itemId}|${noteKey(line.note)}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, merged.length);
      merged.push({ itemId: line.itemId, quantity: line.quantity, note: noteKey(line.note) === '' ? null : line.note });
    } else {
      const existing = merged[at] as CartLine;
      merged[at] = { ...existing, quantity: existing.quantity + line.quantity };
    }
  }
  return merged;
}

export function quantityInRange(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_LINE_QUANTITY;
}

export interface PricedLine {
  readonly unitPriceVnd: number;
  readonly quantity: number;
  readonly removed?: boolean;
}

/** Whole VND: the sum of the lines that are still in the Order. */
export function totalOf(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => (line.removed === true ? sum : sum + line.unitPriceVnd * line.quantity), 0);
}

/** The goods text M07 carries (varchar 120): "2× Phở bò, 1× Trà đá", cut with an ellipsis rather than split in the middle of a word. */
export function goodsDescriptionOf(lines: readonly { readonly name: string; readonly quantity: number }[]): string {
  const text = lines.map((line) => `${String(line.quantity)}× ${line.name}`).join(', ');
  const chars = [...text];
  return chars.length <= 120 ? text : `${chars.slice(0, 117).join('').trimEnd()}…`;
}

/**
 * The customer may cancel the Order until the shop confirmed it, and again once the Shipper has PICKED UP the goods (Owner decision 2026-10-23: the
 * creator of the request owns the cancellation after pickup). In between they ask the shop.
 */
export function customerMayCancelAfterPickup(status: OrderStatus, latestDelivery: DeliveryState | null): boolean {
  return status === 'PREPARING' && (latestDelivery === 'delivering' || latestDelivery === 'picked_up');
}

/** The customer may cancel the Order only until the shop confirmed it (after that they ask the shop). */
export function customerMayCancel(status: OrderStatus): boolean {
  return status === 'PENDING_CONFIRMATION';
}

export function isEnded(status: OrderStatus): boolean {
  return ENDED_STATUSES.includes(status);
}

/** The wanted time of a scheduled Order: not before the lead time, not beyond the horizon. The business-hours test is the database's (the shop's schedule). */
export function scheduleInWindow(scheduledMs: number, nowMs: number): 'OK' | 'TOO_SOON' | 'TOO_FAR' {
  if (scheduledMs < nowMs + SCHEDULE_MIN_LEAD_MS) {
    return 'TOO_SOON';
  }
  return scheduledMs > nowMs + SCHEDULE_MAX_AHEAD_MS ? 'TOO_FAR' : 'OK';
}

export type DisplayStatus =
  | 'AWAITING_SHOP'
  | 'PREPARING'
  | 'SEARCHING_SHIPPER'
  | 'SHIPPER_COMING'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'SEARCH_STOPPED'
  | 'DELIVERY_FAILED'
  | 'CANCELLED_BY_CUSTOMER'
  | 'CANCELLED_BY_SHOP'
  | 'CANCELLED_BY_SYSTEM'
  | 'REJECTED'
  | 'NOT_COMPLETED';

/**
 * The one status the apps show, put together from the Order and the state of its LATEST delivery as the server holds them (never from a phone clock).
 * A delivery that was cancelled on its own (the Order stays) puts the Order back to "preparing" so the shop can call again. There is no "ready" step
 * (Owner decision 2026-10-23): calling a Shipper means the dishes are ready.
 */
export function displayStatusOf(status: OrderStatus, latestDelivery: DeliveryState | null): DisplayStatus {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return 'AWAITING_SHOP';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED_BY_CUSTOMER':
      return 'CANCELLED_BY_CUSTOMER';
    case 'CANCELLED_BY_SYSTEM':
      return 'CANCELLED_BY_SYSTEM';
    case 'CANCELLED_BY_SHOP':
      return 'CANCELLED_BY_SHOP';
    case 'REJECTED_BY_SHOP':
      return 'REJECTED';
    case 'NOT_COMPLETED':
      return 'NOT_COMPLETED';
    case 'PREPARING':
      break;
  }
  switch (latestDelivery) {
    case 'waiting_driver':
      return 'SEARCHING_SHIPPER';
    case 'accepted':
    case 'location_confirmed':
      return 'SHIPPER_COMING';
    case 'picked_up':
    case 'delivering':
      return 'DELIVERING';
    case 'search_stopped':
      return 'SEARCH_STOPPED';
    case 'failed':
      return 'DELIVERY_FAILED';
    default:
      return 'PREPARING';
  }
}

/** What the shop still has to do about a running Order whose last call did not work out: the "Cần xử lý" list. */
export function needsAttention(status: OrderStatus, latestDelivery: DeliveryState | null): boolean {
  return status === 'PREPARING' && (latestDelivery === 'search_stopped' || latestDelivery === 'failed');
}

/** A new call is possible while the Order runs and has no delivery in progress (a failed one only after the goods are settled: M07 decides that). */
export function mayCallShipper(status: OrderStatus, latestDelivery: DeliveryState | null): boolean {
  if (status !== 'PREPARING') {
    return false;
  }
  return latestDelivery === null || latestDelivery === 'search_stopped' || latestDelivery === 'cancelled_by_merchant' || latestDelivery === 'failed';
}
