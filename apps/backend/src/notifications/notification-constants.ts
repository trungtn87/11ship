// M08 vocabulary and fixed rules. The values mirror database/migrations/1794182400000_create-m08-notifications.sql; keep the two in step.

export const NOTIFICATION_APPS = ['FOOD', 'SHIP'] as const;
export type NotificationApp = (typeof NOTIFICATION_APPS)[number];

export const NOTIFICATION_CATEGORIES = ['ORDERS', 'REMINDERS', 'WALLET_PROFILE', 'AVAILABLE'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const TARGET_TYPES = ['ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** The catalog of notification kinds. A kind fixes the category, the target and the lock-screen-safe wording; none of them carries a phone, an address, an OTP or bank data. */
export const KINDS = [
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
  'PROFILE_APPROVED',
  'PROFILE_REJECTED',
  'PROFILE_SUSPENDED',
  'PROFILE_REOPENED',
] as const;
export type NotificationKind = (typeof KINDS)[number];

export const OUTBOX_DELIVERY_CHANGED_TYPE = 'delivery.changed.v1';
export const OUTBOX_TOPUP_CHANGED_TYPE = 'wallet.topup_request.changed.v1';
export const OUTBOX_DRIVER_STATE_CHANGED_TYPE = 'driver.state_changed.v1';
/** Withdrawals (M04-C) and Orders (M10) have no producer yet: their names are reserved here and handled by explicit "not integrated" adapters. */
export const OUTBOX_ORDER_PREFIX = 'order.';
export const OUTBOX_WITHDRAWAL_PREFIX = 'wallet.withdrawal';

export const RESOURCE_NOTIFICATION = 'notification';

// ---- retention and delivery bounds ---------------------------------------------------------------------------------------------

/** Result notifications stay in the inbox 90 days, are then archived (hidden), and are deleted 365 days after they were created. */
export const DEFAULT_VISIBLE_DAYS = 90;
export const DEFAULT_PURGE_DAYS = 365;
export const DAY_MS = 86_400_000;

/** Retry of a push: bounded attempts with exponential backoff (base * 2^(n-1)), never beyond the push's own deadline. */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_BASE_SECONDS = 30;
export const RETRY_BACKOFF_CAP_MS = 15 * 60_000;

/** A push is useless once its fact is old news. TTL of sending is independent of how long the inbox keeps the row. */
export const PUSH_TTL_MS = {
  /** A new-offer card is actionable only while a search is open; the real validity ends with the delivery's own deadline. */
  offer: 30 * 60_000,
  reminder: 5 * 60_000,
  result: 6 * 3_600_000,
  account: 24 * 3_600_000,
} as const;

/** An event older than this when it is consumed (an outbox backlog after an outage, or from before M08 existed) is recorded as stale and told to nobody. */
export const MAX_EVENT_AGE_MS = 24 * 3_600_000;

/** Grouping window of due reminders: events that fall due within this many ms of each other are sent as ONE notification. */
export const REMINDER_GATHER_MS = 3_000;
/** A search reminder / pickup reminder older than this when it is finally looked at is stale (its next mark has passed): it is dropped, not sent late. */
export const PICKUP_REMINDER_STALE_MS = 5 * 60_000;
export const SEARCH_REMINDER_STALE_MS = 9 * 60_000;

export const INBOX_PAGE_DEFAULT = 30;
export const INBOX_PAGE_MAX = 100;
export const SYNC_WAIT_MAX_SECONDS = 25;

// ---- the business timers that M08 only displays --------------------------------------------------------------------------------

export const DISPLAYED_TIMERS = {
  shop_reminder_minutes: [5, 15],
  search_stop_minutes: 30,
  pickup_reminder_minutes: 5,
} as const;

export const CATEGORY_OF_KIND: Readonly<Record<NotificationKind, NotificationCategory>> = {
  DELIVERY_ACCEPTED: 'ORDERS',
  DELIVERY_RELEASED: 'ORDERS',
  DELIVERY_PICKED_UP: 'ORDERS',
  DELIVERY_COMPLETED: 'ORDERS',
  DELIVERY_FAILED: 'ORDERS',
  DELIVERY_CANCELLED: 'ORDERS',
  SEARCH_STOPPED: 'ORDERS',
  SEARCH_REMINDER: 'REMINDERS',
  FEE_COUNTERED: 'ORDERS',
  FEE_UPDATED: 'ORDERS',
  GOODS_SETTLED: 'ORDERS',
  NEW_OFFERS: 'AVAILABLE',
  PICKUP_REMINDER: 'REMINDERS',
  ASSIGNMENT_RELEASED_BY_ADMIN: 'ORDERS',
  TOPUP_CONFIRMED: 'WALLET_PROFILE',
  TOPUP_REJECTED: 'WALLET_PROFILE',
  PROFILE_APPROVED: 'WALLET_PROFILE',
  PROFILE_REJECTED: 'WALLET_PROFILE',
  PROFILE_SUSPENDED: 'WALLET_PROFILE',
  PROFILE_REOPENED: 'WALLET_PROFILE',
};

export function isNotificationApp(value: unknown): value is NotificationApp {
  return value === 'FOOD' || value === 'SHIP';
}
