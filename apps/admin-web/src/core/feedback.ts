// Model of "Vận hành › Đánh giá" and "Vận hành › Phản ánh" (M11.03): the rating list with the hide / restore moderation, the complaint list with counters, the
// detail drawer (content, evidence, the related order and delivery, the thread, the adjustments) and the Admin actions. PLAIN DATA plus the port the pages
// talk to: dom/feedback-view.ts draws it, core/feedback-api.ts is the real source. The pages show only what the server said; they never decide a right or a
// state (the buttons follow the `can` list the server returned for this Admin and this file) and there is NO field that edits the stars or the text of a
// rating, and none that sets a status. Money is a separate right: handling complaints never includes it.

import { Failure } from './accounts.js';

export const FEEDBACK_PAGE_SIZE = 20;

export const COMPLAINT_STATUSES = ['PENDING', 'IN_PROGRESS', 'AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const COMPLAINT_STATUS_LABEL: Record<ComplaintStatus | 'ALL', string> = {
  ALL: 'Tất cả trạng thái',
  PENDING: 'Chờ tiếp nhận',
  IN_PROGRESS: 'Đang xử lý',
  AWAITING_INFO: 'Chờ bổ sung',
  RESOLVED: 'Đã giải quyết',
  CLOSED_NO_ACTION: 'Đóng không xử lý',
};

export const COMPLAINT_CATEGORIES = ['DELIVERY_RESULT', 'GOODS', 'MONEY_FEE', 'SERVICE', 'SHIPPER_REVIEW', 'OTHER'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_CATEGORY_LABEL: Record<ComplaintCategory | 'ALL', string> = {
  ALL: 'Tất cả nhóm',
  DELIVERY_RESULT: 'Kết quả giao',
  GOODS: 'Hàng hóa',
  MONEY_FEE: 'Tiền/phí',
  SERVICE: 'Thái độ/phục vụ',
  SHIPPER_REVIEW: 'Đánh giá shipper',
  OTHER: 'Khác',
};

export type SubmitterRole = 'CUSTOMER' | 'SHOP' | 'SHIPPER';
export const SUBMITTER_LABEL: Record<SubmitterRole | 'ALL', string> = { ALL: 'Mọi người gửi', CUSTOMER: 'Khách hàng', SHOP: 'Quán', SHIPPER: 'Shipper' };

export type ReviewKind = 'SHOP_BY_CUSTOMER' | 'SHIPPER_BY_CUSTOMER' | 'SHIPPER_BY_SHOP';
export const REVIEW_KIND_LABEL: Record<ReviewKind | 'ALL', string> = {
  ALL: 'Mọi nguồn',
  SHOP_BY_CUSTOMER: 'Khách đánh giá quán',
  SHIPPER_BY_CUSTOMER: 'Khách đánh giá shipper',
  SHIPPER_BY_SHOP: 'Quán đánh giá shipper',
};

export const MODERATION_REASONS = ['WRONG_ORDER', 'ABUSIVE', 'PERSONAL_DATA', 'SPAM', 'VERIFIED_FALSE', 'MISTAKE_RESOLVED', 'OTHER'] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];
export const MODERATION_REASON_LABEL: Record<ModerationReason, string> = {
  WRONG_ORDER: 'Đánh giá nhầm đơn hoặc nhầm người',
  ABUSIVE: 'Lời lẽ xúc phạm',
  PERSONAL_DATA: 'Lộ thông tin cá nhân',
  SPAM: 'Spam / không liên quan',
  VERIFIED_FALSE: 'Đã xác minh là sai sự thật',
  MISTAKE_RESOLVED: 'Đã giải quyết nhầm lẫn (khôi phục)',
  OTHER: 'Lý do khác (ghi rõ)',
};

export interface ReviewRow {
  readonly id: string;
  readonly kind: ReviewKind;
  readonly stars: number;
  readonly comment: string | null;
  readonly visibility: 'VISIBLE' | 'HIDDEN';
  readonly shopName: string;
  readonly shipperName: string | null;
  readonly relatedCode: string;
  readonly hasReply: boolean;
  readonly createdAt: string;
  readonly version: number;
}

export interface ReviewCounters {
  readonly total: number;
  readonly hidden: number;
  readonly low: number;
}

export interface ModerationRecord {
  readonly action: 'HIDE' | 'RESTORE';
  readonly reasonCode: string;
  readonly reasonNote: string | null;
  readonly at: string;
}

