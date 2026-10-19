// M11 vocabulary and fixed rules. The values mirror database/migrations/1794268800000_create-m11-reviews-complaints.sql; keep the two in step.

export const REVIEW_KINDS = ['SHOP_BY_CUSTOMER', 'SHIPPER_BY_CUSTOMER', 'SHIPPER_BY_SHOP'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export type Visibility = 'VISIBLE' | 'HIDDEN';

/** Why an Administrator hides (or restores) a rating. OTHER needs a written note. */
export const MODERATION_REASONS = ['WRONG_ORDER', 'ABUSIVE', 'PERSONAL_DATA', 'SPAM', 'VERIFIED_FALSE', 'MISTAKE_RESOLVED', 'OTHER'] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

export const COMPLAINT_CATEGORIES = ['DELIVERY_RESULT', 'GOODS', 'MONEY_FEE', 'SERVICE', 'SHIPPER_REVIEW', 'OTHER'] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_STATUSES = ['PENDING', 'IN_PROGRESS', 'AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];
export const OPEN_STATUSES: readonly ComplaintStatus[] = ['PENDING', 'IN_PROGRESS', 'AWAITING_INFO'];
export const CLOSED_STATUSES: readonly ComplaintStatus[] = ['RESOLVED', 'CLOSED_NO_ACTION'];

/** Who opened a complaint, in the vocabulary of the people (SHOP is the shop owner; the storage role is not exposed). */
export type PartyRole = 'CUSTOMER' | 'SHOP' | 'SHIPPER';
export type AudienceRole = 'SHOP' | 'SHIPPER';

export type MessageKind =
  | 'SUBMITTED'
  | 'APPENDED'
  | 'SUPPLEMENT'
  | 'PARTY_RESPONSE'
  | 'RECEIVED'
  | 'REQUEST_INFO'
  | 'CONCLUSION'
  | 'CLOSED'
  | 'REOPEN_REQUEST'
  | 'REOPEN_DECISION'
  | 'ASSIGNED'
  | 'NOTE'
  | 'ADJUSTMENT';
export type MessageVisibility = 'SUBMITTER' | 'PARTIES' | 'PARTY_ONLY' | 'INTERNAL';

/** After a file is closed its submitter may ask for a new look for this long (the SERVER clock decides). */
export const RECONSIDERATION_DAYS = 7;
export const RECONSIDERATION_WINDOW_MS = RECONSIDERATION_DAYS * 86_400_000;

export const ATTACHMENT_MAX_COUNT = 5;
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** How many uploaded pictures of one account may wait unattached (a bound on abandoned uploads, not a business limit). */
export const UNLINKED_ATTACHMENT_LIMIT = 20;

/** Technical bounds of free text (the approved design sets no length on a rating comment; these only protect storage). */
export const COMMENT_MAX_CODEPOINTS = 2000;
export const COMPLAINT_TEXT_MAX_CODEPOINTS = 4000;
export const NOTE_MAX_CODEPOINTS = 500;

export const REVIEW_PAGE_DEFAULT = 20;
export const REVIEW_PAGE_MAX = 50;
export const COMPLAINT_PAGE_MAX = 50;

export const OPERATIONS = {
  reviewShop: 'review.shop.create.v1',
  reviewShipperByCustomer: 'review.shipper.customer.create.v1',
  reviewShipperByShop: 'review.shipper.shop.create.v1',
  reply: 'review.reply.save.v1',
  complaintCreate: 'complaint.create.v1',
  complaintSupplement: 'complaint.supplement.v1',
  complaintReconsider: 'complaint.reconsider.v1',
  adminAction: 'admin.feedback.action.v1',
} as const;

export const FEEDBACK_SCOPE_TYPE = 'user';
export const REVIEW_RESOURCE = 'review';
export const COMPLAINT_RESOURCE = 'complaint';
export const FEEDBACK_EVENT_SCHEMA = 1;
export const OUTBOX_COMPLAINT_CHANGED = 'complaint.changed.v1';
export const OUTBOX_REVIEW_CHANGED = 'review.changed.v1';
