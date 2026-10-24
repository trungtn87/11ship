// HTTP client of Delivery management (M07.07): GET /v1/admin/deliveries (list + counters), GET /v1/admin/deliveries/:id (detail) and one POST per
// Admin action. Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed strictly: a body
// that does not have the documented shape is "unknown", never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  AssignmentRecord,
  COMMISSION_HOLD_LABEL,
  CommissionTrace,
  Custody,
  DELIVERY_ACTIONS,
  DELIVERY_PAGE_SIZE,
  DELIVERY_STATES,
  DeliveryActionName,
  DeliveryActionRequest,
  DELIVERY_SIGNALS,
  DeliveryActionResult,
  DeliveryCounters,
  DeliveryDetail,
  DeliveryDetailRead,
  DeliveryListRead,
  DeliveryLocation,
  DeliveryMoney,
  DeliverySignal,
  DeliveryQuery,
  DeliveryRow,
  DeliverySource,
  DeliveryStateName,
  Freshness,
  GeoPoint,
  IncidentRecord,
  LOCATION_STATES,
  LocationState,
  TimelineRecord,
} from './deliveries.js';

/** The transport's base: this client's paths start with /admin. */
export const DELIVERIES_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES: readonly string[] = [...DELIVERY_STATES, 'picked_up'];
const CUSTODIES: readonly string[] = ['SHIPPER', 'SHOP', 'HANDLED'];
const FRESHNESS: readonly string[] = ['LIVE', 'STALE', 'LOST'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableIso = (value: unknown): string | null | undefined => (value === null ? null : iso(value));
const nullableWhole = (value: unknown): number | null | undefined => (value === null ? null : whole(value) ? value : undefined);

function parseSignals(value: unknown): readonly DeliverySignal[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: DeliverySignal[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !(DELIVERY_SIGNALS as readonly string[]).includes(entry)) {
      return undefined;
    }
    out.push(entry as DeliverySignal);
  }
  return out;
}

export function parseRow(value: unknown): DeliveryRow | undefined {
  const raw = record(value);
  const shop = record(raw?.shop);
  const shipper = raw?.shipper === null ? null : record(raw?.shipper);
  const id = str(raw?.delivery_id);
  const code = str(raw?.code);
  const createdAt = iso(raw?.created_at);
  const updatedAt = iso(raw?.updated_at);
  const fee = nullableWhole(raw?.fee_vnd);
  const custody = raw?.custody === null ? null : typeof raw?.custody === 'string' && CUSTODIES.includes(raw.custody) ? (raw.custody as Custody) : undefined;
  const orderId = nullableStr(raw?.order_id);
  const wait = nullableWhole(raw?.wait_seconds);
  const signals = parseSignals(raw?.signals);
  if (
    raw === undefined || shop === undefined || shipper === undefined || id === undefined || !UUID_RE.test(id) || code === undefined || createdAt === undefined || updatedAt === undefined ||
    fee === undefined || custody === undefined || typeof raw.state !== 'string' || !STATES.includes(raw.state) || !whole(raw.goods_value_vnd) || typeof raw.incident_open !== 'boolean' ||
    (raw.source !== 'DIRECT' && raw.source !== 'ORDER') || orderId === undefined || wait === undefined || signals === undefined
  ) {
    return undefined;
  }
  const shopName = str(shop.name);
  const shipperName = shipper === null ? null : str(shipper.name);
  if (shopName === undefined || shipperName === undefined) {
    return undefined;
  }
  return { id, code, source: raw.source, orderId, waitSeconds: wait, signals, shopName, shipperName, state: raw.state as DeliveryStateName, goodsValueVnd: raw.goods_value_vnd, feeVnd: fee, incidentOpen: raw.incident_open, custody, createdAt, updatedAt };
}

export function parseCounters(value: unknown): DeliveryCounters | undefined {
  const raw = record(value);
  if (raw === undefined || !whole(raw.searching) || !whole(raw.waiting_pickup) || !whole(raw.delivering) || !whole(raw.needs_attention)) {
    return undefined;
  }
  return { searching: raw.searching, waitingPickup: raw.waiting_pickup, delivering: raw.delivering, needsAttention: raw.needs_attention };
}

export interface DeliveryPage {
  readonly rows: readonly DeliveryRow[];
  readonly total: number;
  readonly counters: DeliveryCounters;
}

