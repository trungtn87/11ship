// #191 "Trao đổi đơn hàng": vocabulary and fixed bounds. The values mirror database/migrations/1796515200000_create-order-chat.sql; keep the two in step.

export const CHAT_ROOM_TYPES = ['ORDER', 'DELIVERY'] as const;
export type ChatRoomType = (typeof CHAT_ROOM_TYPES)[number];

export type ChatSenderRole = 'CUSTOMER' | 'SHOP' | 'SHIPPER';

/** One message is at most this many characters (code points), after trimming. */
export const CHAT_MAX_CHARS = 500;
/** One sender may write at most this many messages in this window, whatever the room (a runaway app or a person pasting in a loop). */
export const CHAT_RATE_MESSAGES = 10;
export const CHAT_RATE_WINDOW_SECONDS = 60;

export const CHAT_PAGE_DEFAULT = 30;
export const CHAT_PAGE_MAX = 50;

export const CHAT_OPERATION_SEND = 'order.chat.send.v1';
export const CHAT_SCOPE_TYPE = 'user';
export const CHAT_RESOURCE = 'order_chat';
export const CHAT_EVENT_SCHEMA = 1;

/** The outbox event M08 turns into a push for the OTHER participants of a room. It carries ids only (never the text). */
export const OUTBOX_CHAT_MESSAGE = 'chat.message.v1';

/** SYSTEM setting (ops registry): days after the room closed during which the history can be read. A PROPOSAL, not yet fixed by the Owner. */
export const CHAT_RETENTION_SETTING = 'chat.retention_days';
