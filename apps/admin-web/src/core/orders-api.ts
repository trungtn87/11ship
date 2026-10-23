// HTTP client of Order management (M10.05): GET /v1/admin/orders (list), GET /v1/admin/orders/:id (detail) and one POST per Admin action. Cookie-only
// (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body that does not have the documented
// shape is "unknown", never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  NOT_WIRED_ORDERS,
  ORDER_ACTIONS,
  ORDER_PAGE_SIZE,
  ORDER_STATUSES,
  OrderActionName,
  OrderActionRequest,
  OrderActionResult,
  OrderCall,
  OrderDetail,
  OrderDetailRead,
  OrderEventRecord,
  OrderLineRecord,
  OrderListRead,
  OrderQuery,
  OrderRow,
  OrderSource,
  OrderStatusName,
} from './orders.js';

export { NOT_WIRED_ORDERS };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly string[] = ORDER_STATUSES;
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableWhole = (value: unknown): number | null | undefined => (value === null ? null : whole(value) ? value : undefined);

export function parseRow(value: unknown): OrderRow | undefined {
  const raw = record(value);
  const id = str(raw?.order_id);
  const code = str(raw?.code);
  const display = str(raw?.display_status);
  const shopName = str(raw?.shop_name);
  const recipientName = str(raw?.recipient_name);
  const createdAt = iso(raw?.created_at);
  const scheduled = nullableIso(raw?.scheduled_for);
  if (
    raw === undefined || id === undefined || !UUID_RE.test(id) || code === undefined || display === undefined || shopName === undefined || recipientName === undefined || createdAt === undefined || scheduled === undefined ||
    typeof raw.status !== 'string' || !STATUSES.includes(raw.status) || !whole(raw.line_count) || !whole(raw.items_total_vnd) || typeof raw.edited !== 'boolean' || typeof raw.needs_attention !== 'boolean'
  ) {
    return undefined;
  }
  return { id, code, status: raw.status as OrderStatusName, display, shopName, recipientName, lineCount: raw.line_count, itemsVnd: raw.items_total_vnd, scheduledFor: scheduled, edited: raw.edited, needsAttention: raw.needs_attention, createdAt };
}

export interface OrderPage {
  readonly rows: readonly OrderRow[];
  readonly total: number;
}

export function parsePage(data: Record<string, unknown>): OrderPage | undefined {
  if (!Array.isArray(data.items) || !whole(data.total)) {
    return undefined;
  }
  const rows: OrderRow[] = [];
  for (const entry of data.items) {
    const row = parseRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total };
}

function parseLine(value: unknown): OrderLineRecord | undefined {
  const raw = record(value);
  const name = str(raw?.name);
  const note = nullableStr(raw?.note);
  if (raw === undefined || name === undefined || note === undefined || !whole(raw.quantity) || !whole(raw.unit_price_vnd) || typeof raw.removed !== 'boolean') {
    return undefined;
  }
  let original: OrderLineRecord['original'] = null;
  if (raw.original !== null) {
    const o = record(raw.original);
    if (o === undefined || !whole(o.quantity) || !whole(o.unit_price_vnd)) {
      return undefined;
    }
    original = { quantity: o.quantity, unitPriceVnd: o.unit_price_vnd };
  }
  return { name, note, quantity: raw.quantity, unitPriceVnd: raw.unit_price_vnd, removed: raw.removed, original };
}

function parseCall(value: unknown): OrderCall | undefined {
  const raw = record(value);
  const id = str(raw?.delivery_id);
  const code = str(raw?.code);
  const state = str(raw?.state);
  const previous = nullableStr(raw?.previous_delivery_id);
  const createdAt = iso(raw?.created_at);
  const endedAt = nullableIso(raw?.ended_at);
  const endReason = nullableStr(raw?.end_reason);
  if (id === undefined || code === undefined || state === undefined || previous === undefined || createdAt === undefined || endedAt === undefined || endReason === undefined) {
    return undefined;
  }
  return { id, code, state, previousId: previous, createdAt, endedAt, endReason };
}

function parseEvent(value: unknown): OrderEventRecord | undefined {
  const raw = record(value);
  const at = iso(raw?.at);
  const type = str(raw?.type);
  const actor = str(raw?.actor);
  const note = nullableStr(raw?.note);
  return at === undefined || type === undefined || actor === undefined || note === undefined ? undefined : { at, type, actor, note };
}