export function parsePage(data: Record<string, unknown>): DeliveryPage | undefined {
  const counters = parseCounters(data.counters);
  if (!Array.isArray(data.items) || !whole(data.total) || counters === undefined) {
    return undefined;
  }
  const rows: DeliveryRow[] = [];
  for (const entry of data.items) {
    const row = parseRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  return { rows, total: data.total, counters };
}

function parseLocation(value: unknown): DeliveryLocation | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  const recordedAt = iso(raw?.recorded_at);
  if (raw === undefined || typeof raw.lat !== 'number' || typeof raw.lng !== 'number' || recordedAt === undefined || !whole(raw.age_seconds) || typeof raw.freshness !== 'string' || !FRESHNESS.includes(raw.freshness)) {
    return undefined;
  }
  return { lat: raw.lat, lng: raw.lng, recordedAt, ageSeconds: raw.age_seconds, freshness: raw.freshness as Freshness };
}

function parseAssignment(value: unknown): AssignmentRecord | undefined {
  const raw = record(value);
  const id = str(raw?.assignment_id);
  const shipperName = str(raw?.shipper_name);
  const status = str(raw?.status);
  const acceptedAt = iso(raw?.accepted_at);
  const endedAt = nullableIso(raw?.ended_at);
  const endReason = nullableStr(raw?.end_reason);
  const endActor = nullableStr(raw?.end_actor);
  const driverId = nullableStr(raw?.shipper_driver_id);
  if (id === undefined || shipperName === undefined || status === undefined || acceptedAt === undefined || endedAt === undefined || endReason === undefined || endActor === undefined || driverId === undefined || (driverId !== null && !UUID_RE.test(driverId))) {
    return undefined;
  }
  return { id, shipperName, shipperDriverId: driverId, status, acceptedAt, endedAt, endReason, endActor };
}

function parseTimeline(value: unknown): TimelineRecord | undefined {
  const raw = record(value);
  const at = iso(raw?.at);
  const type = str(raw?.type);
  const actor = str(raw?.actor);
  const note = nullableStr(raw?.note);
  return at === undefined || type === undefined || actor === undefined || note === undefined ? undefined : { at, type, actor, note };
}

function parseIncident(value: unknown): IncidentRecord | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  const id = str(raw?.incident_id);
  const reason = str(raw?.reason);
  const openedAt = iso(raw?.opened_at);
  const closedAt = nullableIso(raw?.closed_at);
  const referred = nullableIso(raw?.m11_referred_at);
  if (
    raw === undefined || id === undefined || reason === undefined || openedAt === undefined || closedAt === undefined || referred === undefined ||
    (raw.status !== 'OPEN' && raw.status !== 'CLOSED') || typeof raw.custody !== 'string' || !CUSTODIES.includes(raw.custody)
  ) {
    return undefined;
  }
  return { id, status: raw.status, custody: raw.custody as Custody, reason, openedAt, closedAt, m11ReferredAt: referred };
}

