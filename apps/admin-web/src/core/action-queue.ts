// Model of "Việc cần xử lý" (#216): the FILES behind the to-do figures of the overview, with why each waits, since when and where to open it. PLAIN DATA plus the
// small rules the page applies to what the server said (labels, age text, the link a row opens). Nothing is counted here: the server sends one row per file, a
// source the administrator may not see is FORBIDDEN and one that failed is ERROR - neither is ever shown as an empty list or 0 - and the page never invents a
// "late" mark: it prints one only when the server says `overdue: true` by a rule the system already has.

import { Failure } from './accounts.js';

export const QUEUE_KINDS = [
  'DELIVERY_STOPPED',
  'ORDER_AWAITING_CONFIRMATION',
  'GOODS_OPEN',
  'SHIPPER_REVIEW',
  'COMPLAINT',
  'ADJUSTMENT_PENDING_FINANCE',
  'TOPUP_PENDING',
  'WITHDRAWAL_OPEN',
  'SHOP_PAYMENT_PENDING',
  'SHOP_PAYMENT_AWAITING_GRANT',
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const QUEUE_KIND_LABEL: Record<QueueKind, string> = {
  DELIVERY_STOPPED: 'Giao hàng ngừng tìm shipper',
  ORDER_AWAITING_CONFIRMATION: 'Đơn chờ quán xác nhận',
  GOODS_OPEN: 'Hàng chưa xử lý sau giao thất bại',
  SHIPPER_REVIEW: 'Hồ sơ shipper chờ duyệt',
  COMPLAINT: 'Phản ánh chưa xử lý',
  ADJUSTMENT_PENDING_FINANCE: 'Điều chỉnh chờ tài chính',
  TOPUP_PENDING: 'Nạp ví chờ xác nhận',
  WITHDRAWAL_OPEN: 'Rút tiền chưa hoàn tất',
  SHOP_PAYMENT_PENDING: 'Thanh toán quán chờ xác nhận tiền',
  SHOP_PAYMENT_AWAITING_GRANT: 'Đã nhận tiền, chờ cấp quyền thực đơn',
};

/** The status codes a row may carry, in the words an administrator reads. An unknown code is shown as is, never hidden. */
export const QUEUE_STATUS_LABEL: Record<string, string> = {
  search_stopped: 'Ngừng tìm shipper',
  PENDING_CONFIRMATION: 'Chờ quán xác nhận',
  OPEN: 'Hàng chưa bàn giao xong',
  SUBMITTED: 'Đã nộp, chờ duyệt',
  PENDING: 'Chờ xử lý',
  IN_PROGRESS: 'Đang xử lý',
  AWAITING_INFO: 'Chờ bổ sung thông tin',
  RECONSIDERATION_PENDING: 'Chờ xem xét lại',
  PENDING_FINANCE: 'Chờ tài chính',
  PROCESSING: 'Đang chuyển khoản',
  RECONCILIATION: 'Chờ đối soát',
  CONFIRMED: 'Đã xác nhận tiền',
};

export const WAITING_ON_LABEL: Record<string, string> = { ADMIN: 'Quản trị', SHOP: 'Quán', SHIPPER: 'Shipper', SUBMITTER: 'Người gửi' };

/** Where a row opens. Only the closed set of areas the server may name; `business-finance` is the separate Business console, never a path the server wrote. */
export type QueueLinkArea = 'deliveries' | 'orders' | 'complaints' | 'shipper' | 'finance-topup' | 'finance-withdrawal' | 'business-finance';
export const QUEUE_LINK_AREAS: readonly QueueLinkArea[] = ['deliveries', 'orders', 'complaints', 'shipper', 'finance-topup', 'finance-withdrawal', 'business-finance'];

export interface QueueLink {
  readonly area: QueueLinkArea;
  readonly query: Readonly<Record<string, string>>;
}

export interface QueueItem {
  readonly key: string;
  readonly kind: QueueKind;
  readonly code: string;
  readonly status: string;
  readonly reason: string;
  /** ISO instant the file began to wait. */
  readonly waitingSince: string;
  readonly ageSeconds: number;
  /** true only by a rule the system already has; null = no such rule (never printed as "on time" either). */
  readonly overdue: boolean | null;
  readonly waitingOn: string | null;
  /** HANDLE: the administrator holds the right to act on the owning screen; VIEW: only to read. The owning endpoint checks again. */
  readonly action: 'HANDLE' | 'VIEW';
  readonly link: QueueLink;
  readonly detail: Readonly<Record<string, string | number | null>>;
}

export type QueueSource =
  | { readonly kind: QueueKind; readonly status: 'OK'; readonly count: number; readonly truncated: boolean }
  | { readonly kind: QueueKind; readonly status: 'FORBIDDEN' | 'ERROR' };

export interface ActionQueue {
  readonly generatedAt: string;
  readonly sources: readonly QueueSource[];
  readonly total: number;
  readonly items: readonly QueueItem[];
}

export const QUEUE_SORTS = ['oldest', 'newest'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

export interface QueueQuery {
  readonly kind?: QueueKind;
  readonly status?: string;
  /** `YYYY-MM-DD` days of the Vietnam calendar, on the moment the file began to wait. */
  readonly from?: string;
  readonly to?: string;
  readonly sort?: QueueSort;
}

export type ActionQueueRead =
  | { readonly kind: 'ready'; readonly queue: ActionQueue }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

/** Why a source is not a list, in words; it is never an empty table. */
export function sourceProblemText(status: 'FORBIDDEN' | 'ERROR'): string {
  return status === 'FORBIDDEN' ? 'Bạn không có quyền xem mục này' : 'Không tải được mục này';
}

/** "3 giờ 5 phút", "2 ngày 4 giờ", "45 giây": the two largest non-zero units of a wait. */
export function ageText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const units: ReadonlyArray<readonly [number, string]> = [
    [86_400, 'ngày'],
    [3_600, 'giờ'],
    [60, 'phút'],
  ];
  for (let index = 0; index < units.length; index += 1) {
    const [size, label] = units[index] as readonly [number, string];
    if (total >= size) {
      const first = Math.floor(total / size);
      const next = units[index + 1];
      const rest = next === undefined ? 0 : Math.floor((total % size) / next[0]);
      return rest > 0 && next !== undefined ? `${first} ${label} ${rest} ${next[1]}` : `${first} ${label}`;
    }
  }
  return `${total} giây`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What opening a row does. A detail screen is opened only with a well-formed id; anything else falls back to the list the row belongs to. The Business console is a
 * separate page: its address is built here from a checked request id, never taken from the server as text.
 */
export type QueueTarget = { readonly kind: 'route'; readonly area: 'deliveries' | 'orders' | 'complaints' | 'shippers' | 'finance-topups' | 'finance-withdrawals'; readonly query: Readonly<Record<string, string>> } | { readonly kind: 'detail'; readonly area: 'shipper' | 'finance-topup' | 'finance-withdrawal'; readonly id: string } | { readonly kind: 'page'; readonly href: string };

export function queueTarget(link: QueueLink): QueueTarget {
  switch (link.area) {
    case 'deliveries':
    case 'orders':
    case 'complaints':
      return { kind: 'route', area: link.area, query: link.query };
    case 'shipper':
    case 'finance-topup':
    case 'finance-withdrawal': {
      const id = link.query.id;
      if (id !== undefined && UUID.test(id)) {
        return { kind: 'detail', area: link.area, id };
      }
      return link.area === 'shipper' ? { kind: 'route', area: 'shippers', query: { status: 'SUBMITTED' } } : link.area === 'finance-topup' ? { kind: 'route', area: 'finance-topups', query: { status: 'PENDING' } } : { kind: 'route', area: 'finance-withdrawals', query: {} };
    }
    case 'business-finance': {
      const request = link.query.request;
      return request !== undefined && UUID.test(request) ? { kind: 'page', href: `/business/finance?request=${encodeURIComponent(request)}` } : { kind: 'page', href: '/business/finance' };
    }
  }
}
