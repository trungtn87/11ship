// Model of "Trao đổi đơn hàng" in the Administration drawers (issue #191): the text chat of ONE order (ORDER room) or ONE direct delivery (DIRECT room) plus the
// "Lưu lịch sử trao đổi" area (retention days, complaint hold, manual evidence hold). PLAIN DATA plus the port the panel talks to: dom/order-chat-panel.ts draws it,
// core/order-chat-api.ts is the real source. The page shows only what the server said: it never decides who may send, whether the room is open or whether
// the history expired, and it never reports a send or a hold before the server acknowledged it.

import { Failure } from './accounts.js';

export const CHAT_BODY_MAX = 500;
export const CHAT_REASON_MIN = 3;
export const CHAT_REASON_MAX = 300;

export type ChatRoomKind = 'ORDER' | 'DIRECT';

/** The room to talk in: an ORDER room is the order's id; a DIRECT room is the direct delivery's id. An ORDER delivery uses the room of its order. */
export interface ChatRoomRef {
  readonly kind: ChatRoomKind;
  readonly id: string;
}

export type ChatSenderRole = 'CUSTOMER' | 'SHOP' | 'SHIPPER' | 'ADMIN' | 'SYSTEM';

export type ChatItem =
  | { readonly type: 'message'; readonly id: string; readonly at: string; readonly role: ChatSenderRole; readonly name: string; readonly mine: boolean; readonly body: string }
  | { readonly type: 'system'; readonly id: string; readonly at: string; readonly text: string };

export interface ChatRoomState {
  readonly open: boolean;
  /** The server's decision for THIS account now (view right, room open, not expired). */
  readonly canSend: boolean;
  readonly retentionDays: number;
  readonly expiresAt: string | null;
  readonly expired: boolean;
}

export interface ChatPage {
  readonly room: ChatRoomState;
  /** Oldest first, as drawn. */
  readonly items: readonly ChatItem[];
  readonly hasMore: boolean;
  /** Cursor of the next OLDER page, or null. */
  readonly nextBefore: string | null;
}

export interface HoldOverview {
  readonly open: boolean;
  readonly closedAt: string | null;
  readonly retentionDays: number;
  readonly expiresAt: string | null;
  readonly expired: boolean;
  readonly complaintHold: boolean;
  readonly manualHold: { readonly reason: string; readonly placedAt: string } | null;
  readonly canPlaceHold: boolean;
  readonly canReleaseHold: boolean;
}

export type ChatReadResult =
  | { readonly kind: 'ready'; readonly page: ChatPage }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export type HoldReadResult =
  | { readonly kind: 'ready'; readonly overview: HoldOverview }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

export interface ChatSendRequest {
  readonly room: ChatRoomRef;
  readonly body: string;
  /** Idempotency-Key of THIS message. A retry after an unknown outcome sends the same one. */
  readonly key: string;
}

export type ChatSendResult =
  | { readonly kind: 'ok'; readonly item: ChatItem; readonly room: ChatRoomState; readonly replayed: boolean }
  | { readonly kind: 'closed' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  /** The answer was lost: the message MAY be stored. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export type HoldAction = 'place' | 'release';

export interface HoldRequest {
  readonly room: ChatRoomRef;
  readonly action: HoldAction;
  readonly reason: string;
  readonly key: string;
}

export type HoldResult =
  | { readonly kind: 'ok' }
  /** The state changed under the Admin (already held / not held / no longer allowed): reload, nothing was changed by this request. */
  | { readonly kind: 'conflict' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export const CHAT_ROLE_LABEL: Record<ChatSenderRole, string> = {
  CUSTOMER: 'Khách',
  SHOP: 'Quán',
  SHIPPER: 'Shipper',
  ADMIN: 'Admin',
  SYSTEM: 'Hệ thống 11Ship',
};

export interface OrderChatSource {
  read(room: ChatRoomRef, before: string | null): Promise<ChatReadResult>;
  holdOverview(room: ChatRoomRef): Promise<HoldReadResult>;
  /** Sends exactly one request per call and never repeats it by itself. */
  send(request: ChatSendRequest): Promise<ChatSendResult>;
  hold(request: HoldRequest): Promise<HoldResult>;
}

export const NOT_WIRED_CHAT_REASON = 'Trao đổi đơn hàng chưa được nối với máy chủ. Không có dữ liệu nào được hiển thị.';

export const NOT_WIRED_CHAT: OrderChatSource = {
  read: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_CHAT_REASON }),
  holdOverview: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_CHAT_REASON }),
  send: () => Promise.resolve({ kind: 'not-wired' }),
  hold: () => Promise.resolve({ kind: 'not-wired' }),
};
