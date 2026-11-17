import { CATEGORY_OF_KIND, NotificationKind } from './notification-constants';

/**
 * M08-R-09 (Owner 2026-11-06, P6-9): an event older than MAX_EVENT_AGE_MS is never dropped silently by its type. The decision is made per DRAFT:
 *  - TIME_BOUND: its moment has passed (an offer, a reminder, a search or pickup notice, an order that waits for the shop). Dropped, recorded STALE_EVENT.
 *  - DURABLE: money, account, the end state of an order or delivery, a complaint, a chat card. Delivered late: the inbox row keeps the time of the event.
 *    Its push obeys the push TTL (a late one is recorded as skipped STALE_EVENT, never sent late).
 *
 * The table is exhaustive on purpose: adding a notification kind without deciding its class does not compile.
 */
export type DraftClass = 'TIME_BOUND' | 'DURABLE';

export const DRAFT_CLASS: Record<NotificationKind, DraftClass> = {
  ORDER_TIMEOUT: 'DURABLE',
  ORDER_CONFIRMATION_REMINDER: 'TIME_BOUND',
  PICKUP_TIMEOUT_WARNING: 'TIME_BOUND',
  DELIVERY_ACCEPTED: 'DURABLE',
  DELIVERY_RELEASED: 'DURABLE',
  DELIVERY_PICKED_UP: 'DURABLE',
  DELIVERY_COMPLETED: 'DURABLE',
  DELIVERY_FAILED: 'DURABLE',
  DELIVERY_CANCELLED: 'DURABLE',
  SEARCH_STOPPED: 'TIME_BOUND',
  SEARCH_REMINDER: 'TIME_BOUND',
  FEE_COUNTERED: 'DURABLE',
  FEE_UPDATED: 'DURABLE',
  GOODS_SETTLED: 'DURABLE',
  NEW_OFFERS: 'TIME_BOUND',
  PICKUP_REMINDER: 'TIME_BOUND',
  ASSIGNMENT_RELEASED_BY_ADMIN: 'DURABLE',
  TOPUP_CONFIRMED: 'DURABLE',
  TOPUP_REJECTED: 'DURABLE',
  WITHDRAWAL_REQUESTED: 'DURABLE',
  WITHDRAWAL_PROCESSING: 'DURABLE',
  WITHDRAWAL_RECONCILING: 'DURABLE',
  WITHDRAWAL_PAID: 'DURABLE',
  WITHDRAWAL_CANCELLED: 'DURABLE',
  PROFILE_APPROVED: 'DURABLE',
  PROFILE_REJECTED: 'DURABLE',
  PROFILE_SUSPENDED: 'DURABLE',
  PROFILE_REOPENED: 'DURABLE',
  REVIEW_REMINDER: 'DURABLE',
  COMPLAINT_UPDATED: 'DURABLE',
  ORDER_PLACED: 'TIME_BOUND',
  ORDER_EDITED_BY_CUSTOMER: 'DURABLE',
  ORDER_CANCELLED_BY_CUSTOMER: 'DURABLE',
  ORDER_CANCELLED_BY_ADMIN: 'DURABLE',
  ORDER_SCHEDULE_REMINDER: 'TIME_BOUND',
  ORDER_CONFIRMED: 'DURABLE',
  ORDER_REJECTED: 'DURABLE',
  ORDER_CANCELLED_BY_SHOP: 'DURABLE',
  ORDER_READY: 'DURABLE',
  ORDER_COMPLETED: 'DURABLE',
  ORDER_NOT_COMPLETED: 'DURABLE',
  ORDER_SHIPPER_ACCEPTED: 'DURABLE',
  ORDER_DELIVERING: 'DURABLE',
  ORDER_DELIVERY_FAILED: 'DURABLE',
  ORDER_CHAT_MESSAGE: 'DURABLE',
  FINANCE_UPDATED: 'DURABLE',
};

/** A draft is time-bound when its class says so, or when it carries its own validity window (a collapsed offer card). */
export const isTimeBound = (kind: NotificationKind, validForMs: number | null): boolean => validForMs !== null || DRAFT_CLASS[kind] === 'TIME_BOUND';

/** Finance and account facts (S-3): a late delivery of these is a HIGH alert for Operations. */
export const isHighPriorityKind = (kind: NotificationKind): boolean => CATEGORY_OF_KIND[kind] === 'WALLET_PROFILE';

/**
 * Metric keys written by the consumer and read by the Operations collector. The three are disjoint: a late finance/account fact counts only as
 * `delivered_late_high`; any other late fact counts as `delivered_late`; a dropped time-bound draft counts as `dropped`.
 */
export const STALE_METRIC = {
  dropped: 'm08_stale_event.dropped',
  deliveredLate: 'm08_stale_event.delivered_late',
  deliveredLateHigh: 'm08_stale_event.delivered_late_high',
} as const;

export const STALE_AUDIT_ACTION = 'notification.stale_event.v1';
