// HTTP client of "Vận hành › Thông báo" (M08.06): GET /v1/admin/notifications (search), /work-queue, /config, /:id and POST /config. Cookie-only (HttpOnly
// session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the documented shape is
// "unknown", never half-shown data. Nothing is stored here, and there is no call that sends, resends or broadcasts a notification.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  ChannelRecord,
  ConfigRead,
  ConfigSave,
  ConfigSaveResult,
  NOTIFICATION_KINDS,
  NOTIFICATION_PAGE_SIZE,
  NotificationConfig,
  NotificationDetail,
  NotificationDetailRead,
  NotificationKindName,
  NotificationListRead,
  NotificationQuery,
  NotificationRow,
  NotificationSource,
  SEND_STATUSES,
  SendStatus,
  WorkQueue,
  WorkQueueRead,
} from './notifications.js';

/** The transport's base: this client's paths start with /admin. */
export const NOTIFICATIONS_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : typeof value === 'string' ? value : undefined);
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const kindOf = (value: unknown): NotificationKindName | undefined => (typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value) ? (value as NotificationKindName) : undefined);
const appOf = (value: unknown): 'FOOD' | 'SHIP' | undefined => (value === 'FOOD' || value === 'SHIP' ? value : undefined);
const statusOf = (value: unknown): SendStatus | undefined => (typeof value === 'string' && (SEND_STATUSES as readonly string[]).includes(value) ? (value as SendStatus) : undefined);

export function parseRow(value: unknown): NotificationRow | undefined {
  const raw = record(value);
  const id = str(raw?.notification_id);
  const createdAt = iso(raw?.created_at);
  const kind = kindOf(raw?.kind);
  const app = appOf(raw?.app);
  const recipient = str(raw?.recipient_user_id);
  const code = nullableStr(raw?.delivery_code);
  const pushStatus = raw?.push_status === null ? null : statusOf(raw?.push_status);
  if (raw === undefined || id === undefined || !UUID_RE.test(id) || createdAt === undefined || kind === undefined || app === undefined || recipient === undefined || code === undefined || pushStatus === undefined) {
    return undefined;
  }
  const title = str(raw.title);
  const body = typeof raw.body === 'string' ? raw.body : undefined;
  if (title === undefined || body === undefined || !whole(raw.attempts) || typeof raw.expired !== 'boolean') {
    return undefined;
  }
  return { id, createdAt, kind, title, body, app, recipientUserId: recipient, deliveryCode: code, pushStatus, attempts: raw.attempts, expired: raw.expired };
}

export function parsePage(data: Record<string, unknown>): { rows: readonly NotificationRow[]; total: number } | undefined {
  if (!Array.isArray(data.items) || !whole(data.total)) {
    return undefined;
  }
  const rows: NotificationRow[] = [];
  for (const entry of data.items) {
    const row = parseRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total };
}

function parseChannel(value: unknown): ChannelRecord | undefined {
  const raw = record(value);
  if (raw === undefined || (raw.channel !== 'APP' && raw.channel !== 'PUSH') || typeof raw.status !== 'string') {
    return undefined;
  }
  const at = nullableIso(raw.at ?? null);
  const attempts = raw.channel === 'PUSH' ? raw.attempt_count : 0;
  if (at === undefined || !whole(attempts)) {
    return undefined;
  }
  const pick = <T>(key: string, parse: (v: unknown) => T | null | undefined): T | null | undefined => (raw[key] === undefined ? null : parse(raw[key]));
  const skip = pick('skip_reason', nullableStr);
  const reason = pick('reason_text', nullableStr);
  const lastAttempt = pick('last_attempt_at', nullableIso);
  const sent = pick('sent_at', nullableIso);
  const errorCode = pick('last_error_code', nullableStr);
  const evidence = pick('last_error_evidence', nullableStr);
  const next = pick('next_attempt_at', nullableIso);
  const expires = pick('expires_at', nullableIso);
  const created = pick('created_at', nullableIso);
  if ([skip, reason, lastAttempt, sent, errorCode, evidence, next, expires, created].includes(undefined)) {
    return undefined;
  }
  return {
    channel: raw.channel,
    status: raw.status,
    at: raw.channel === 'APP' ? at : (created as string | null),
    skipReason: skip as string | null,
    reasonText: reason as string | null,
    attempts,
    lastAttemptAt: lastAttempt as string | null,
    sentAt: sent as string | null,
    errorCode: errorCode as string | null,
    evidence: evidence as string | null,
    nextAttemptAt: next as string | null,
    expiresAt: expires as string | null,
  };
}