export interface ReviewDetail extends ReviewRow {
  readonly reviewerName: string;
  readonly deliveryCode: string | null;
  readonly deliveryState: string | null;
  readonly reply: { readonly body: string; readonly version: number; readonly updatedAt: string } | null;
  readonly replyHistory: readonly { readonly version: number; readonly body: string; readonly writtenAt: string }[];
  readonly moderations: readonly ModerationRecord[];
  readonly complaints: readonly { readonly id: string; readonly code: string; readonly status: ComplaintStatus }[];
  readonly can: ReadonlySet<'hide' | 'restore'>;
}

export interface ReviewQuery {
  readonly kind: ReviewKind | 'ALL';
  readonly stars: number | 'ALL';
  readonly visibility: 'ALL' | 'VISIBLE' | 'HIDDEN';
  readonly query: string;
  readonly from: string;
  readonly to: string;
  readonly shop: string;
  readonly shipper: string;
  readonly page: number;
}

export interface ComplaintRow {
  readonly id: string;
  readonly code: string;
  readonly summary: string;
  readonly category: ComplaintCategory;
  readonly status: ComplaintStatus;
  readonly submitterRole: SubmitterRole;
  readonly relatedCode: string;
  readonly shopName: string;
  readonly shipperName: string | null;
  readonly assignedTo: string | null;
  readonly reconsiderationPending: boolean;
  readonly createdAt: string;
}

export interface ComplaintCounters {
  readonly pending: number;
  readonly inProgress: number;
  readonly awaitingInfo: number;
  readonly reconsiderations: number;
}

export interface ThreadLine {
  readonly id: string;
  readonly kind: string;
  readonly visibility: string;
  readonly audienceRole: string | null;
  readonly authorType: string;
  readonly body: string | null;
  readonly createdAt: string;
  readonly attachments: readonly { readonly id: string; readonly contentType: string; readonly byteSize: number }[];
}

export interface AdjustmentRecord {
  readonly kind: 'DELIVERY_RESULT' | 'COMMISSION';
  readonly originalState: string;
  readonly originalAssignmentStatus: string | null;
  readonly correctedResult: 'DELIVERED' | 'NOT_DELIVERED' | null;
  readonly direction: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER' | null;
  readonly amountVnd: number | null;
  readonly status: 'RECORDED' | 'PENDING_FINANCE' | 'EXECUTED';
  readonly pendingReason: string | null;
  readonly historyReviewed: boolean;
  readonly successorCount: number;
  readonly reason: string;
  readonly createdAt: string;
}

export interface DeliveryHistoryLine {
  readonly at: string;
  readonly type: string;
  readonly actor: string;
  readonly note: string | null;
}

export interface RelatedDelivery {
  readonly code: string;
  readonly state: string;
  readonly shipperName: string | null;
  readonly feeVnd: number | null;
  readonly custody: string | null;
  readonly incidentStatus: string | null;
  readonly assignments: readonly { readonly shipperName: string; readonly status: string; readonly acceptedAt: string; readonly endedAt: string | null }[];
  readonly timeline: readonly DeliveryHistoryLine[];
}

export const COMPLAINT_ACTIONS = ['receive', 'assign', 'note', 'request-info', 'conclude', 'close', 'decide-reconsideration', 'adjust-result', 'adjust-commission'] as const;
export type ComplaintActionName = (typeof COMPLAINT_ACTIONS)[number];

