// Model of "Vận hành › Giao hàng" (M07.07): the delivery list with filters and counters, the detail drawer (timeline, assignments, goods
// custody) and the few Admin actions. PLAIN DATA plus the port the page talks to: dom/deliveries-view.ts draws it, core/deliveries-api.ts is the
// real source. The page shows only what the server said; it never decides a right or a state change, and there is NO free "set status" field:
// each action has its own server-side condition. The internal Shipper classification is never part of this page.

import { Failure } from './accounts.js';

export const DELIVERY_PAGE_SIZE = 20;

export const DELIVERY_STATES = ['waiting_driver', 'accepted', 'location_confirmed', 'delivering', 'completed', 'failed', 'cancelled_by_merchant','cancelled_by_system', 'search_stopped'] as const;
export type DeliveryStateName = (typeof DELIVERY_STATES)[number] | 'picked_up';
export type DeliveryStateFilter = 'ALL' | (typeof DELIVERY_STATES)[number];

export const DELIVERY_STATE_LABEL: Record<DeliveryStateName | 'ALL', string> = {
  ALL: 'Tất cả trạng thái',
  waiting_driver: 'Đang tìm shipper',
  accepted: 'Shipper đã nhận',
  location_confirmed: 'Chờ lấy hàng',
  picked_up: 'Đang giao',
  delivering: 'Đang giao',
  completed: 'Giao thành công',
  failed: 'Giao thất bại',
  cancelled_by_system:'Hệ thống hủy quá hạn',
  cancelled_by_merchant: 'Quán đã hủy',
  search_stopped: 'Đã ngừng tìm',
};

export type GoodsFilter = 'ALL' | 'OPEN' | 'CLOSED';
export const GOODS_FILTER_LABEL: Record<GoodsFilter, string> = { ALL: 'Mọi tình trạng hàng', OPEN: 'Hàng chưa xử lý xong', CLOSED: 'Hàng đã xử lý' };

export type Freshness = 'LIVE' | 'STALE' | 'LOST';
export const FRESHNESS_LABEL: Record<Freshness, string> = { LIVE: 'Trực tiếp', STALE: 'Vị trí cũ', LOST: 'Mất kết nối vị trí' };

export type Custody = 'SHIPPER' | 'SHOP' | 'HANDLED';
export const CUSTODY_LABEL: Record<Custody, string> = { SHIPPER: 'Hàng ở shipper hoặc chưa rõ', SHOP: 'Hàng đã về quán', HANDLED: 'Đã xử lý, không giao tiếp' };

/** What needs a person, as the server derived it from the stored state (M12-B). */
export type DeliverySignal = 'SEARCH_STOPPED' | 'CUSTODY_OPEN' | 'FEE_UNKNOWN';
export const DELIVERY_SIGNALS: readonly DeliverySignal[] = ['SEARCH_STOPPED', 'CUSTODY_OPEN', 'FEE_UNKNOWN'];
export const DELIVERY_SIGNAL_LABEL: Record<DeliverySignal, string> = {
  SEARCH_STOPPED: 'Ngừng tìm, chưa gọi lại',
  CUSTODY_OPEN: 'Hàng chưa xử lý xong',
  FEE_UNKNOWN: 'Chưa xác định phí',
};

export type SourceFilter = 'ALL' | 'DIRECT' | 'ORDER';
export const SOURCE_FILTER_LABEL: Record<SourceFilter, string> = { ALL: 'Mọi nguồn', DIRECT: 'Quán gọi trực tiếp', ORDER: 'Từ Order' };

