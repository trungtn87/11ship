// M10 vocabulary and fixed rules. The values mirror database/migrations/1794268800000_create-m10-orders.sql; keep the two in step.

export const ORDER_STATUSES = ['PENDING_CONFIRMATION', 'PREPARING', 'COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The Order has ended: nothing about it changes any more (a completed, cancelled, refused or "not completed" Order). */
export const ENDED_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_SHOP','CANCELLED_BY_SYSTEM', 'REJECTED_BY_SHOP', 'NOT_COMPLETED'];
/** Statuses in which a delivery may exist or be called: the shop has confirmed and the Order has not ended. */
export const RUNNING_STATUS: OrderStatus = 'PREPARING';

export type OrderActor = 'CUSTOMER' | 'SHOP' | 'ADMIN' | 'SYSTEM';

/** Cart and Order limits (also CHECKs in the database). */
export const MAX_CART_LINES = 40;
export const MAX_LINE_QUANTITY = 99;
export const MAX_ITEM_NOTE = 200;
export const MAX_ORDER_NOTE = 200;
export const MAX_REASON = 300;

/**
 * A scheduled Order wants the dish at a desired time: at least this long after sending, at most this far ahead. The wanted time must fall inside the
 * shop's business hours (a shift past midnight or a 24-hour shop included).
 */
export const SCHEDULE_MIN_LEAD_MS = 30 * 60_000;
export const SCHEDULE_MAX_AHEAD_MS = 7 * 24 * 3_600_000;
/** The shop is reminded this long before the wanted time (a parameter of the reminder, not of the Order). */
export const SCHEDULE_REMINDER_LEAD_MS = 30 * 60_000;
/** A reminder that finds the wanted time further past than this is dropped (the shop is not nagged about a time long gone). */
export const SCHEDULE_REMINDER_GRACE_MS = 15 * 60_000;

/** Operation names (Idempotency-Key scopes) and audit actions. */
export const ORDER_OPERATIONS = {
  cartReplace: 'order.cart.replace.v1',
  place: 'order.place.v1',
  readyCompat: 'order.ready_compat.v1',
  customerCancel: 'order.cancel_by_customer.v1',
  customerCancelAfterPickup: 'order.cancel_by_customer_after_pickup.v1',
  edit: 'order.edit.v1',
  confirm: 'order.confirm.v1',
  reject: 'order.reject.v1',
  payment: 'order.payment.v1',
  callShipper: 'order.call_shipper.v1',
  shopCancel: 'order.cancel_by_shop.v1',
  closeNotCompleted: 'order.close_not_completed.v1',
  adminAction: 'admin.order.action.v1',
  scheduleReminder: 'order.schedule_reminder.v1',
  completed: 'order.completed.v1',
} as const;

export const ORDER_SCOPE_TYPE = 'user';
export const ORDER_RESOURCE = 'order';
export const OUTBOX_ORDER_CHANGED = 'order.changed.v1';
export const ORDER_EVENT_SCHEMA = 1;

/** Reasons the customer-facing check may report for one cart line or for the cart. */
export const ISSUE_CODES = ['ITEM_UNAVAILABLE', 'ITEM_PRICE_CHANGED', 'ITEM_NOT_OF_SHOP'] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];
