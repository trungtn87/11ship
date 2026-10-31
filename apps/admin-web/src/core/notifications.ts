import { Failure } from './accounts.js';

// Types and wording of "Vận hành › Thông báo" (M08.06): the work queue, the search, the detail of one notification with its push attempts, and the settings.
// Pure data: no DOM and no network. The page draws what the server said; "Đã gửi" only means the push service accepted the message, and a failure is shown only
// with the evidence the row holds (nothing is guessed from the absence of a push).

export const NOTIFICATION_PAGE_SIZE = 20;

export type NotificationApp = 'FOOD' | 'SHIP';
export const NOTIFICATION_APP_LABEL: Record<NotificationApp | 'ALL', string> = { ALL: 'Tất cả ứng dụng', FOOD: '11Food', SHIP: '11Ship' };

export const NOTIFICATION_KINDS = [
  'DELIVERY_ACCEPTED',
  'DELIVERY_RELEASED',
  'DELIVERY_PICKED_UP',
  'DELIVERY_COMPLETED',
  'DELIVERY_FAILED',
  'DELIVERY_CANCELLED',
  'SEARCH_STOPPED',
  'SEARCH_REMINDER',
  'FEE_COUNTERED',
  'FEE_UPDATED',
  'GOODS_SETTLED',
  'NEW_OFFERS',
  'PICKUP_REMINDER',
  'ASSIGNMENT_RELEASED_BY_ADMIN',
  'TOPUP_CONFIRMED',
  'TOPUP_REJECTED',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_PROCESSING',
  'WITHDRAWAL_RECONCILING',
  'WITHDRAWAL_PAID',
  'WITHDRAWAL_CANCELLED',
  'PROFILE_APPROVED',
  'PROFILE_REJECTED',
  'PROFILE_SUSPENDED',
  'PROFILE_REOPENED',
] as const;
export type NotificationKindName = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABEL: Record<NotificationKindName | 'ALL', string> = {
  ALL: 'Tất cả loại',
  DELIVERY_ACCEPTED: 'Shipper nhận đơn',
  DELIVERY_RELEASED: 'Shipper hủy nhận',
  DELIVERY_PICKED_UP: 'Đã lấy hàng',
  DELIVERY_COMPLETED: 'Giao thành công',
  DELIVERY_FAILED: 'Giao thất bại',
  DELIVERY_CANCELLED: 'Quán hủy giao',
  SEARCH_STOPPED: 'Ngừng tìm shipper',
  SEARCH_REMINDER: 'Nhắc tìm shipper',
  FEE_COUNTERED: 'Đề xuất phí khác',
  FEE_UPDATED: 'Phản hồi về phí',
  GOODS_SETTLED: 'Xử lý hàng',
  NEW_OFFERS: 'Có đơn giao hàng mới',
  PICKUP_REMINDER: 'Nhắc lấy hàng',
  ASSIGNMENT_RELEASED_BY_ADMIN: 'Gỡ đơn khỏi shipper',
  TOPUP_CONFIRMED: 'Nạp tiền thành công',
  TOPUP_REJECTED: 'Nạp tiền bị từ chối',
  WITHDRAWAL_REQUESTED: 'Đã nhận yêu cầu rút tiền',
  WITHDRAWAL_PROCESSING: 'Rút tiền đang xử lý',
  WITHDRAWAL_RECONCILING: 'Rút tiền cần đối soát',
  WITHDRAWAL_PAID: 'Rút tiền đã xác nhận chuyển',
  WITHDRAWAL_CANCELLED: 'Rút tiền đã hủy',
  PROFILE_APPROVED: 'Hồ sơ được duyệt',
  PROFILE_REJECTED: 'Hồ sơ bị từ chối',
  PROFILE_SUSPENDED: 'Tạm khóa tài khoản',
  PROFILE_REOPENED: 'Mở lại tài khoản',
};

export const SEND_STATUSES = ['PENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED'] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];
export type SendStatusFilter = 'ALL' | SendStatus;
export const SEND_STATUS_LABEL: Record<SendStatusFilter, string> = { ALL: 'Tất cả trạng thái', PENDING: 'Chờ thử lại', SENT: 'Đã gửi', FAILED: 'Gửi lỗi', EXPIRED: 'Hết hiệu lực', SKIPPED: 'Không gửi' };

