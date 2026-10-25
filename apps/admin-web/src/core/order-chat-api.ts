// HTTP client of the Administration's "Trao đổi đơn hàng" (issue #191): GET|POST /v1/admin/orders/:id/chat, GET /v1/admin/orders/:id/chat-hold,
// POST .../chat-hold/place|release, and the same under /v1/admin/deliveries/:id for a DIRECT delivery. Cookie-only (HttpOnly session, same origin); the CSRF
// token is passed in from memory. Every answer is parsed strictly: a body without the documented shape is "unknown", never half-shown data. Nothing is stored.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  CHAT_ROLE_LABEL,
  ChatItem,
  ChatPage,
  ChatReadResult,
  ChatRoomRef,
  ChatRoomState,
  ChatSendRequest,
  ChatSendResult,
  ChatSenderRole,
  HoldOverview,
  HoldReadResult,
  HoldRequest,
  HoldResult,
  OrderChatSource,
} from './order-chat.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: readonly string[] = Object.keys(CHAT_ROLE_LABEL);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));

export function parseItem(value: unknown): ChatItem | undefined {
  const raw = record(value);
  const id = str(raw?.id);
  const at = iso(raw?.at);
  if (raw === undefined || id === undefined || at === undefined) {
    return undefined;
  }
  if (raw.type === 'system') {
    const text = str(raw.text);
    return text === undefined ? undefined : { type: 'system', id, at, text };
  }
  const sender = record(raw.sender);
  const body = str(raw.body);
  const name = str(sender?.name);
  if (raw.type !== 'message' || sender === undefined || body === undefined || name === undefined || typeof sender.mine !== 'boolean' || typeof sender.role !== 'string' || !ROLES.includes(sender.role)) {
    return undefined;
  }
  return { type: 'message', id, at, role: sender.role as ChatSenderRole, name, mine: sender.mine, body };
}

export function parseRoom(value: unknown): ChatRoomState | undefined {
  const raw = record(value);
  const expiresAt = nullableIso(raw?.expires_at);
  if (raw === undefined || typeof raw.open !== 'boolean' || typeof raw.can_send !== 'boolean' || typeof raw.expired !== 'boolean' || !whole(raw.retention_days) || expiresAt === undefined) {
    return undefined;
  }
  return { open: raw.open, canSend: raw.can_send, retentionDays: raw.retention_days, expiresAt, expired: raw.expired };
}

export function parsePage(data: Record<string, unknown>): ChatPage | undefined {
  const room = parseRoom(data.room);
  if (room === undefined || !Array.isArray(data.items) || typeof data.has_more !== 'boolean' || (data.next_before !== null && str(data.next_before) === undefined)) {
    return undefined;
  }
  const items: ChatItem[] = [];
  for (const entry of data.items) {
    const item = parseItem(entry);
    if (item === undefined) {
      return undefined;
    }
    items.push(item);
  }
  return { room, items, hasMore: data.has_more, nextBefore: data.next_before === null ? null : (data.next_before as string) };
}

interface SendData {
  readonly item: ChatItem;
  readonly room: ChatRoomState;
  readonly replayed: boolean;
}

function parseSend(data: Record<string, unknown>): SendData | undefined {
  const item = parseItem(data.message);
  // The send answer carries the compact room view (type, id, open, can_send); retention is re-read with the next page.
  const room = record(data.room);
  if (item === undefined || item.type !== 'message' || room === undefined || typeof room.open !== 'boolean' || typeof room.can_send !== 'boolean' || typeof data.replayed !== 'boolean') {
    return undefined;
  }
  return { item, room: { open: room.open, canSend: room.can_send, retentionDays: 0, expiresAt: null, expired: false }, replayed: data.replayed };
}

export function parseOverview(data: Record<string, unknown>): HoldOverview | undefined {
  const closedAt = nullableIso(data.closed_at);
  const expiresAt = nullableIso(data.expires_at);
  let manual: HoldOverview['manualHold'] = null;
  if (data.manual_hold !== null) {
    const hold = record(data.manual_hold);
    const reason = str(hold?.reason);
    const placedAt = iso(hold?.placed_at);
    if (reason === undefined || placedAt === undefined) {
      return undefined;
    }
    manual = { reason, placedAt };
  }
  if (
    closedAt === undefined || expiresAt === undefined || typeof data.open !== 'boolean' || !whole(data.retention_days) || typeof data.expired !== 'boolean' || typeof data.complaint_hold !== 'boolean' ||
    typeof data.can_place_hold !== 'boolean' || typeof data.can_release_hold !== 'boolean'
  ) {
    return undefined;
  }
  return { open: data.open, closedAt, retentionDays: data.retention_days, expiresAt, expired: data.expired, complaintHold: data.complaint_hold, manualHold: manual, canPlaceHold: data.can_place_hold, canReleaseHold: data.can_release_hold };
}