export function parseDetail(data: Record<string, unknown>): NotificationDetail | undefined {
  const id = str(data.notification_id);
  const kind = kindOf(data.kind);
  const app = appOf(data.app);
  const target = record(data.target);
  const createdAt = iso(data.created_at);
  const readAt = nullableIso(data.read_at);
  const validUntil = nullableIso(data.valid_until);
  const archivedAt = nullableIso(data.archived_at);
  const deleteAfter = nullableIso(data.delete_after);
  const title = str(data.title);
  const recipient = str(data.recipient_user_id);
  const note = str(data.note);
  if (
    id === undefined || kind === undefined || app === undefined || target === undefined || createdAt === undefined || readAt === undefined || validUntil === undefined || archivedAt === undefined ||
    deleteAfter === undefined || title === undefined || recipient === undefined || note === undefined || typeof target.type !== 'string' || !Array.isArray(data.channels)
  ) {
    return undefined;
  }
  const targetId = nullableStr(target.id);
  const targetCode = nullableStr(target.code);
  if (targetId === undefined || targetCode === undefined) {
    return undefined;
  }
  const channels: ChannelRecord[] = [];
  for (const entry of data.channels) {
    const parsed = parseChannel(entry);
    if (parsed === undefined) {
      return undefined;
    }
    channels.push(parsed);
  }
  return { id, kind, title, app, recipientUserId: recipient, createdAt, readAt, validUntil, archivedAt, deleteAfter, target: { type: target.type, id: targetId, code: targetCode }, channels, note };
}

export function parseWorkQueue(data: Record<string, unknown>): WorkQueue | undefined {
  const c = record(data.counters);
  if (
    c === undefined || !whole(c.failed_pushes) || !whole(c.late_pushes) || !whole(c.no_device) || !whole(c.dead_events) || !whole(c.late_reminders) || !whole(c.goods_cases) ||
    typeof data.push_provider_configured !== 'boolean' || !Array.isArray(data.failures) || !Array.isArray(data.goods_cases)
  ) {
    return undefined;
  }
  const failures: WorkQueue['failures'][number][] = [];
  for (const entry of data.failures) {
    const f = record(entry);
    const id = str(f?.notification_id);
    const kind = kindOf(f?.kind);
    const app = appOf(f?.app);
    const at = iso(f?.at);
    const code = nullableStr(f?.error_code);
    const evidence = nullableStr(f?.evidence);
    if (f === undefined || id === undefined || kind === undefined || app === undefined || at === undefined || typeof f.status !== 'string' || code === undefined || evidence === undefined) {
      return undefined;
    }
    failures.push({ id, kind, app, status: f.status, errorCode: code, evidence, at });
  }
  const goodsCases: WorkQueue['goodsCases'][number][] = [];
  for (const entry of data.goods_cases) {
    const g = record(entry);
    const deliveryId = str(g?.delivery_id);
    const code = str(g?.code);
    const shop = str(g?.shop_name);
    const opened = iso(g?.opened_at);
    if (deliveryId === undefined || code === undefined || shop === undefined || opened === undefined) {
      return undefined;
    }
    goodsCases.push({ deliveryId, code, shopName: shop, openedAt: opened });
  }
  return {
    counters: { failedPushes: c.failed_pushes, latePushes: c.late_pushes, noDevice: c.no_device, deadEvents: c.dead_events, lateReminders: c.late_reminders, goodsCases: c.goods_cases },
    providerConfigured: data.push_provider_configured,
    failures,
    goodsCases,
  };
}