export interface NotificationRow {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: NotificationKindName;
  readonly title: string;
  readonly body: string;
  readonly app: NotificationApp;
  readonly recipientUserId: string;
  readonly deliveryCode: string | null;
  readonly pushStatus: SendStatus | null;
  readonly attempts: number;
  readonly expired: boolean;
}

export interface ChannelRecord {
  readonly channel: 'APP' | 'PUSH';
  readonly status: string;
  readonly at: string | null;
  readonly skipReason: string | null;
  readonly reasonText: string | null;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly sentAt: string | null;
  readonly errorCode: string | null;
  readonly evidence: string | null;
  readonly nextAttemptAt: string | null;
  readonly expiresAt: string | null;
}

export interface NotificationDetail {
  readonly id: string;
  readonly kind: NotificationKindName;
  readonly title: string;
  readonly app: NotificationApp;
  readonly recipientUserId: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly validUntil: string | null;
  readonly archivedAt: string | null;
  readonly deleteAfter: string | null;
  readonly target: { readonly type: string; readonly id: string | null; readonly code: string | null };
  readonly channels: readonly ChannelRecord[];
  readonly note: string;
}

export interface WorkQueue {
  readonly counters: { readonly failedPushes: number; readonly latePushes: number; readonly noDevice: number; readonly deadEvents: number; readonly lateReminders: number; readonly goodsCases: number };
  readonly providerConfigured: boolean;
  readonly failures: readonly { readonly id: string; readonly kind: NotificationKindName; readonly app: NotificationApp; readonly status: string; readonly errorCode: string | null; readonly evidence: string | null; readonly at: string }[];
  readonly goodsCases: readonly { readonly deliveryId: string; readonly code: string; readonly shopName: string; readonly openedAt: string }[];
}

export interface NotificationConfig {
  readonly version: number;
  readonly pushEnabled: boolean;
  readonly defaultSound: boolean;
  readonly visibleDays: number;
  readonly purgeDays: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseSeconds: number;
  readonly providerConfigured: boolean;
  readonly shopReminderMinutes: readonly number[];
  readonly searchStopMinutes: number;
  readonly pickupReminderMinutes: number;
}

export interface NotificationQuery {
  readonly query: string;
  readonly kind: NotificationKindName | 'ALL';
  readonly status: SendStatusFilter;
  readonly app: NotificationApp | 'ALL';
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };
export type NotWired = { readonly kind: 'not-wired'; readonly reason: string };

export type NotificationListRead = { readonly kind: 'ready'; readonly rows: readonly NotificationRow[]; readonly total: number } | NotWired | Refused;
export type NotificationDetailRead = { readonly kind: 'ready'; readonly detail: NotificationDetail } | { readonly kind: 'not-found' } | NotWired | Refused;
export type WorkQueueRead = { readonly kind: 'ready'; readonly queue: WorkQueue } | NotWired | Refused;
export type ConfigRead = { readonly kind: 'ready'; readonly config: NotificationConfig } | NotWired | Refused;

export interface ConfigSave {
  readonly version: number;
  readonly pushEnabled: boolean;
  readonly defaultSound: boolean;
  readonly visibleDays: number;
  readonly purgeDays: number;
  readonly retryMaxAttempts: number;
  readonly retryBaseSeconds: number;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type ConfigSaveResult =
  | { readonly kind: 'ok'; readonly config: NotificationConfig }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'invalid' }
  /** The answer was lost: the change MAY have been saved. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const NOT_WIRED_NOTIFICATIONS_REASON = 'Thông báo chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface NotificationSource {
  workQueue(): Promise<WorkQueueRead>;
  list(query: NotificationQuery): Promise<NotificationListRead>;
  detail(id: string): Promise<NotificationDetailRead>;
  config(): Promise<ConfigRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  saveConfig(request: ConfigSave): Promise<ConfigSaveResult>;
}

const notWired = (): Promise<NotWired> => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_NOTIFICATIONS_REASON });
export const NOT_WIRED_NOTIFICATIONS: NotificationSource = {
  workQueue: notWired,
  list: notWired,
  detail: notWired,
  config: notWired,
  saveConfig: () => Promise.resolve({ kind: 'not-wired' }),
};

/** The channel of a push row, in the words of the design table. */
export const CHANNEL_TEXT = 'Push · App';

export const RETENTION_TEXT = (visibleDays: number, purgeDays: number): string => `Hiển thị ${String(visibleDays)} ngày · Xóa sau tổng cộng ${String(purgeDays)} ngày.`;
