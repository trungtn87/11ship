import { CATEGORY_OF_KIND, NotificationKind } from './notification-constants';

/**
 * M08-R-09 (Owner 2026-11-06, P6-9): an event older than MAX_EVENT_AGE_MS is NEVER dropped silently by its type. The decision is made per DRAFT:
 *  - a time-bound notice (an offer, a reminder, a timeout warning: its moment has passed) is dropped and recorded as STALE_EVENT;
 *  - everything else (money, account, the end state of an order or delivery, a complaint, a chat card) still reaches the inbox with the time of the event.
 *    Its push obeys the push TTL as before (a 25 h old one is only in the inbox: no late push).
 */
export const TIME_BOUND_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'NEW_OFFERS',
  'SEARCH_REMINDER',
  'SEARCH_STOPPED',
  'PICKUP_REMINDER',
  'PICKUP_TIMEOUT_WARNING',
  'ORDER_CONFIRMATION_REMINDER',
  'ORDER_SCHEDULE_REMINDER',
]);

export const isTimeBound = (kind: NotificationKind, validForMs: number | null): boolean => validForMs !== null || TIME_BOUND_KINDS.has(kind);

/** Finance and account facts (S-3): a late delivery of these is a HIGH alert for Operations. */
export const isHighPriorityKind = (kind: NotificationKind): boolean => CATEGORY_OF_KIND[kind] === 'WALLET_PROFILE';

export type StaleOutcome = 'STALE_EVENT' | 'DELIVERED_LATE';

/** The metric keys written by the consumer and read by the Operations collector. `delivered_late_high` is the subset of `delivered_late` that is money/account. */
export const STALE_METRIC = {
  dropped: 'm08_stale_event.dropped',
  deliveredLate: 'm08_stale_event.delivered_late',
  deliveredLateHigh: 'm08_stale_event.delivered_late_high',
} as const;

export const STALE_AUDIT_ACTION = 'notification.stale_event.v1';