function parsePoint(lat: unknown, lng: unknown): GeoPoint | null | undefined {
  if (lat === null && lng === null) {
    return null;
  }
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

function parseMoney(value: unknown): DeliveryMoney | undefined {
  const raw = record(value);
  if (raw?.status === 'FORBIDDEN') {
    return { status: 'FORBIDDEN' };
  }
  if (raw === undefined || raw.status !== 'OK' || !Array.isArray(raw.commissions)) {
    return undefined;
  }
  const commissions: CommissionTrace[] = [];
  for (const entry of raw.commissions) {
    const item = record(entry);
    const assignmentId = str(item?.assignment_id);
    const entryId = nullableStr(item?.ledger_entry_id);
    const at = nullableIso(item?.ledger_at);
    if (item === undefined || assignmentId === undefined || entryId === undefined || at === undefined || typeof item.hold_status !== 'string' || !(item.hold_status in COMMISSION_HOLD_LABEL) || !whole(item.amount_vnd)) {
      return undefined;
    }
    commissions.push({ assignmentId, holdStatus: item.hold_status as CommissionTrace['holdStatus'], amountVnd: item.amount_vnd, ledgerEntryId: entryId, ledgerAt: at });
  }
  return { status: 'OK', commissions };
}

export function parseDetail(data: Record<string, unknown>): DeliveryDetail | undefined {
  const root = record(data.delivery) ?? data;
  const id = str(root.delivery_id);
  const code = str(root.code);
  const shop = record(root.shop);
  const shipper = root.shipper === null ? null : record(root.shipper);
  const recipient = record(root.recipient);
  const goods = record(root.goods);
  const fee = record(root.fee);
  const search = record(root.search);
  const policy = record(root.policy);
  const location = parseLocation(root.location);
  const incident = parseIncident(root.incident);
  const orderId = nullableStr(root.order_id);
  const previous = nullableStr(root.previous_delivery_id);
  const pickupRaw = record(root.pickup);
  const dropRaw = record(root.dropoff);
  const linksRaw = record(root.links);
  const money = parseMoney(root.money);
  const dropPoint = dropRaw === undefined ? undefined : parsePoint(dropRaw.lat, dropRaw.lng);
  const nextRaw = linksRaw?.next_delivery === null ? null : record(linksRaw?.next_delivery);
  const nextId = nextRaw === null ? null : str(nextRaw?.delivery_id);
  const nextCode = nextRaw === null ? null : str(nextRaw?.code);
  const linkShipper = nullableStr(linksRaw?.shipper_driver_id);
  const linkOrder = nullableStr(linksRaw?.order_id);
  const linkPrevious = nullableStr(linksRaw?.previous_delivery_id);
  const linkShop = str(linksRaw?.shop_id);
  const pickupAddress = str(pickupRaw?.address_text);
  const dropArea = nullableStr(dropRaw?.area_text);
  const dropAddress = nullableStr(dropRaw?.address_text);
  const locationState = typeof root.location_state === 'string' && (LOCATION_STATES as readonly string[]).includes(root.location_state) ? (root.location_state as LocationState) : undefined;
  if (
    pickupRaw === undefined || dropRaw === undefined || linksRaw === undefined || money === undefined || dropPoint === undefined || nextRaw === undefined || nextId === undefined || nextCode === undefined || linkShipper === undefined ||
    linkOrder === undefined || linkPrevious === undefined || linkShop === undefined || pickupAddress === undefined || dropArea === undefined || dropAddress === undefined || locationState === undefined ||
    typeof pickupRaw.lat !== 'number' || typeof pickupRaw.lng !== 'number' || typeof dropRaw.pinned !== 'boolean' || (nextRaw !== null && (nextId === undefined || nextCode === undefined))
  ) {
    return undefined;
  }
  if (
    id === undefined || !UUID_RE.test(id) || code === undefined || shop === undefined || shipper === undefined || recipient === undefined || goods === undefined || fee === undefined || search === undefined ||
    policy === undefined || location === undefined || incident === undefined || orderId === undefined || previous === undefined ||
    (root.source !== 'DIRECT' && root.source !== 'ORDER') || typeof root.state !== 'string' || !STATES.includes(root.state) || !whole(root.version) ||
    !Array.isArray(root.assignments) || !Array.isArray(root.timeline) || !Array.isArray(root.can)
  ) {
    return undefined;
  }
  const shopName = str(shop.name);
  const shipperName = shipper === null ? null : str(shipper.name);
  const name = nullableStr(recipient.name);
  const phone = nullableStr(recipient.phone);
  const address = nullableStr(recipient.address_text);
  const description = str(goods.description);
  const startedAt = iso(search.started_at);
  const expiresAt = iso(search.expires_at);
  const feeVnd = nullableWhole(fee.amount_vnd);
  const radius = policy.search_radius_m;
  const commission = nullableWhole(policy.commission_vnd);
  const feePolicy = nullableWhole(policy.fee_policy_version_no);
  if (
    shopName === undefined || shipperName === undefined || name === undefined || phone === undefined || address === undefined || description === undefined || startedAt === undefined || expiresAt === undefined ||
    feeVnd === undefined || !whole(goods.value_vnd) || !whole(goods.paid_vnd) || typeof fee.mode !== 'string' || (fee.payer !== 'CUSTOMER' && fee.payer !== 'SHOP') || !whole(radius) ||
    commission === undefined || feePolicy === undefined
  ) {
    return undefined;
  }
  const assignments: AssignmentRecord[] = [];
  for (const entry of root.assignments) {
    const parsed = parseAssignment(entry);
    if (parsed === undefined) {
      return undefined;
    }
    assignments.push(parsed);
  }
  const timeline: TimelineRecord[] = [];
  for (const entry of root.timeline) {
    const parsed = parseTimeline(entry);
    if (parsed === undefined) {
      return undefined;
    }
    timeline.push(parsed);
  }
  const can = new Set<DeliveryActionName>();
  for (const entry of root.can) {
    if (typeof entry !== 'string' || !(DELIVERY_ACTIONS as readonly string[]).includes(entry)) {
      return undefined;
    }
    can.add(entry as DeliveryActionName);
  }
  return {
    id, code, source: root.source, orderId, previousDeliveryId: previous, state: root.state as DeliveryStateName, version: root.version, shopName, shipperName,
    recipientName: name, recipientPhone: phone, recipientAddress: address, goodsDescription: description, goodsValueVnd: goods.value_vnd, paidVnd: goods.paid_vnd,
    feeVnd, feeMode: fee.mode, feePayer: fee.payer, searchStartedAt: startedAt, searchExpiresAt: expiresAt, location, locationState,
    pickup: { addressText: pickupAddress, lat: pickupRaw.lat, lng: pickupRaw.lng },
    dropoff: { areaText: dropArea, addressText: dropAddress, point: dropPoint, pinned: dropRaw.pinned },
    links: { shopId: linkShop, shipperDriverId: linkShipper, orderId: linkOrder, previousDeliveryId: linkPrevious, nextDelivery: nextId === null || nextCode === null ? null : { id: nextId, code: nextCode } },
    money, assignments, timeline, incident,
    policy: { searchRadiusM: radius, commissionVnd: commission, feePolicyVersion: feePolicy }, can,
  };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export class AdminDeliveryApi extends ApiClient {
  list(filter: DeliveryQuery): Promise<ApiResult<DeliveryPage>> {
    const path = `/admin/deliveries${query({
      q: filter.query.trim(),
      state: filter.state === 'ALL' ? undefined : filter.state,
      goods: filter.goods === 'ALL' ? undefined : filter.goods,
      from: filter.from,
      to: filter.to,
      shop: filter.shop.trim(),
      shipper: filter.shipper.trim(),
      group: filter.group,
      source: filter.source === undefined || filter.source === 'ALL' ? undefined : filter.source,
      basis: filter.basis === 'ended' ? 'ended' : undefined,
      limit: String(DELIVERY_PAGE_SIZE),
      offset: String((Math.max(filter.page, 1) - 1) * DELIVERY_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parsePage);
  }

  detail(id: string): Promise<ApiResult<DeliveryDetail>> {
    return this.call({ method: 'GET', path: `/admin/deliveries/${encodeURIComponent(id)}` }, parseDetail);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  action(csrf: string, request: DeliveryActionRequest): Promise<ApiResult<DeliveryDetail>> {
    const body: Record<string, unknown> = { expected_version: request.version, reason: request.reason };
    if (request.resolution !== undefined) {
      body.resolution = request.resolution;
    }
    if (request.feeVnd !== undefined) {
      body.fee_vnd = request.feeVnd;
    }
    if (request.recipientAddress !== undefined) {
      body.recipient_address_text = request.recipientAddress;
    }
    return this.call({ method: 'POST', path: `/admin/deliveries/${encodeURIComponent(request.id)}/actions/${request.name}`, body, csrf, idempotencyKey: request.key }, parseDetail);
  }
}

const REFUSALS: readonly string[] = ['DELIVERY_NOT_FOUND', 'DELIVERY_STATE_CONFLICT', 'ADMIN_ACTION_NOT_ALLOWED', 'FEE_LOCKED', 'ADMIN_INPUT_INVALID', 'M11_NOT_AVAILABLE'];

async function resultOf(result: ApiResult<unknown>, session: CsrfPort): Promise<DeliveryActionResult> {
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

/** The real DeliverySource. It keeps nothing: no rows, no versions, no keys. */
export function createDeliverySource(api: AdminDeliveryApi, session?: CsrfPort): DeliverySource {
  return {
    async list(filter): Promise<DeliveryListRead> {
      const result = await api.list(filter);
      return result.kind === 'ok' ? { kind: 'ready', rows: result.data.rows, total: result.data.total, counters: result.data.counters } : failureOf(result);
    },
    async detail(id): Promise<DeliveryDetailRead> {
      const result = await api.detail(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', delivery: result.data };
      }
      if (result.kind === 'error' && result.status === 404) {
        return { kind: 'not-found' };
      }
      return failureOf(result);
    },
    async action(request): Promise<DeliveryActionResult> {
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
