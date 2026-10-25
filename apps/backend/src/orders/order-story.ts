import { humanDeliveryReason, systemCancelSentence } from '../delivery/delivery-reason-text';

// "Diễn biến" of an order or of a direct delivery as the shop and the customer read it: only the milestones that happened, in plain words, in time order.
// Pure (no I/O, no clock). The full event log stays in the database, in the audit and in the SYSTEM/ADMIN views; nothing here is written back. Reminders,
// warnings, repeated notices and technical steps are dropped, and an event this file does not know says nothing (no event key ever reaches a screen).

export interface StoryOrderEvent {
  /** Id of the stored event (the chat feed keys a milestone by it); optional so older callers are unchanged. */
  readonly eventId?: string;
  readonly atMs: number;
  /** Stored as `order.<change>`. */
  readonly type: string;
  readonly actorType: string;
  readonly note: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

export interface StoryDeliveryEvent {
  /** Position of the event in its delivery's log (with the delivery id it is the stable key of a milestone in the chat feed). */
  readonly seq?: number;
  readonly atMs: number;
  /** Stored as `delivery.<change>`. */
  readonly type: string;
  readonly actorType: string;
  readonly note: string | null;
}

export interface StoryDelivery {
  readonly deliveryId: string;
  readonly source: 'DIRECT' | 'ORDER';
  readonly previousDeliveryId: string | null;
  readonly events: readonly StoryDeliveryEvent[];
  /** The failure of this call as a sentence (from its incident), when it failed. */
  readonly failText: string | null;
}

export interface StoryEntry {
  readonly at: string;
  readonly text: string;
  readonly atMs: number;
  /** Stable key of the source event: `o:<order event id>` or `d:<delivery id>:<seq>`. */
  readonly key: string;
}

/**
 * `shop`: the shop's owner. `customer`: the person who ordered (no goods handling, no Shipper's private reasons).
 * `room`: the order's chat room, read by every party allowed to see the order: the customer's wording (no goods handling, no private reasons) plus the fee
 * milestones, so the same sentence is true and safe for all of them.
 */
export type StoryAudience = 'shop' | 'customer' | 'room';

/** A call cancelled in the same moment as the order it belongs to is one milestone, told by the order. */
const SAME_MOMENT_MS = 3000;

const withReason = (head: string, reason: string | null): string => (reason === null ? head : `${head} — ${reason}`);

const bare = (type: string, prefix: string): string => (type.startsWith(prefix) ? type.slice(prefix.length) : type);

function orderLine(e: StoryOrderEvent): string | null {
  const reason = humanDeliveryReason(e.note);
  switch (bare(e.type, 'order.')) {
    case 'placed':
      return 'Đã đặt đơn';
    case 'edited':
      return 'Quán đã chỉnh đơn';
    case 'confirmed':
      return reason === null ? 'Quán đã xác nhận' : `Quán đã xác nhận đơn đã chỉnh — ${reason}`;
    case 'rejected':
      return withReason('Quán đã từ chối đơn', reason);
    case 'ready':
      return 'Món đã sẵn sàng';
    case 'cancelled_by_customer':
    case 'cancelled_by_customer_after_pickup':
      return withReason('Khách đã hủy đơn', reason);
    case 'cancelled_by_shop':
      return withReason('Quán đã hủy đơn', reason);
    case 'cancelled_by_admin':
      return withReason('Quản trị đã hủy đơn', reason);
    case 'confirmation_timeout':
      return 'Đã hủy đơn — quán không xác nhận trong thời gian quy định';
    case 'delivery_timeout': {
      const hadShipper = e.details !== null && typeof e.details.assignment_id === 'string';
      return `Đã hủy đơn — ${hadShipper ? 'shipper chưa lấy hàng quá thời gian quy định' : 'chưa có shipper nhận trong thời gian quy định'}`;
    }
    case 'not_completed':
      return withReason('Quán đã đóng đơn, không hoàn tất', reason);
    case 'not_completed_by_admin':
      return withReason('Quản trị đã đóng đơn, không hoàn tất', reason);
    // The delivery tells these: "Đang tìm shipper", "Giao thành công". Reminders and payment notes are not milestones.
    default:
      return null;
  }
}

function deliveryLine(e: StoryDeliveryEvent, d: StoryDelivery, audience: StoryAudience): string | null {
  const reason = humanDeliveryReason(e.note);
  switch (bare(e.type, 'delivery.')) {
    case 'created':
      return d.source === 'ORDER' ? 'Đang tìm shipper' : 'Đã tạo yêu cầu giao, đang tìm shipper';
    case 'recalled':
      return 'Quán gọi lại shipper, đang tìm shipper';
    case 'accepted':
      return 'Shipper đã nhận đơn';
    case 'released_by_shipper':
      return audience === 'shop' ? withReason('Shipper đã hủy nhận đơn', reason) : 'Shipper đã hủy nhận đơn';
    // Fee milestones are told only in the order's room (the other audiences keep their earlier wording); no amount, no private reason.
    case 'fee_countered':
      return audience === 'room' ? 'Shipper đề xuất phí giao khác, đang chờ quyết định' : null;
    case 'fee_agreed':
    case 'fee_counter_accepted':
    case 'fee_customer_confirmed':
      return audience === 'room' ? 'Phí giao đã được chấp nhận' : null;
    case 'fee_counter_rejected':
      return audience === 'room' ? 'Đề xuất phí giao không được chấp nhận' : null;
    case 'fee_answer_expired':
    case 'fee_answer_expired_released':
      return audience === 'room' ? 'Đề xuất phí giao đã hết hạn trả lời' : null;
    case 'released_by_admin':
      return 'Quản trị đã gỡ shipper khỏi đơn';
    case 'picked_up':
      return 'Shipper đã lấy hàng';
    case 'completed':
      return 'Giao thành công';
    case 'failed':
      return withReason('Giao không thành công', d.failText ?? reason);
    case 'search_stopped':
      return 'Chưa có shipper nhận, đã dừng tìm';
    case 'cancelled_by_shop':
    case 'cancelled_after_pickup':
      // After pickup only the creator may cancel: the actor says who (the customer of an order, the shop of a direct call).
      return withReason(e.actorType === 'CUSTOMER' ? 'Khách đã hủy yêu cầu giao' : e.actorType === 'ADMIN' ? 'Quản trị đã hủy yêu cầu giao' : 'Quán đã hủy yêu cầu giao', reason);
    case 'cancelled_by_system':
      return systemCancelSentence(e.note);
    case 'goods_returned':
      return audience === 'shop' ? 'Quán xác nhận hàng đã về' : null;
    case 'goods_handled':
      return audience === 'shop' ? 'Quán đã xử lý hàng' : null;
    case 'goods_returned_by_admin':
    case 'goods_handled_by_admin':
      return audience === 'shop' ? 'Quản trị đã xử lý hàng' : null;
    // Fee talks, pickup/search reminders, timeout warnings, a pinned destination, referrals and adjustments are not milestones.
    default:
      return null;
  }
}

const ENDING_ORDER_EVENTS = new Set(['cancelled_by_shop', 'cancelled_by_admin', 'cancelled_by_customer', 'cancelled_by_customer_after_pickup', 'delivery_timeout', 'confirmation_timeout']);
const CANCEL_DELIVERY_EVENTS = new Set(['cancelled_by_shop', 'cancelled_after_pickup', 'cancelled_by_system']);

/** The story of an order: its own milestones and those of every call for a Shipper, oldest first. */
export function buildOrderStory(orderEvents: readonly StoryOrderEvent[], deliveries: readonly StoryDelivery[], audience: StoryAudience): StoryEntry[] {
  const endings = orderEvents.filter((e) => ENDING_ORDER_EVENTS.has(bare(e.type, 'order.'))).map((e) => e.atMs);
  const rows: { atMs: number; rank: number; seq: number; text: string; key: string }[] = [];
  let seq = 0;
  for (const e of orderEvents) {
    const text = orderLine(e);
    if (text !== null) {
      rows.push({ atMs: e.atMs, rank: 0, seq: (seq += 1), text, key: `o:${e.eventId ?? String(seq)}` });
    }
  }
  for (const d of deliveries) {
    for (const e of d.events) {
      if (CANCEL_DELIVERY_EVENTS.has(bare(e.type, 'delivery.')) && endings.some((at) => Math.abs(at - e.atMs) <= SAME_MOMENT_MS)) {
        continue;
      }
      const text = deliveryLine(e, d, audience);
      if (text !== null) {
        rows.push({ atMs: e.atMs, rank: 1, seq: (seq += 1), text, key: `d:${d.deliveryId}:${String(e.seq ?? seq)}` });
      }
    }
  }
  return rows.sort((a, b) => a.atMs - b.atMs || a.rank - b.rank || a.seq - b.seq).map((r) => ({ at: new Date(r.atMs).toISOString(), text: r.text, atMs: r.atMs, key: r.key }));
}

/** The story of one direct delivery (no order around it). */
export function buildDeliveryStory(delivery: StoryDelivery, audience: StoryAudience): StoryEntry[] {
  return buildOrderStory([], [delivery], audience);
}