/** A room id that is not a UUID never reaches the network: the path is built from it. */
const validRoom = (room: ChatRoomRef): boolean => UUID_RE.test(room.id);

function base(room: ChatRoomRef): string {
  return room.kind === 'ORDER' ? `/admin/orders/${room.id}` : `/admin/deliveries/${room.id}`;
}

export class AdminOrderChatApi extends ApiClient {
  read(room: ChatRoomRef, before: string | null): Promise<ApiResult<ChatPage>> {
    const query = before === null ? '' : `?before=${encodeURIComponent(before)}`;
    return this.call({ method: 'GET', path: `${base(room)}/chat${query}` }, parsePage);
  }

  overview(room: ChatRoomRef): Promise<ApiResult<HoldOverview>> {
    return this.call({ method: 'GET', path: `${base(room)}/chat-hold` }, parseOverview);
  }

  send(csrf: string, request: ChatSendRequest): Promise<ApiResult<SendData>> {
    return this.call({ method: 'POST', path: `${base(request.room)}/chat`, body: { body: request.body }, csrf, idempotencyKey: request.key }, parseSend, [200, 201]);
  }

  hold(csrf: string, request: HoldRequest): Promise<ApiResult<Record<string, unknown>>> {
    return this.call({ method: 'POST', path: `${base(request.room)}/chat-hold/${request.action}`, body: { reason: request.reason }, csrf, idempotencyKey: request.key }, (data) => data);
  }
}

type Rejected = Exclude<ApiResult<unknown>, { kind: 'ok' }>;

/** The mapping the three write results share; undefined = nothing special, the caller decides. */
async function common(result: Rejected, session: CsrfPort): Promise<{ kind: 'unknown' } | { kind: 'session-expired' } | { kind: 'forbidden' } | { kind: 'not-found' } | { kind: 'rate-limited'; retryAfterSec?: number } | undefined> {
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  switch (result.code) {
    case 'ADMIN_CSRF_INVALID':
      await session.refresh();
      return { kind: 'unknown' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
    case 'ORDER_CHAT_NOT_PARTICIPANT':
      return { kind: 'forbidden' };
    case 'ORDER_NOT_FOUND':
    case 'DELIVERY_NOT_FOUND':
      return { kind: 'not-found' };
    case 'ADMIN_AUTH_RATE_LIMITED':
    case 'ORDER_CHAT_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return undefined;
  }
}

/** The real OrderChatSource. It keeps nothing: no messages, no cursors, no keys. */
export function createOrderChatSource(api: AdminOrderChatApi, session?: CsrfPort): OrderChatSource {
  return {
    async read(room, before): Promise<ChatReadResult> {
      if (!validRoom(room)) {
        return { kind: 'not-found' };
      }
      const result = await api.read(room, before);
      if (result.kind === 'ok') {
        return { kind: 'ready', page: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async holdOverview(room): Promise<HoldReadResult> {
      if (!validRoom(room)) {
        return { kind: 'not-found' };
      }
      const result = await api.overview(room);
      if (result.kind === 'ok') {
        return { kind: 'ready', overview: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async send(request): Promise<ChatSendResult> {
      if (!validRoom(request.room)) {
        return { kind: 'not-found' };
      }
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.send(csrf, request);
      if (result.kind === 'ok') {
        return { kind: 'ok', item: result.data.item, room: result.data.room, replayed: result.data.replayed };
      }
      const shared = await common(result, session);
      if (shared !== undefined) {
        return shared;
      }
      if (result.kind === 'error') {
        if (result.code === 'ORDER_CHAT_CLOSED') {
          return { kind: 'closed' };
        }
        if (result.code === 'ORDER_CHAT_EXPIRED') {
          return { kind: 'expired' };
        }
        return { kind: 'refused', code: result.code };
      }
      return { kind: 'unknown' };
    },
    async hold(request): Promise<HoldResult> {
      if (!validRoom(request.room)) {
        return { kind: 'not-found' };
      }
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      const result = await api.hold(csrf, request);
      if (result.kind === 'ok') {
        return { kind: 'ok' };
      }
      const shared = await common(result, session);
      if (shared !== undefined) {
        return shared;
      }
      if (result.kind === 'error') {
        if (result.code === 'ORDER_STATE_CONFLICT') {
          return { kind: 'conflict' };
        }
        if (result.code === 'ORDER_CHAT_EXPIRED') {
          return { kind: 'expired' };
        }
        return { kind: 'refused', code: result.code };
      }
      return { kind: 'unknown' };
    },
  };
}
