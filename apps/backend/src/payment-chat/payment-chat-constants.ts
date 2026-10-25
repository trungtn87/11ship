// The payment conversation ("Trao đổi thanh toán", issue #199): ONE room per Shipper top-up request or per shop payment request. The values mirror
// database/migrations/1796688000000_create-payment-requests-chat.sql; keep the two in step. A message is support and an event: it never moves money, a balance
// or a right.

export const PAYMENT_CHAT_MAX_BODY = 500;
export const PAYMENT_CHAT_PAGE_DEFAULT = 30;
export const PAYMENT_CHAT_PAGE_MAX = 100;
/** A sender may write at most this many messages per room in this window (counted in the database, so two phones share the limit). */
export const PAYMENT_CHAT_RATE_MAX = 5;
export const PAYMENT_CHAT_RATE_WINDOW_MS = 60_000;

export const CASE_DRIVER_TOPUP = 'DRIVER_TOPUP';
export const CASE_SHOP_PAYMENT = 'SHOP_PAYMENT';
export type CaseKind = typeof CASE_DRIVER_TOPUP | typeof CASE_SHOP_PAYMENT;
export type PaymentChatRole = 'SHIPPER' | 'SHOP' | 'ADMIN' | 'SYSTEM';

export const OUTBOX_PAYMENT_CHAT_MESSAGE = 'payment.chat_message.v1';
export const PAYMENT_CHAT_EVENT_SCHEMA = 1;
export const PAYMENT_CHAT_RESOURCE = 'payment_chat';
export const OUTBOX_TOPUP_REPORTED = 'wallet.topup_request.reported.v1';
