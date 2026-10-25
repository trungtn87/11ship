// The order chat ("Trao đổi đơn hàng", issue #191). The values mirror database/migrations/1796601600000_create-order-chat.sql; keep the two in step.

export const CHAT_MAX_BODY = 500;
export const CHAT_PAGE_DEFAULT = 30;
export const CHAT_PAGE_MAX = 100;
/** A sender may write at most this many messages in this window, over all rooms (counted in the database, so two phones share the limit). */
export const CHAT_RATE_MAX = 12;
export const CHAT_RATE_WINDOW_MS = 60_000;
/** Milestones read per room: the order events and the events of each call (the same bounds the order detail uses). */
export const CHAT_EVENT_LIMIT = 300;

export const CHAT_ROOM_ORDER = 'ORDER';
export const CHAT_ROOM_DIRECT = 'DIRECT';
export type ChatRoomType = typeof CHAT_ROOM_ORDER | typeof CHAT_ROOM_DIRECT;
export type ChatRole = 'CUSTOMER' | 'SHOP' | 'SHIPPER' | 'ADMIN' | 'SYSTEM';

export const OUTBOX_ORDER_CHAT_MESSAGE = 'order.chat_message.v1';
export const ORDER_CHAT_EVENT_SCHEMA = 1;
export const ORDER_CHAT_RESOURCE = 'order_chat';
export const ORDER_CHAT_SCOPE_TYPE = 'user';
