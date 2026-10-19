import { NotificationApp, NotificationKind, PUSH_TTL_MS, TargetType } from './notification-constants';

// Pure: an outbox event becomes zero or more notification drafts. Wording is fixed here and is safe for a lock screen: the delivery CODE is the only
// identifier shown, never a phone, an address, an amount owner, an OTP or bank data. No I/O and no clock.

export type Audience = 'SHOP' | 'DRIVER' | 'DRIVER_OF_AGREEMENT' | 'CUSTOMER';

export interface DraftBase {
  readonly audience: Audience;
  readonly app: NotificationApp;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly targetType: TargetType;
  readonly targetId: string | null;
  readonly targetVersion: number;
  readonly dedupeKey: string;
  /** How long the fact stays actionable (from now); null = history only. */
  readonly validForMs: number | null;
  readonly pushTtlMs: number;
}

export type Draft = { readonly type: 'NOTIFY'; readonly draft: DraftBase } | { readonly type: 'OFFER_ROUND'; readonly deliveryId: string; readonly roundVersion: number } | { readonly type: 'REMINDER'; readonly reminder: 'SEARCH_5' | 'SEARCH_15' | 'PICKUP'; readonly deliveryId: string; readonly assignmentId: string | null };

export interface DeliveryChangePayload {
  readonly deliveryId: string;
  readonly code: string;
  readonly shopId: string;
  readonly change: string;
  readonly state: string;
  readonly version: number;
  readonly assignmentId: string | null;
  readonly driverId: string | null;
  /** The food Order the delivery carries (M10), if any: its customer is told of the steps that matter to them. */
  readonly orderId?: string | null;
}

const delivery = (p: DeliveryChangePayload, audience: Audience, kind: NotificationKind, title: string, body: string, pushTtlMs: number = PUSH_TTL_MS.result): Draft => ({
  type: 'NOTIFY',
  draft: {
    audience,
    app: audience === 'SHOP' || audience === 'CUSTOMER' ? 'FOOD' : 'SHIP',
    kind,
    title,
    body,
    targetType: 'DELIVERY',
    targetId: p.deliveryId,
    targetVersion: p.version,
    dedupeKey: `delivery:${p.deliveryId}:${p.change}:${String(p.version)}`,
    validForMs: null,
    pushTtlMs,
  },
});

/** What a delivery change tells whom. Unknown changes tell nobody (they are internal steps such as a pinned destination). */
export function composeDeliveryChange(p: DeliveryChangePayload): Draft[] {
  return [...composeForShopAndShipper(p), ...composeForCustomer(p)];
}

function composeForCustomer(p: DeliveryChangePayload): Draft[] {
  if (p.orderId === undefined || p.orderId === null) {
    return [];
  }
  const orderId = p.orderId;
  const notify = (kind: NotificationKind, title: string, body: string): Draft => ({
    type: 'NOTIFY',
    draft: { audience: 'CUSTOMER', app: 'FOOD', kind, title, body, targetType: 'ORDER', targetId: orderId, targetVersion: p.version, dedupeKey: `order-delivery:${orderId}:${p.deliveryId}:${p.change}:${String(p.version)}`, validForMs: null, pushTtlMs: PUSH_TTL_MS.result },
  });
  switch (p.change) {
    case 'accepted':
      return [notify('ORDER_SHIPPER_ACCEPTED', 'Shipper đã nhận đơn của bạn', `Đơn ${p.code}: shipper đang đến quán lấy món.`)];
    case 'picked_up':
      return [notify('ORDER_DELIVERING', 'Đơn của bạn đang được giao', `Đơn ${p.code}: shipper đã lấy món và đang giao.`)];
    case 'failed':
      return [notify('ORDER_DELIVERY_FAILED', 'Giao hàng chưa thành công', `Đơn ${p.code}: giao chưa thành công, quán đang xử lý. Mở ứng dụng để xem.`)];
    default:
      return [];
  }
}

