// Model of "Vận hành › Đơn hàng" (M10.05): the list of food Orders with filters, the detail drawer (the dishes with the shop's edits, the amounts, the
// calls for a Shipper, the timeline with who changed what and why) and the two exception actions. PLAIN DATA plus the port the page talks to:
// dom/orders-view.ts draws it, core/orders-api.ts is the real source. The page shows only what the server said; it never decides a right or a state
// change, and there is NO free "set status" field: each action has its own server-side condition and a mandatory reason.

import { Failure } from './accounts.js';
import { FEE_UNKNOWN_TEXT, formatVnd } from './deliveries.js';

export { FEE_UNKNOWN_TEXT, formatVnd };

export const ORDER_PAGE_SIZE = 20;

export const ORDER_STATUSES = ['PENDING_CONFIRMATION', 'PREPARING', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP', 'REJECTED_BY_SHOP', 'NOT_COMPLETED'] as const;
export type OrderStatusName = (typeof ORDER_STATUSES)[number];
export type OrderStatusFilter = 'ALL' | OrderStatusName;

export const ORDER_STATUS_LABEL: Record<OrderStatusName | 'ALL', string> = {
  ALL: 'Tất cả trạng thái',
  PENDING_CONFIRMATION: 'Chờ quán xác nhận',
  PREPARING: 'Đang chuẩn bị / giao',
  COMPLETED: 'Hoàn thành',
  CANCELLED_BY_CUSTOMER: 'Khách đã hủy',
  CANCELLED_BY_SHOP: 'Đã hủy (quán / Admin)',
  REJECTED_BY_SHOP: 'Quán từ chối',
  NOT_COMPLETED: 'Không hoàn tất',
};

export const DISPLAY_LABEL: Record<string, string> = {
  AWAITING_SHOP: 'Chờ quán xác nhận',
  PREPARING: 'Quán đang chuẩn bị',
  READY: 'Món đã sẵn sàng — chờ lấy',
  SEARCHING_SHIPPER: 'Đang tìm shipper',
  SHIPPER_COMING: 'Shipper đang đến quán',
  DELIVERING: 'Đang giao',
  COMPLETED: 'Hoàn thành',
  SEARCH_STOPPED: 'Chưa tìm được shipper — quán đang xử lý',
  DELIVERY_FAILED: 'Giao thất bại — đang xử lý',
  CANCELLED_BY_CUSTOMER: 'Đã hủy',
  CANCELLED_BY_SHOP: 'Đã hủy',
  REJECTED: 'Quán từ chối',
  NOT_COMPLETED: 'Không hoàn tất',
};

export interface OrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatusName;
  readonly display: string;
  readonly shopName: string;
  readonly recipientName: string;
  readonly lineCount: number;
  readonly itemsVnd: number;
  readonly scheduledFor: string | null;
  readonly edited: boolean;
  readonly needsAttention: boolean;
  readonly createdAt: string;
}

export interface OrderLineRecord {
  readonly name: string;
  readonly note: string | null;
  readonly quantity: number;
  readonly unitPriceVnd: number;
  readonly removed: boolean;
  /** What the customer ordered, when the shop changed the line. */
  readonly original: { readonly quantity: number; readonly unitPriceVnd: number } | null;
}

export interface OrderCall {
  readonly id: string;
  readonly code: string;
  readonly state: string;
  readonly previousId: string | null;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
}

export interface OrderEventRecord {
  readonly at: string;
  readonly type: string;
  readonly actor: string;
  readonly note: string | null;
}

export interface OrderFeeRecord {
  readonly payer: 'CUSTOMER' | 'SHOP';
  /** null = fee not determined: shown "Chưa xác định phí", never 0. */
  readonly amountVnd: number | null;
  readonly estimateVnd: number | null;
}

export type OrderActionName = 'cancel-order' | 'close-not-completed';
export const ORDER_ACTIONS: readonly OrderActionName[] = ['cancel-order', 'close-not-completed'];

export interface OrderDetail {
  readonly id: string;
  readonly code: string;
  readonly status: OrderStatusName;
  readonly display: string;
  readonly version: number;
  readonly shopName: string;
  readonly customerUserId: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly recipientAddress: string;
  readonly note: string | null;
  readonly scheduledFor: string | null;
  readonly lines: readonly OrderLineRecord[];
  readonly originalItemsVnd: number;
  readonly itemsVnd: number;
  readonly paidVnd: number;
  readonly fee: OrderFeeRecord;
  readonly edited: boolean;
  readonly changeReason: string | null;
  readonly endActor: string | null;
  readonly endReason: string | null;
  readonly createdAt: string;
  readonly calls: readonly OrderCall[];
  readonly timeline: readonly OrderEventRecord[];
  /** Actions the server allows THIS Admin on THIS order now. */
  readonly can: ReadonlySet<OrderActionName>;
}

export interface OrderQuery {
  readonly query: string;
  readonly status: OrderStatusFilter;
  readonly shop: string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type OrderListRead = { readonly kind: 'ready'; readonly rows: readonly OrderRow[]; readonly total: number } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;
export type OrderDetailRead = { readonly kind: 'ready'; readonly order: OrderDetail } | { readonly kind: 'not-found' } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export interface OrderActionRequest {
  readonly id: string;
  readonly name: OrderActionName;
  readonly version: number;
  /** Required by every action: why, for the audit. */
  readonly reason: string;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type OrderActionResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the action MAY have run. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const ORDER_REFUSAL_MESSAGE: Record<string, string> = {
  ORDER_NOT_FOUND: 'Không tìm thấy đơn này.',
  ADMIN_ACTION_NOT_ALLOWED: 'Thao tác này không áp dụng cho đơn ở trạng thái hiện tại.',
  AFTER_PICKUP_NO_CANCEL: 'Shipper đã lấy hàng nên không hủy đơn món được nữa.',
  RECALL_BLOCKED_GOODS_OUT: 'Hàng chưa về quán hoặc chưa được xử lý nên chưa thực hiện được.',
  ORDER_STATE_CONFLICT: 'Trạng thái đơn đã thay đổi nên thao tác này không còn phù hợp. Hãy tải lại.',
  ADMIN_INPUT_INVALID: 'Thông tin gửi lên không hợp lệ (lý do bắt buộc, tối đa 300 ký tự).',
};

export const ORDER_REASON_MAX = 300;

export const NOT_WIRED_ORDERS_REASON = 'Quản lý đơn hàng chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface OrderSource {
  list(query: OrderQuery): Promise<OrderListRead>;
  detail(id: string): Promise<OrderDetailRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  action(request: OrderActionRequest): Promise<OrderActionResult>;
}

export const NOT_WIRED_ORDERS: OrderSource = {
  list: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_ORDERS_REASON }),
  detail: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_ORDERS_REASON }),
  action: () => Promise.resolve({ kind: 'not-wired' }),
};