export interface DeliveryRow {
  readonly id: string;
  readonly code: string;
  readonly source: 'DIRECT' | 'ORDER';
  readonly orderId: string | null;
  /** Seconds the delivery has been waiting for the next step (searching: since the search began; accepted: since the Shipper took it); null when it is not waiting. */
  readonly waitSeconds: number | null;
  readonly signals: readonly DeliverySignal[];
  readonly shopName: string;
  readonly shipperName: string | null;
  readonly state: DeliveryStateName;
  readonly goodsValueVnd: number;
  /** null = fee not determined: shown "Chưa xác định phí", never 0. */
  readonly feeVnd: number | null;
  readonly incidentOpen: boolean;
  readonly custody: Custody | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeliveryCounters {
  readonly searching: number;
  readonly waitingPickup: number;
  readonly delivering: number;
  readonly needsAttention: number;
}

export interface DeliveryLocation {
  readonly lat: number;
  readonly lng: number;
  readonly recordedAt: string;
  readonly ageSeconds: number;
  readonly freshness: Freshness;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly shipperName: string;
  readonly shipperDriverId: string | null;
  readonly status: string;
  readonly acceptedAt: string;
  readonly endedAt: string | null;
  readonly endReason: string | null;
  /** Who ended the assignment (SHIPPER, SHOP, ADMIN, SYSTEM), null while it is active. */
  readonly endActor: string | null;
}

/** Why there is (or is not) a position, apart from the position itself: the map says which of these it is. */
export type LocationState = 'NO_SHIPPER' | 'NOT_RUNNING' | 'NO_POSITION' | 'AVAILABLE';
export const LOCATION_STATES: readonly LocationState[] = ['NO_SHIPPER', 'NOT_RUNNING', 'NO_POSITION', 'AVAILABLE'];

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export type CommissionHoldStatus = 'ACTIVE' | 'CAPTURED' | 'RELEASED';
export const COMMISSION_HOLD_LABEL: Record<CommissionHoldStatus, string> = { ACTIVE: 'Đang giữ', CAPTURED: 'Đã thu hoa hồng', RELEASED: 'Đã trả lại' };

export interface CommissionTrace {
  readonly assignmentId: string;
  readonly holdStatus: CommissionHoldStatus;
  readonly amountVnd: number;
  readonly ledgerEntryId: string | null;
  readonly ledgerAt: string | null;
}

/** The money facts of a delivery (M04 hold and ledger). FORBIDDEN: this Admin has no wallet.read, so nothing is shown (not even "0"). */
export type DeliveryMoney = { readonly status: 'OK'; readonly commissions: readonly CommissionTrace[] } | { readonly status: 'FORBIDDEN' };

export interface TimelineRecord {
  readonly at: string;
  readonly type: string;
  readonly actor: string;
  readonly note: string | null;
}

export interface IncidentRecord {
  readonly id: string;
  readonly status: 'OPEN' | 'CLOSED';
  readonly custody: Custody;
  readonly reason: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly m11ReferredAt: string | null;
}

export interface DeliveryDetail {
  readonly id: string;
  readonly code: string;
  readonly source: 'DIRECT' | 'ORDER';
  readonly orderId: string | null;
  readonly previousDeliveryId: string | null;
  readonly state: DeliveryStateName;
  readonly version: number;
  readonly shopName: string;
  readonly shipperName: string | null;
  /** The contact is filled only when the server allowed this Admin to see it; otherwise null. */
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly recipientAddress: string | null;
  readonly goodsDescription: string;
  readonly goodsValueVnd: number;
  readonly paidVnd: number;
  readonly feeVnd: number | null;
  readonly feeMode: string;
  readonly feePayer: 'CUSTOMER' | 'SHOP';
  readonly searchStartedAt: string;
  readonly searchExpiresAt: string;
  readonly location: DeliveryLocation | null;
  readonly locationState: LocationState;
  readonly pickup: { readonly addressText: string; readonly lat: number; readonly lng: number };
  /** `address`, `lat` and `lng` are filled only for an Admin who may see the contact; `areaText` is the coarse place. */
  readonly dropoff: { readonly areaText: string | null; readonly addressText: string | null; readonly point: GeoPoint | null; readonly pinned: boolean };
  readonly links: {
    readonly shopId: string;
    readonly shipperDriverId: string | null;
    readonly orderId: string | null;
    readonly previousDeliveryId: string | null;
    readonly nextDelivery: { readonly id: string; readonly code: string } | null;
  };
  readonly money: DeliveryMoney;
  readonly assignments: readonly AssignmentRecord[];
  readonly timeline: readonly TimelineRecord[];
  readonly incident: IncidentRecord | null;
  readonly policy: { readonly searchRadiusM: number; readonly commissionVnd: number | null; readonly feePolicyVersion: number | null };
  /** Actions the server allows THIS Admin on THIS delivery now. */
  readonly can: ReadonlySet<DeliveryActionName>;
}

export const DELIVERY_ACTIONS = ['record-custody', 'adjust-after-pickup', 'refer-m11', 'release-assignment'] as const;
export type DeliveryActionName = (typeof DELIVERY_ACTIONS)[number];

export interface DeliveryQuery {
  readonly query: string;
  readonly state: DeliveryStateFilter;
  readonly goods: GoodsFilter;
  readonly from: string;
  readonly to: string;
  readonly shop: string;
  readonly shipper: string;
  readonly page: number;
  /** M12: a named group of the overview tiles (searching, waiting_pickup, delivering, stopped, custody_open, attention). */
  readonly group?: DeliveryGroup;
  /** M12-B: only deliveries called directly by a shop, or only those from an Order. Absent = both. */
  readonly source?: SourceFilter;
  /** M12: which moment `from`/`to` bound; absent = the creation of the delivery. */
  readonly basis?: 'created' | 'ended';
}

export const DELIVERY_GROUPS = ['searching', 'waiting_pickup', 'delivering', 'stopped', 'custody_open', 'attention'] as const;
export type DeliveryGroup = (typeof DELIVERY_GROUPS)[number];

export const DELIVERY_GROUP_LABEL: Record<DeliveryGroup, string> = {
  searching: 'Đang tìm shipper',
  waiting_pickup: 'Chờ lấy hàng',
  delivering: 'Đang giao',
  stopped: 'Đã ngừng tìm, chưa gọi lại',
  custody_open: 'Giao thất bại, hàng chưa xử lý xong',
  attention: 'Cần xử lý',
};

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type DeliveryListRead =
  | { readonly kind: 'ready'; readonly rows: readonly DeliveryRow[]; readonly total: number; readonly counters: DeliveryCounters }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | Refused;

export type DeliveryDetailRead = { readonly kind: 'ready'; readonly delivery: DeliveryDetail } | { readonly kind: 'not-found' } | { readonly kind: 'not-wired'; readonly reason: string } | Refused;

export interface DeliveryActionRequest {
  readonly id: string;
  readonly name: DeliveryActionName;
  readonly version: number;
  /** Required by every action: why, for the audit. */
  readonly reason: string;
  /** record-custody: GOODS_RETURNED or HANDLED_NO_RETURN. */
  readonly resolution?: 'GOODS_RETURNED' | 'HANDLED_NO_RETURN';
  /** adjust-after-pickup: the new fee and/or the new descriptive address (the before/after is written to the audit). */
  readonly feeVnd?: number;
  readonly recipientAddress?: string;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type DeliveryActionResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the action MAY have run. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const DELIVERY_REFUSAL_MESSAGE: Record<string, string> = {
  DELIVERY_NOT_FOUND: 'Không tìm thấy yêu cầu giao này.',
  DELIVERY_STATE_CONFLICT: 'Trạng thái yêu cầu giao đã thay đổi nên thao tác này không còn phù hợp. Hãy tải lại.',
  ADMIN_ACTION_NOT_ALLOWED: 'Thao tác này không áp dụng cho yêu cầu giao ở trạng thái hiện tại.',
  FEE_LOCKED: 'Phí đã khóa sau khi nhận hàng. Chỉ chỉnh được bằng thao tác "Điều chỉnh sau lấy hàng" có lý do.',
  ADMIN_INPUT_INVALID: 'Thông tin gửi lên không hợp lệ (lý do bắt buộc, tối đa 500 ký tự).',
  M11_NOT_AVAILABLE: 'Module Phản ánh (M11) chưa sẵn sàng; hệ thống chỉ ghi dấu đã chuyển, chưa tạo phiếu.',
};

export const REASON_MAX = 500;

export function formatVnd(value: number): string {
  return `${value.toLocaleString('vi-VN')} ₫`;
}

export const FEE_UNKNOWN_TEXT = 'Chưa xác định phí';

export const NOT_WIRED_DELIVERIES_REASON = 'Quản lý giao hàng chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface DeliverySource {
  list(query: DeliveryQuery): Promise<DeliveryListRead>;
  detail(id: string): Promise<DeliveryDetailRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  action(request: DeliveryActionRequest): Promise<DeliveryActionResult>;
}

export const NOT_WIRED_DELIVERIES: DeliverySource = {
  list: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_DELIVERIES_REASON }),
  detail: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_DELIVERIES_REASON }),
  action: () => Promise.resolve({ kind: 'not-wired' }),
};