export function parseConfig(data: Record<string, unknown>): NotificationConfig | undefined {
  const timers = record(data.timers);
  if (
    timers === undefined || !whole(data.version) || typeof data.push_enabled !== 'boolean' || typeof data.default_sound !== 'boolean' || !whole(data.visible_days) || !whole(data.purge_days) ||
    !whole(data.retry_max_attempts) || !whole(data.retry_base_seconds) || typeof data.provider_configured !== 'boolean' || !Array.isArray(timers.shop_reminder_minutes) ||
    !timers.shop_reminder_minutes.every(whole) || !whole(timers.search_stop_minutes) || !whole(timers.pickup_reminder_minutes)
  ) {
    return undefined;
  }
  return {
    version: data.version,
    pushEnabled: data.push_enabled,
    defaultSound: data.default_sound,
    visibleDays: data.visible_days,
    purgeDays: data.purge_days,
    retryMaxAttempts: data.retry_max_attempts,
    retryBaseSeconds: data.retry_base_seconds,
    providerConfigured: data.provider_configured,
    shopReminderMinutes: timers.shop_reminder_minutes as number[],
    searchStopMinutes: timers.search_stop_minutes,
    pickupReminderMinutes: timers.pickup_reminder_minutes,
  };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export class AdminNotificationApi extends ApiClient {
  workQueue(): Promise<ApiResult<WorkQueue>> {
    return this.call({ method: 'GET', path: '/admin/notifications/work-queue' }, parseWorkQueue);
  }

  list(filter: NotificationQuery): Promise<ApiResult<{ rows: readonly NotificationRow[]; total: number }>> {
    const path = `/admin/notifications${query({
      q: filter.query.trim(),
      kind: filter.kind === 'ALL' ? undefined : filter.kind,
      send_status: filter.status === 'ALL' ? undefined : filter.status,
      app: filter.app === 'ALL' ? undefined : filter.app,
      from: filter.from,
      to: filter.to,
      limit: String(NOTIFICATION_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * NOTIFICATION_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parsePage);
  }

  detail(id: string): Promise<ApiResult<NotificationDetail>> {
    return this.call({ method: 'GET', path: `/admin/notifications/${encodeURIComponent(id)}` }, parseDetail);
  }

  config(): Promise<ApiResult<NotificationConfig>> {
    return this.call({ method: 'GET', path: '/admin/notifications/config' }, parseConfig);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  saveConfig(csrf: string, request: ConfigSave): Promise<ApiResult<NotificationConfig>> {
    const body = {
      expected_version: request.version,
      push_enabled: request.pushEnabled,
      default_sound: request.defaultSound,
      visible_days: request.visibleDays,
      purge_days: request.purgeDays,
      retry_max_attempts: request.retryMaxAttempts,
      retry_base_seconds: request.retryBaseSeconds,
    };
    return this.call({ method: 'POST', path: '/admin/notifications/config', body, csrf, idempotencyKey: request.key }, parseConfig);
  }
}

async function saveResult(result: ApiResult<NotificationConfig>, session: CsrfPort): Promise<ConfigSaveResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok', config: result.data };
  }
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  switch (result.code) {
    case 'VERSION_CONFLICT':
      return { kind: 'conflict' };
    case 'ADMIN_CSRF_INVALID':
      await session.refresh();
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
      return { kind: 'forbidden' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return { kind: 'invalid' };
  }
}

/** The real NotificationSource. It keeps nothing: no rows, no versions, no keys. */
export function createNotificationSource(api: AdminNotificationApi, session?: CsrfPort): NotificationSource {
  return {
    async workQueue(): Promise<WorkQueueRead> {
      const result = await api.workQueue();
      return result.kind === 'ok' ? { kind: 'ready', queue: result.data } : failureOf(result);
    },
    async list(filter): Promise<NotificationListRead> {
      const result = await api.list(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total } : failureOf(result);
    },
    async detail(id): Promise<NotificationDetailRead> {
      const result = await api.detail(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', detail: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async config(): Promise<ConfigRead> {
      const result = await api.config();
      return result.kind === 'ok' ? { kind: 'ready', config: result.data } : failureOf(result);
    },
    async saveConfig(request): Promise<ConfigSaveResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return saveResult(await api.saveConfig(csrf, request), session);
    },
  };
}