function composeForShopAndShipper(p: DeliveryChangePayload): Draft[] {
  const code = p.code;
  switch (p.change) {
    case 'created':
    case 'recalled':
      return p.state === 'waiting_driver' ? [{ type: 'OFFER_ROUND', deliveryId: p.deliveryId, roundVersion: p.version }] : [];
    case 'accepted':
      return [delivery(p, 'SHOP', 'DELIVERY_ACCEPTED', 'Shipper đã nhận đơn', `Đơn ${code} đã có shipper nhận.`)];
    case 'released_by_shipper':
    case 'released_by_admin': {
      const out: Draft[] = [delivery(p, 'SHOP', 'DELIVERY_RELEASED', 'Shipper không còn nhận đơn', `Đơn ${code}: shipper đã hủy nhận. Mở ứng dụng để xem trạng thái.`)];
      if (p.change === 'released_by_admin' && p.driverId !== null) {
        out.push(delivery(p, 'DRIVER', 'ASSIGNMENT_RELEASED_BY_ADMIN', 'Đơn đã được gỡ khỏi bạn', `Đơn ${code} đã được quản trị viên gỡ khỏi bạn.`));
      }
      if (p.state === 'waiting_driver') {
        out.push({ type: 'OFFER_ROUND', deliveryId: p.deliveryId, roundVersion: p.version });
      }
      return out;
    }
    case 'picked_up':
      return [delivery(p, 'SHOP', 'DELIVERY_PICKED_UP', 'Shipper đã lấy hàng', `Đơn ${code} đang được giao.`)];
    case 'completed':
      return [delivery(p, 'SHOP', 'DELIVERY_COMPLETED', 'Giao hàng thành công', `Đơn ${code} đã giao thành công.`)];
    case 'failed':
      return [delivery(p, 'SHOP', 'DELIVERY_FAILED', 'Giao hàng không thành công', `Đơn ${code} giao không thành công. Cần bạn xử lý hàng.`)];
    case 'cancelled_by_shop':
      return p.driverId === null ? [] : [delivery(p, 'DRIVER', 'DELIVERY_CANCELLED', 'Quán đã hủy đơn', `Đơn ${code} đã bị quán hủy. Bạn không cần giao đơn này.`)];
    case 'search_stopped':
      return [delivery(p, 'SHOP', 'SEARCH_STOPPED', 'Chưa có shipper nhận đơn', `Đơn ${code} đã tìm 30 phút. Hãy gọi lại hoặc hủy.`)];
    case 'search_reminder_5':
      return [{ type: 'REMINDER', reminder: 'SEARCH_5', deliveryId: p.deliveryId, assignmentId: null }];
    case 'search_reminder_15':
      return [{ type: 'REMINDER', reminder: 'SEARCH_15', deliveryId: p.deliveryId, assignmentId: null }];
    case 'pickup_reminder':
      return p.driverId === null ? [] : [{ type: 'REMINDER', reminder: 'PICKUP', deliveryId: p.deliveryId, assignmentId: p.assignmentId }];
    case 'fee_countered':
      return [delivery(p, 'SHOP', 'FEE_COUNTERED', 'Shipper đề xuất phí khác', `Đơn ${code}: shipper đề xuất mức phí khác. Mở ứng dụng để phản hồi.`)];
    case 'fee_counter_accepted':
    case 'fee_counter_rejected':
    case 'fee_customer_confirmed':
      return [{ ...delivery(p, 'DRIVER_OF_AGREEMENT', 'FEE_UPDATED', 'Phí giao hàng đã được phản hồi', `Đơn ${code}: quán đã phản hồi về phí. Mở ứng dụng để xem.`) }];
    case 'goods_returned':
    case 'goods_handled':
      return p.driverId === null ? [] : [delivery(p, 'DRIVER', 'GOODS_SETTLED', 'Quán đã xử lý hàng', `Đơn ${code}: quán đã xác nhận xử lý hàng.`)];
    default:
      return [];
  }
}

export interface ReminderCopy {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
}

/** One reminder notification for N deliveries due together. `codes` is only used for a single delivery. */
export function reminderCopy(reminder: 'SEARCH_5' | 'SEARCH_15' | 'PICKUP', count: number, codes: readonly string[]): ReminderCopy {
  if (reminder === 'PICKUP') {
    return count === 1
      ? { kind: 'PICKUP_REMINDER', title: 'Bạn còn đơn chưa lấy hàng', body: `Đơn ${codes[0] ?? ''} đang chờ bạn đến lấy hàng.` }
      : { kind: 'PICKUP_REMINDER', title: `Bạn còn ${String(count)} đơn chưa lấy hàng`, body: 'Chạm để xem đơn cần lấy.' };
  }
  const minutes = reminder === 'SEARCH_5' ? '5' : '15';
  return count === 1
    ? { kind: 'SEARCH_REMINDER', title: 'Đơn vẫn đang tìm shipper', body: `Đơn ${codes[0] ?? ''} đã tìm ${minutes} phút, chưa có shipper nhận.` }
    : { kind: 'SEARCH_REMINDER', title: 'Đơn vẫn đang tìm shipper', body: `Có ${String(count)} đơn đã tìm ${minutes} phút, chưa có shipper nhận.` };
}

export const NEW_OFFERS_COPY = { kind: 'NEW_OFFERS' as const, title: 'Có đơn giao hàng mới', body: 'Xem danh sách đơn có thể nhận.' };

export const TOPUP_COPY = {
  CONFIRMED: { kind: 'TOPUP_CONFIRMED' as const, title: 'Nạp tiền thành công', body: 'Yêu cầu nạp tiền của bạn đã được xác nhận. Mở ví để xem số dư.' },
  REJECTED: { kind: 'TOPUP_REJECTED' as const, title: 'Yêu cầu nạp tiền bị từ chối', body: 'Yêu cầu nạp tiền của bạn chưa được chấp nhận. Mở ví để xem chi tiết.' },
};

