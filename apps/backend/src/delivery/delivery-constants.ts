// M07 vocabulary and fixed rules. The values mirror database/migrations/1794096000000_create-m07-delivery.sql; keep the two in step.

export const DELIVERY_STATES = ['waiting_driver', 'accepted', 'location_confirmed', 'picked_up', 'delivering', 'completed', 'failed', 'cancelled_by_merchant', 'search_stopped'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Running states: a Shipper may hold the delivery. */
export const RUNNING_STATES: readonly DeliveryState[] = ['accepted', 'location_confirmed', 'picked_up', 'delivering'];
/** Active for the Order uniqueness rule (a search or a run is open). */
export const ACTIVE_STATES: readonly DeliveryState[] = ['waiting_driver', ...RUNNING_STATES];
export const TERMINAL_STATES: readonly DeliveryState[] = ['completed', 'failed', 'cancelled_by_merchant', 'search_stopped'];
/** Before the goods are picked up: either side may still cancel its part. */
export const BEFORE_PICKUP_STATES: readonly DeliveryState[] = ['waiting_driver', 'accepted', 'location_confirmed'];

export type FeeMode = 'STANDARD' | 'AGREED' | 'PICKUP_AGREEMENT';
export type FeePayer = 'CUSTOMER' | 'SHOP';
export type AssignmentStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED_BY_SHIPPER' | 'CANCELLED_BY_SHOP' | 'RELEASED_BY_ADMIN';
export type ActorType = 'SHOP' | 'SHIPPER' | 'ADMIN' | 'SYSTEM';

/** The search lasts 30 minutes from the server clock. Never extended; a cancelled assignment never restarts it. */
export const SEARCH_MINUTES = 30;
export const SEARCH_MS = SEARCH_MINUTES * 60_000;
/** The shop is reminded at these minutes of the search (once each). At the end the search stops; the Order is not cancelled. */
export const REMINDER_MINUTES: readonly number[] = [5, 15];
/** A Shipper who has accepted and not picked up is reminded every 5 minutes. */
export const PICKUP_REMINDER_MS = 5 * 60_000;

/** The latest position is LIVE for 2 minutes, STALE until 10 minutes, LOST after that. */
export const LOCATION_LIVE_SECONDS = 120;
export const LOCATION_STALE_SECONDS = 600;
/** M14's verdict on a position: coordinates in range and an accuracy no worse than this (metres) when one is given. */
export const LOCATION_MAX_ACCURACY_M = 500;
/** M06 asks "fresh": the position must be at most as old as LIVE. */
export const LOCATION_FRESH_MS = LOCATION_LIVE_SECONDS * 1000;

// The commission per successful delivery is a versioned policy of M04 (app.wallet_commission_policies; version 1 = 1.000 VND, ADR-004). It is SNAPSHOTTED on the
// assignment (amount and label COMMISSION_V<version>) when the delivery is accepted; capture and release use the snapshot, never the current policy.

/** Fixed pre-pickup display: the first segment of an address (the street line) is never shown to a Shipper before accepting. */
export const AREA_TEXT_MAX = 160;

export const FAIL_REASON_CODES = ['RECIPIENT_UNREACHABLE', 'RECIPIENT_REFUSED', 'ADDRESS_NOT_FOUND', 'GOODS_PROBLEM', 'VEHICLE_PROBLEM', 'OTHER'] as const;
export type FailReasonCode = (typeof FAIL_REASON_CODES)[number];
export const GOODS_CONDITIONS = ['WITH_SHIPPER', 'RETURNED_TO_SHOP', 'HANDED_TO_RECIPIENT', 'LOST_OR_DAMAGED'] as const;
export type GoodsCondition = (typeof GOODS_CONDITIONS)[number];

export type Custody = 'SHIPPER' | 'SHOP' | 'HANDLED';

/** Operation names (Idempotency-Key scopes) and audit actions. */
export const OPERATIONS = {
  create: 'delivery.create.v1',
  cancel: 'delivery.cancel.v1',
  recall: 'delivery.recall.v1',
  reprice: 'delivery.reprice.v1',
  counterAccept: 'delivery.fee.counter_accept.v1',
  counterReject: 'delivery.fee.counter_reject.v1',
  customerConfirm: 'delivery.fee.customer_confirm.v1',
  custody: 'delivery.custody.resolve.v1',
  accept: 'delivery.accept.v1',
  release: 'delivery.release.v1',
  feeAgree: 'delivery.fee.agree.v1',
  feeSkip: 'delivery.fee.skip.v1',
  feeCounter: 'delivery.fee.counter.v1',
  destination: 'delivery.destination.confirm.v1',
  pickup: 'delivery.pickup.v1',
  complete: 'delivery.complete.v1',
  fail: 'delivery.fail.v1',
  adminAction: 'admin.delivery.action.v1',
  sweep: 'delivery.sweep.v1',
} as const;

export const DELIVERY_SCOPE_TYPE = 'user';
export const DELIVERY_RESOURCE = 'delivery';
export const DELIVERY_EVENT_SCHEMA = 1;