export interface ComplaintDetail {
  readonly id: string;
  readonly code: string;
  readonly category: ComplaintCategory;
  readonly status: ComplaintStatus;
  readonly awaitingFrom: string | null;
  readonly submitterRole: SubmitterRole;
  readonly body: string;
  readonly conclusion: string | null;
  readonly closeReason: string | null;
  readonly relatedCode: string;
  readonly shopName: string;
  readonly shipperName: string | null;
  readonly assignee: { readonly id: string; readonly name: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly version: number;
  readonly thread: readonly ThreadLine[];
  readonly reconsiderations: readonly { readonly requestedAt: string; readonly reason: string; readonly status: string; readonly decisionReason: string | null }[];
  readonly delivery: RelatedDelivery | null;
  readonly chain: readonly { readonly code: string; readonly state: string }[];
  readonly review: { readonly stars: number; readonly comment: string | null; readonly source: string; readonly visibility: string } | null;
  readonly adjustments: readonly AdjustmentRecord[];
  readonly financeAllowed: boolean;
  readonly can: ReadonlySet<ComplaintActionName>;
}

export interface ComplaintQuery {
  readonly query: string;
  readonly status: ComplaintStatus | 'ALL';
  readonly category: ComplaintCategory | 'ALL';
  readonly submitterRole: SubmitterRole | 'ALL';
  readonly shop: string;
  readonly shipper: string;
  readonly assignee: 'ALL' | 'ME' | 'NONE' | string;
  readonly from: string;
  readonly to: string;
  readonly page: number;
}

export type Refused = { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };
export type NotWired = { readonly kind: 'not-wired'; readonly reason: string };

export type ReviewListRead = { readonly kind: 'ready'; readonly rows: readonly ReviewRow[]; readonly total: number; readonly counters: ReviewCounters } | NotWired | Refused;
export type ReviewDetailRead = { readonly kind: 'ready'; readonly review: ReviewDetail } | { readonly kind: 'not-found' } | NotWired | Refused;
export type ComplaintListRead = { readonly kind: 'ready'; readonly rows: readonly ComplaintRow[]; readonly total: number; readonly counters: ComplaintCounters } | NotWired | Refused;
export type ComplaintDetailRead = { readonly kind: 'ready'; readonly complaint: ComplaintDetail } | { readonly kind: 'not-found' } | NotWired | Refused;
export type HandlersRead = { readonly kind: 'ready'; readonly handlers: readonly { readonly id: string; readonly name: string }[] } | NotWired | Refused;

export interface ReviewActionRequest {
  readonly id: string;
  readonly name: 'hide' | 'restore';
  readonly version: number;
  readonly reasonCode: ModerationReason;
  readonly reasonNote: string | null;
  /** Idempotency-Key of THIS intent. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export interface ComplaintActionRequest {
  readonly id: string;
  readonly name: ComplaintActionName;
  readonly version: number;
  readonly key: string;
  readonly assigneeId?: string | null;
  readonly body?: string;
  readonly from?: 'SUBMITTER' | 'SHOP' | 'SHIPPER';
  readonly decision?: 'REOPEN' | 'REJECT';
  readonly correctedResult?: 'DELIVERED' | 'NOT_DELIVERED';
  readonly direction?: 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
  readonly amountVnd?: number;
  readonly historyReviewed?: boolean;
}

export type ActionResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the action MAY have run. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const FEEDBACK_REFUSAL_MESSAGE: Record<string, string> = {
  REVIEW_NOT_FOUND: 'Không tìm thấy đánh giá này.',
  COMPLAINT_NOT_FOUND: 'Không tìm thấy hồ sơ phản ánh này.',
  COMPLAINT_STATE_CONFLICT: 'Trạng thái hồ sơ đã thay đổi nên thao tác này không còn phù hợp. Hãy tải lại.',
  ADMIN_ACTION_NOT_ALLOWED: 'Thao tác này không áp dụng ở trạng thái hiện tại.',
  ADMIN_INPUT_INVALID: 'Thông tin gửi lên không hợp lệ (nội dung/lý do bắt buộc).',
  ADJUSTMENT_HISTORY_REVIEW_REQUIRED: 'Có lần giao tiếp theo trong cùng chuỗi. Hãy đối chiếu toàn bộ lịch sử và tích “Đã đối chiếu lịch sử” trước khi điều chỉnh.',
};

export const TEXT_MAX = 4000;
export const NOTE_MAX = 500;

export const NOT_WIRED_FEEDBACK_REASON = 'Đánh giá và phản ánh chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export interface FeedbackSource {
  listReviews(query: ReviewQuery): Promise<ReviewListRead>;
  reviewDetail(id: string): Promise<ReviewDetailRead>;
  reviewAction(request: ReviewActionRequest): Promise<ActionResult>;
  listComplaints(query: ComplaintQuery): Promise<ComplaintListRead>;
  complaintDetail(id: string): Promise<ComplaintDetailRead>;
  handlers(): Promise<HandlersRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  complaintAction(request: ComplaintActionRequest): Promise<ActionResult>;
  /** Same-origin path of an evidence picture (the browser sends the session cookie). */
  pictureUrl(complaintId: string, attachmentId: string): string;
}

const notWired = { kind: 'not-wired', reason: NOT_WIRED_FEEDBACK_REASON } as const;
export const NOT_WIRED_FEEDBACK: FeedbackSource = {
  listReviews: () => Promise.resolve(notWired),
  reviewDetail: () => Promise.resolve(notWired),
  reviewAction: () => Promise.resolve({ kind: 'not-wired' }),
  listComplaints: () => Promise.resolve(notWired),
  complaintDetail: () => Promise.resolve(notWired),
  handlers: () => Promise.resolve(notWired),
  complaintAction: () => Promise.resolve({ kind: 'not-wired' }),
  pictureUrl: () => '',
};