export const PROFILE_COPY: Readonly<Record<string, { kind: NotificationKind; title: string; body: string } | undefined>> = {
  approved: { kind: 'PROFILE_APPROVED', title: 'Hồ sơ shipper đã được duyệt', body: 'Hồ sơ của bạn đã được duyệt. Mở ứng dụng để bắt đầu.' },
  rejected: { kind: 'PROFILE_REJECTED', title: 'Hồ sơ shipper chưa được duyệt', body: 'Hồ sơ của bạn chưa được duyệt. Mở ứng dụng để xem lý do và bổ sung.' },
  suspended: { kind: 'PROFILE_SUSPENDED', title: 'Tài khoản shipper bị tạm khóa', body: 'Tài khoản của bạn đang bị tạm khóa. Mở ứng dụng để xem chi tiết.' },
  reopened: { kind: 'PROFILE_REOPENED', title: 'Tài khoản shipper đã được mở lại', body: 'Tài khoản của bạn đã được mở lại.' },
};

// ---- M10 food orders ----------------------------------------------------------------------------------------------------------

export interface OrderChangePayload {
  readonly orderId: string;
  readonly code: string;
  readonly shopId: string;
  readonly customerUserId: string;
  readonly change: string;
  readonly status: string;
  readonly version: number;
}

const order = (p: OrderChangePayload, audience: 'SHOP' | 'CUSTOMER', kind: NotificationKind, title: string, body: string, pushTtlMs: number = PUSH_TTL_MS.result): Draft => ({
  type: 'NOTIFY',
  draft: {
    audience,
    app: 'FOOD',
    kind,
    title,
    body,
    targetType: 'ORDER',
    targetId: p.orderId,
    targetVersion: p.version,
    dedupeKey: `order:${p.orderId}:${p.change}:${String(p.version)}`,
    validForMs: null,
    pushTtlMs,
  },
});

/** What an Order change tells whom. The Order CODE is the only identifier shown; no dish, phone, address or amount reaches a lock screen. */
export function composeOrderChange(p: OrderChangePayload): Draft[] {
  const code = p.code;
  switch (p.change) {
    case 'placed':
      return [order(p, 'SHOP', 'ORDER_PLACED', 'Có đơn món mới', `Đơn ${code} đang chờ bạn xác nhận.`, PUSH_TTL_MS.offer)];
    case 'cancelled_by_customer':
      return [order(p, 'SHOP', 'ORDER_CANCELLED_BY_CUSTOMER', 'Khách đã hủy đơn món', `Đơn ${code} đã được khách hủy trước khi bạn xác nhận.`)];
    case 'schedule_reminder':
      return [order(p, 'SHOP', 'ORDER_SCHEDULE_REMINDER', 'Sắp đến giờ hẹn', `Đơn hẹn ${code} sắp đến giờ nhận món. Hãy chuẩn bị và gọi shipper.`, PUSH_TTL_MS.reminder)];
    case 'confirmed':
      return [order(p, 'CUSTOMER', 'ORDER_CONFIRMED', 'Quán đã xác nhận đơn', `Đơn ${code} đang được chuẩn bị.`)];
    case 'rejected':
      return [order(p, 'CUSTOMER', 'ORDER_REJECTED', 'Quán không nhận đơn', `Đơn ${code} chưa được quán nhận. Mở ứng dụng để xem lý do.`)];
    case 'cancelled_by_shop':
      return [order(p, 'CUSTOMER', 'ORDER_CANCELLED_BY_SHOP', 'Quán đã hủy đơn', `Đơn ${code} đã bị quán hủy. Mở ứng dụng để xem lý do.`)];
    case 'cancelled_by_admin':
      return [order(p, 'CUSTOMER', 'ORDER_CANCELLED_BY_SHOP', 'Đơn của bạn đã bị hủy', `Đơn ${code} đã được hủy. Mở ứng dụng để xem lý do.`), order(p, 'SHOP', 'ORDER_CANCELLED_BY_ADMIN', 'Quản trị viên đã hủy đơn', `Đơn ${code} đã được quản trị viên hủy.`)];
    case 'ready':
      return [order(p, 'CUSTOMER', 'ORDER_READY', 'Món đã sẵn sàng', `Món của đơn ${code} đã sẵn sàng.`)];
    case 'completed':
      return [order(p, 'CUSTOMER', 'ORDER_COMPLETED', 'Đơn đã hoàn thành', `Đơn ${code} đã giao thành công.`)];
    case 'not_completed':
    case 'not_completed_by_admin':
      return [order(p, 'CUSTOMER', 'ORDER_NOT_COMPLETED', 'Đơn không hoàn tất', `Đơn ${code} không hoàn tất. Mở ứng dụng để xem lý do.`)];
    default:
      return [];
  }
}