export function parseDetail(data: Record<string, unknown>): OrderDetail | undefined {
  const root = record(data.order) ?? data;
  const id = str(root.order_id);
  const code = str(root.code);
  const display = str(root.display_status);
  const shop = record(root.shop);
  const customer = record(root.customer);
  const recipient = record(root.recipient);
  const money = record(root.money);
  const fee = record(money?.fee);
  const createdAt = iso(root.created_at);
  const note = nullableStr(root.note);
  const scheduled = nullableIso(root.scheduled_for);
  const changeReason = nullableStr(root.change_reason);
  const endActor = nullableStr(root.end_actor);
  const endReason = nullableStr(root.end_reason);
  if (
    id === undefined || !UUID_RE.test(id) || code === undefined || display === undefined || shop === undefined || customer === undefined || recipient === undefined || money === undefined || fee === undefined ||
    createdAt === undefined || note === undefined || scheduled === undefined || changeReason === undefined || endActor === undefined || endReason === undefined ||
    typeof root.status !== 'string' || !STATUSES.includes(root.status) || !whole(root.version) || typeof root.edited !== 'boolean' ||
    !Array.isArray(root.items) || !Array.isArray(root.deliveries) || !Array.isArray(root.timeline) || !Array.isArray(root.can)
  ) {
    return undefined;
  }
  const shopName = str(shop.name);
  const customerUserId = str(customer.user_id);
  const name = str(recipient.name);
  const phone = str(recipient.phone);
  const address = str(recipient.address_text);
  const amount = nullableWhole(fee.amount_vnd);
  const estimate = nullableWhole(fee.estimate_vnd);
  if (
    shopName === undefined || customerUserId === undefined || name === undefined || phone === undefined || address === undefined || amount === undefined || estimate === undefined ||
    !whole(money.items_original_total_vnd) || !whole(money.items_total_vnd) || !whole(money.paid_vnd) || (fee.payer !== 'CUSTOMER' && fee.payer !== 'SHOP')
  ) {
    return undefined;
  }
  const lines: OrderLineRecord[] = [];
  for (const entry of root.items) {
    const parsed = parseLine(entry);
    if (parsed === undefined) {
      return undefined;
    }
    lines.push(parsed);
  }
  const calls: OrderCall[] = [];
  for (const entry of root.deliveries) {
    const parsed = parseCall(entry);
    if (parsed === undefined) {
      return undefined;
    }
    calls.push(parsed);
  }
  const timeline: OrderEventRecord[] = [];
  for (const entry of root.timeline) {
    const parsed = parseEvent(entry);
    if (parsed === undefined) {
      return undefined;
    }
    timeline.push(parsed);
  }
  const can = new Set<OrderActionName>();
  for (const entry of root.can) {
    if (typeof entry !== 'string' || !(ORDER_ACTIONS as readonly string[]).includes(entry)) {
      return undefined;
    }
    can.add(entry as OrderActionName);
  }
  return {
    id, code, status: root.status as OrderStatusName, display, version: root.version, shopName, customerUserId, recipientName: name, recipientPhone: phone, recipientAddress: address, note, scheduledFor: scheduled,
    lines, originalItemsVnd: money.items_original_total_vnd, itemsVnd: money.items_total_vnd, paidVnd: money.paid_vnd, fee: { payer: fee.payer, amountVnd: amount, estimateVnd: estimate },
    edited: root.edited, changeReason, endActor, endReason, createdAt, calls, timeline, can,
  };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** A date typed on the page is a day of Vietnam time; the server reads an ISO instant with an offset. */
const dayStart = (date: string): string | undefined => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00+07:00` : undefined);
const dayAfter = (date: string): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }
  const next = new Date(Date.parse(`${date}T00:00:00+07:00`) + 24 * 3_600_000);
  const vn = new Date(next.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return `${vn}T00:00:00+07:00`;
};

export class AdminOrderApi extends ApiClient {
  list(filter: OrderQuery): Promise<ApiResult<OrderPage>> {
    const path = `/admin/orders${query({
      q: filter.query.trim(),
      status: filter.status === 'ALL' ? undefined : filter.status,
      shop: filter.shop.trim(),
      from: dayStart(filter.from),
      to: dayAfter(filter.to),
      limit: String(ORDER_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * ORDER_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parsePage);
  }

  detail(id: string): Promise<ApiResult<OrderDetail>> {
    return this.call({ method: 'GET', path: `/admin/orders/${encodeURIComponent(id)}` }, parseDetail);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  action(csrf: string, request: OrderActionRequest): Promise<ApiResult<OrderDetail>> {
    return this.call({ method: 'POST', path: `/admin/orders/${encodeURIComponent(request.id)}/actions/${request.name}`, body: { expected_version: request.version, reason: request.reason }, csrf, idempotencyKey: request.key }, parseDetail);
  }
}

const REFUSALS: readonly string[] = ['ORDER_NOT_FOUND', 'ADMIN_ACTION_NOT_ALLOWED', 'AFTER_PICKUP_NO_CANCEL', 'RECALL_BLOCKED_GOODS_OUT', 'ORDER_STATE_CONFLICT', 'ADMIN_INPUT_INVALID'];

async function resultOf(result: ApiResult<unknown>, session: CsrfPort): Promise<OrderActionResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (result.code === 'VERSION_CONFLICT' || result.code === 'DELIVERY_STATE_CONFLICT') {
    return { kind: 'conflict' };
  }
  switch (result.code) {
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
      return REFUSALS.includes(result.code) ? { kind: 'refused', code: result.code } : { kind: 'refused', code: 'ADMIN_INPUT_INVALID' };
  }
}

/** The real OrderSource. It keeps nothing: no rows, no versions, no keys. */
export function createOrderSource(api: AdminOrderApi, session?: CsrfPort): OrderSource {
  return {
    async list(filter): Promise<OrderListRead> {
      const result = await api.list(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total } : failureOf(result);
    },
    async detail(id): Promise<OrderDetailRead> {
      const result = await api.detail(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', order: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async action(request): Promise<OrderActionResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return resultOf(await api.action(csrf, request), session);
    },
  };
}
