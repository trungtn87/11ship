// Payment requests of a SHOP (#198). The values mirror database/migrations/1796688000000_create-payment-requests-chat.sql; keep the two in step.
// There is no subscription here: no period, no renewal, no expiry and no shop wallet. A request asks for money that was moved outside the app; an administrator
// records the money RECEIVED once; a manual entitlement is a separate, logged act.

export const SHOP_PAYMENT_PURPOSES = ['ACCOUNT_OPENING', 'MENU_EXPANSION', 'OTHER'] as const;
export type ShopPaymentPurpose = (typeof SHOP_PAYMENT_PURPOSES)[number];

export const SHOP_PAYMENT_STATES = ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED'] as const;
export type ShopPaymentState = (typeof SHOP_PAYMENT_STATES)[number];

export const SHOP_PAYMENT_REJECT_REASONS = ['NOT_RECEIVED', 'AMOUNT_MISMATCH', 'DUPLICATE_REQUEST', 'INVALID_REQUEST', 'OTHER'] as const;
export type ShopPaymentRejectReason = (typeof SHOP_PAYMENT_REJECT_REASONS)[number];

/**
 * The largest amount a request may ask for. No price is decided here: the Owner has not fixed any fee, so the shop writes the amount it was told and the
 * administrator compares it with the statement. The bound only keeps a typing error out of the table.
 */
export const SHOP_PAYMENT_MAX_AMOUNT_VND = 999_999_999;

export const SHOP_PAYMENT_LIST_DEFAULT = 20;
export const SHOP_PAYMENT_LIST_MAX = 50;

/** The one right a shop can be given by hand today. */
export const ENTITLEMENT_MENU_EXPANDED = 'MENU_EXPANDED';
export type ShopEntitlement = typeof ENTITLEMENT_MENU_EXPANDED;

/** Dishes a shop may show (status VISIBLE) at the same time without the MENU_EXPANDED right. HIDDEN dishes do not count and nothing is ever removed to fit. */
export const FREE_VISIBLE_DISH_LIMIT = 20;

export const SHOP_PAYMENT_SCOPE_TYPE = 'user';
export const SHOP_PAYMENT_RESOURCE = 'shop_payment_request';
export const OUTBOX_SHOP_PAYMENT_CHANGED = 'shop.payment_request.changed.v1';
export const ENTITLEMENT_RESOURCE = 'shop_entitlement';
export const OUTBOX_SHOP_ENTITLEMENT_CHANGED = 'shop.entitlement.changed.v1';
