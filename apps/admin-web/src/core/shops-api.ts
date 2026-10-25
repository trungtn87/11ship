// HTTP client of shop management (M02 "Quản lý quán"): GET /v1/admin/shops (list), /:id (detail), /:id/menu, /:id/history, /:id/preview and one POST per
// status command (disable / enable). Cookie-only (HttpOnly session, same origin); the CSRF token is passed in from memory. Every answer is parsed
// strictly: a body that does not have the documented shape is a failure, never half-shown data. Nothing is stored here.

import { CsrfPort, failureOf } from './accounts-api.js';
import { ApiClient, ApiResult, record, str } from './api.js';
import {
  Availability,
  AvailabilityReason,
  BusinessInterval,
  DetailRead,
  HistoryEntry,
  HistoryPage,
  HistoryRead,
  HISTORY_PAGE_SIZE,
  ListRead,
  MenuGroup,
  MenuItem,
  MenuPage,
  MenuQuery,
  MenuRead,
  MENU_PAGE_SIZE,
  OwnerInfo,
  Preview,
  PreviewRead,
  ShopCommandName,
  ShopCommandRequest,
  ShopCommandResult,
  ShopDetail,
  ShopListPage,
  ShopQuery,
  ShopRow,
  ShopSource,
  SetupInfo,
  SetupState,
  ShopStatus,
  SHOP_PAGE_SIZE,
} from './shops.js';

/** The transport's base: this client's paths start with /admin. */
export const SHOPS_BASE = '/v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly string[] = ['INCOMPLETE', 'ACTIVE', 'DISABLED'];
const REASONS: readonly string[] = ['SHOP_DISABLED', 'SHOP_INCOMPLETE', 'SERVICE_AREA_INACTIVE', 'NO_BUSINESS_HOURS', 'NO_PICKUP_POINT', 'NO_SELLABLE_ITEM', 'OUTSIDE_BUSINESS_HOURS', 'ONLINE'];
const SETUP_STATES: readonly string[] = ['INCOMPLETE', 'ACTIVATED', 'LOCKED', 'NEEDS_REVIEW'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const iso = (value: unknown): string | undefined => {
  const text = str(value);
  return text !== undefined && !Number.isNaN(Date.parse(text)) ? text : undefined;
};
const nullableStr = (value: unknown): string | null | undefined => (value === null ? null : str(value));
const nullableNumber = (value: unknown): number | null | undefined => (value === null ? null : typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function parseOwner(value: unknown): OwnerInfo | null | undefined {
  if (value === null) {
    return null;
  }
  const raw = record(value);
  const name = nullableStr(raw?.name);
  const phone = str(raw?.phone);
  if (raw === undefined || name === undefined || phone === undefined || typeof raw.locked !== 'boolean') {
    return undefined;
  }
  return { name, phone, locked: raw.locked };
}

function parseAvailability(value: unknown): Availability | undefined {
  const raw = record(value);
  const evaluatedAt = iso(raw?.evaluated_at);
  if (raw === undefined || evaluatedAt === undefined || typeof raw.online !== 'boolean' || typeof raw.reason !== 'string' || !REASONS.includes(raw.reason)) {
    return undefined;
  }
  return { online: raw.online, reason: raw.reason as AvailabilityReason, evaluatedAt };
}

const stringList = (value: unknown): string[] | undefined => (Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? (value as string[]) : undefined);

/** The setup block of the list row and the detail (issue #190). Any other shape is a failure: nothing is guessed. */
export function parseSetup(value: unknown): SetupInfo | undefined {
  const raw = record(value);
  const missing = stringList(raw?.missing);
  const stepsRaw = raw?.steps;
  if (raw === undefined || typeof raw.state !== 'string' || !SETUP_STATES.includes(raw.state) || !whole(raw.completed_steps) || !whole(raw.total_steps) || missing === undefined || !Array.isArray(stepsRaw) || typeof raw.public !== 'boolean') {
    return undefined;
  }
  const steps: SetupInfo['steps'][number][] = [];
  for (const entry of stepsRaw) {
    const step = record(entry);
    const key = str(step?.key);
    const stepMissing = stringList(step?.missing);
    if (step === undefined || key === undefined || typeof step.done !== 'boolean' || stepMissing === undefined) {
      return undefined;
    }
    steps.push({ key, done: step.done, missing: stepMissing });
  }
  let request: SetupInfo['request'] = null;
  if (raw.request !== null && raw.request !== undefined) {
    const entry = record(raw.request);
    const note = str(entry?.note);
    const requestedAt = iso(entry?.requested_at);
    if (note === undefined || requestedAt === undefined) {
      return undefined;
    }
    request = { note, requestedAt };
  }
  let lock: SetupInfo['lock'] = null;
  if (raw.lock !== null && raw.lock !== undefined) {
    const entry = record(raw.lock);
    const kind = str(entry?.kind);
    const reason = nullableStr(entry?.reason);
    if (kind === undefined || reason === undefined) {
      return undefined;
    }
    lock = { kind, reason };
  }
  const activatedRaw = raw.activated_at;
  const activatedAt = activatedRaw === undefined || activatedRaw === null ? null : (iso(activatedRaw) ?? null);
  return { state: raw.state as SetupState, completedSteps: raw.completed_steps, totalSteps: raw.total_steps, steps, missing, public: raw.public, request, lock, activatedAt };
}

function parseHours(value: unknown): BusinessInterval[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: BusinessInterval[] = [];
  for (const entry of value) {
    const raw = record(entry);
    if (raw === undefined || !whole(raw.weekday) || raw.weekday < 1 || raw.weekday > 7 || !whole(raw.start_minute) || raw.start_minute > 1439 || !whole(raw.end_minute) || raw.end_minute > 1440 || (raw.end_day_offset !== 0 && raw.end_day_offset !== 1)) {
      return undefined;
    }
    out.push({ weekday: raw.weekday, startMinute: raw.start_minute, endMinute: raw.end_minute, endDayOffset: raw.end_day_offset });
  }
  return out;
}

const ACTION_NAMES: Readonly<Record<string, ShopCommandName | undefined>> = { DISABLE: 'disable', ENABLE: 'enable', REQUEST_INFO: 'request-info', CLEAR_REQUEST: 'clear-request' };

function parseStatus(value: unknown): ShopStatus | undefined {
  return typeof value === 'string' && STATUSES.includes(value) ? (value as ShopStatus) : undefined;
}

export function parseRow(value: unknown): ShopRow | undefined {
  const raw = record(value);
  const id = str(raw?.shop_id);
  const code = str(raw?.code);
  const name = str(raw?.name);
  const addressText = str(raw?.address_text);
  const owner = parseOwner(raw?.owner);
  const status = parseStatus(raw?.status);
  const availability = parseAvailability(raw?.availability);
  const area = raw?.service_area === null ? null : record(raw?.service_area);
  const setup = parseSetup(raw?.setup);
  if (raw === undefined || id === undefined || !UUID_RE.test(id) || code === undefined || name === undefined || addressText === undefined || owner === undefined || status === undefined || availability === undefined || area === undefined || setup === undefined || !whole(raw.items_visible) || !whole(raw.items_total)) {
    return undefined;
  }
  const areaName = area === null ? null : (nullableStr(area.name) ?? null);
  return { id, code, name, addressText, owner, areaName, status, availability, itemsVisible: raw.items_visible, itemsTotal: raw.items_total, setup };
}

export function parsePage(data: Record<string, unknown>): ShopListPage | undefined {
  if (!Array.isArray(data.items) || !whole(data.total) || !Array.isArray(data.areas)) {
    return undefined;
  }
  const rows: ShopRow[] = [];
  for (const entry of data.items) {
    const row = parseRow(entry);
    if (row === undefined) {
      return undefined;
    }
    rows.push(row);
  }
  const areas: ShopListPage['areas'][number][] = [];
  for (const entry of data.areas) {
    const raw = record(entry);
    const id = str(raw?.service_area_id);
    const name = str(raw?.name);
    if (raw === undefined || id === undefined || !UUID_RE.test(id) || name === undefined || (raw.status !== 'ACTIVE' && raw.status !== 'INACTIVE')) {
      return undefined;
    }
    areas.push({ id, name, active: raw.status === 'ACTIVE' });
  }
  return { rows, total: data.total, areas };
}

export function parseDetail(data: Record<string, unknown>): ShopDetail | undefined {
  const id = str(data.shop_id);
  const code = str(data.code);
  const name = str(data.name);
  const status = parseStatus(data.status);
  const owner = parseOwner(data.owner);
  const logoUrl = nullableStr(data.logo_url);
  const availability = parseAvailability(data.availability);
  const setup = parseSetup(data.setup);
  const hours = parseHours(data.hours);
  const profile = record(data.profile);
  const menu = record(data.menu);
  const work = record(data.open_work);
  const createdAt = iso(data.created_at);
  const updatedAt = iso(data.updated_at);
  const timezone = str(data.timezone);
  if (
    id === undefined || !UUID_RE.test(id) || code === undefined || name === undefined || status === undefined || owner === undefined || logoUrl === undefined || availability === undefined ||
    setup === undefined || hours === undefined || profile === undefined || menu === undefined || work === undefined || createdAt === undefined || updatedAt === undefined || timezone === undefined ||
    !whole(data.version) || data.version < 1 || typeof data.disable_blocked !== 'boolean' || !Array.isArray(data.enable_blockers) || !data.enable_blockers.every((entry) => typeof entry === 'string') ||
    !Array.isArray(data.allowed_actions) || !data.allowed_actions.every((entry) => ACTION_NAMES[entry as string] !== undefined)
  ) {
    return undefined;
  }
  const contactPhone = str(profile.contact_phone);
  const zalo = nullableStr(profile.zalo);
  const facebook = nullableStr(profile.facebook);
  const addressText = str(profile.address_text);
  const lat = nullableNumber(profile.pickup_lat);
  const lng = nullableNumber(profile.pickup_lng);
  const area = profile.service_area === null ? null : record(profile.service_area);
  if (contactPhone === undefined || zalo === undefined || facebook === undefined || addressText === undefined || lat === undefined || lng === undefined || area === undefined) {
    return undefined;
  }
  if (!whole(menu.visible) || !whole(menu.hidden) || !whole(work.orders_open) || !whole(work.orders_pending_confirmation) || !whole(work.orders_preparing) || !whole(work.active_deliveries)) {
    return undefined;
  }
  return {
    id, code, name, status, version: data.version, logoUrl, owner, contactPhone, zalo, facebook, addressText,
    areaName: area === null ? null : (nullableStr(area.name) ?? null),
    areaActive: area === null ? null : area.status === 'ACTIVE',
    pickupLat: lat, pickupLng: lng, availability, setup, timezone, hours,
    menuVisible: menu.visible, menuHidden: menu.hidden,
    ordersOpen: work.orders_open, ordersPendingConfirmation: work.orders_pending_confirmation, ordersPreparing: work.orders_preparing, activeDeliveries: work.active_deliveries,
    disableBlocked: data.disable_blocked, enableBlockers: data.enable_blockers as string[],
    actions: (data.allowed_actions as string[]).map((action) => ACTION_NAMES[action] as ShopCommandName),
    createdAt, updatedAt,
  };
}

export function parseMenu(data: Record<string, unknown>): MenuPage | undefined {
  if (!Array.isArray(data.categories) || !Array.isArray(data.items) || !whole(data.total)) {
    return undefined;
  }
  const groups: MenuGroup[] = [];
  for (const entry of data.categories) {
    const raw = record(entry);
    const id = str(raw?.category_id);
    const name = str(raw?.name);
    if (raw === undefined || id === undefined || name === undefined || (raw.status !== 'ACTIVE' && raw.status !== 'INACTIVE') || !whole(raw.item_count)) {
      return undefined;
    }
    groups.push({ id, name, active: raw.status === 'ACTIVE', itemCount: raw.item_count });
  }
  const items: MenuItem[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const id = str(raw?.item_id);
    const name = str(raw?.name);
    const category = record(raw?.category);
    const imageUrl = nullableStr(raw?.image_url);
    const updatedAt = iso(raw?.updated_at);
    const categoryId = str(category?.category_id);
    const categoryName = str(category?.name);
    if (raw === undefined || id === undefined || name === undefined || category === undefined || categoryId === undefined || categoryName === undefined || imageUrl === undefined || updatedAt === undefined || !whole(raw.price_vnd) || (raw.status !== 'VISIBLE' && raw.status !== 'HIDDEN')) {
      return undefined;
    }
    items.push({ id, name, priceVnd: raw.price_vnd, categoryId, categoryName, categoryActive: category.status === 'ACTIVE', status: raw.status, imageUrl, updatedAt });
  }
  return { groups, items, total: data.total };
}

export function parseHistory(data: Record<string, unknown>): HistoryPage | undefined {
  if (!Array.isArray(data.items) || !whole(data.total)) {
    return undefined;
  }
  const entries: HistoryEntry[] = [];
  for (const entry of data.items) {
    const raw = record(entry);
    const id = str(raw?.audit_id);
    const at = iso(raw?.occurred_at);
    const action = str(raw?.action);
    const actor = record(raw?.actor);
    const actorName = nullableStr(actor?.name);
    const reason = nullableStr(raw?.reason);
    const fromStatus = nullableStr(raw?.from_status);
    const toStatus = nullableStr(raw?.to_status);
    const version = raw?.version === null ? null : whole(raw?.version) ? raw.version : undefined;
    if (raw === undefined || id === undefined || at === undefined || action === undefined || actor === undefined || actorName === undefined || reason === undefined || fromStatus === undefined || toStatus === undefined || version === undefined || (actor.type !== 'ADMIN' && actor.type !== 'SYSTEM' && actor.type !== 'OWNER')) {
      return undefined;
    }
    entries.push({ id, at, actor: { type: actor.type, name: actorName }, action, version, reason, fromStatus, toStatus });
  }
  return { entries, total: data.total };
}

export function parsePreview(data: Record<string, unknown>): Preview | undefined {
  if (data.visible_to_customers === false) {
    const missing = data.missing === undefined ? [] : stringList(data.missing);
    return typeof data.reason === 'string' && REASONS.includes(data.reason) && missing !== undefined ? { visible: false, reason: data.reason as AvailabilityReason, missing } : undefined;
  }
  const name = str(data.name);
  const addressText = str(data.address_text);
  const logoUrl = nullableStr(data.logo_url);
  const availability = parseAvailability(data.availability);
  const hours = parseHours(data.hours);
  if (data.visible_to_customers !== true || name === undefined || addressText === undefined || logoUrl === undefined || availability === undefined || hours === undefined || !Array.isArray(data.categories)) {
    return undefined;
  }
  const categories: Extract<Preview, { visible: true }>['categories'][number][] = [];
  for (const entry of data.categories) {
    const raw = record(entry);
    const id = str(raw?.category_id);
    const groupName = str(raw?.name);
    if (raw === undefined || id === undefined || groupName === undefined || !Array.isArray(raw.items)) {
      return undefined;
    }
    const items: Extract<Preview, { visible: true }>['categories'][number]['items'][number][] = [];
    for (const dish of raw.items) {
      const item = record(dish);
      const itemId = str(item?.item_id);
      const itemName = str(item?.name);
      const imageUrl = nullableStr(item?.image_url);
      if (item === undefined || itemId === undefined || itemName === undefined || imageUrl === undefined || !whole(item.price_vnd)) {
        return undefined;
      }
      items.push({ id: itemId, name: itemName, priceVnd: item.price_vnd, imageUrl });
    }
    categories.push({ id, name: groupName, items });
  }
  return { visible: true, name, logoUrl, addressText, availability, hours, categories };
}

function query(params: Readonly<Record<string, string | undefined>>): string {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value as string)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

const offsetOf = (page: number, size: number): string => String((Math.max(page, 1) - 1) * size);
const idPath = (id: string): string => `/admin/shops/${encodeURIComponent(id)}`;

export class AdminShopApi extends ApiClient {
  list(filter: ShopQuery): Promise<ApiResult<ShopListPage>> {
    const path = `/admin/shops${query({
      q: filter.query.trim(),
      area: filter.area === 'ALL' ? undefined : filter.area,
      profile: filter.profile === 'ALL' ? undefined : filter.profile,
      schedule: filter.schedule === 'ALL' ? undefined : filter.schedule,
      setup: filter.setup === 'ALL' ? undefined : filter.setup,
      limit: String(SHOP_PAGE_SIZE),
      offset: offsetOf(filter.page, SHOP_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parsePage);
  }

  detail(id: string): Promise<ApiResult<ShopDetail>> {
    return this.call({ method: 'GET', path: idPath(id) }, parseDetail);
  }

  menu(id: string, filter: MenuQuery): Promise<ApiResult<MenuPage>> {
    const path = `${idPath(id)}/menu${query({
      q: filter.query.trim(),
      category: filter.category === 'ALL' ? undefined : filter.category,
      status: filter.status === 'ALL' ? undefined : filter.status,
      limit: String(MENU_PAGE_SIZE),
      offset: offsetOf(filter.page, MENU_PAGE_SIZE),
    })}`;
    return this.call({ method: 'GET', path }, parseMenu);
  }

  history(id: string, page: number): Promise<ApiResult<HistoryPage>> {
    return this.call({ method: 'GET', path: `${idPath(id)}/history${query({ limit: String(HISTORY_PAGE_SIZE), offset: offsetOf(page, HISTORY_PAGE_SIZE) })}` }, parseHistory);
  }

  preview(id: string): Promise<ApiResult<Preview>> {
    return this.call({ method: 'GET', path: `${idPath(id)}/preview` }, parsePreview);
  }

  /** One request; the caller owns the key and never repeats the call by itself. */
  command(csrf: string, request: ShopCommandRequest): Promise<ApiResult<ShopDetail>> {
    return this.call({ method: 'POST', path: `${idPath(request.id)}/${request.name}`, body: { expected_version: request.version, reason: request.reason }, csrf, idempotencyKey: request.key }, parseDetail);
  }
}

/** Codes that mean "the server looked at it and said no": nothing changed, the page shows a sentence. */
const REFUSALS: readonly string[] = ['SHOP_NOT_FOUND', 'SHOP_STATE_CONFLICT', 'SHOP_HAS_OPEN_WORK', 'SHOP_PROFILE_INCOMPLETE', 'INVALID_SERVICE_AREA', 'ADMIN_INPUT_INVALID'];

async function resultOf(result: ApiResult<unknown>, session: CsrfPort): Promise<ShopCommandResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  // No usable answer, or a server fault (503 TRANSACTION_OUTCOME_UNKNOWN included): the command may have been executed.
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (result.code === 'VERSION_CONFLICT') {
    return { kind: 'conflict' };
  }
  switch (result.code) {
    case 'ADMIN_CSRF_INVALID':
      // Refused before anything ran; a fresh token is read and the admin retries with the SAME key.
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

/** The real ShopSource. It keeps nothing: no rows, no versions, no keys. */
export function createShopSource(api: AdminShopApi, session?: CsrfPort): ShopSource {
  const notFound = (result: Exclude<ApiResult<unknown>, { kind: 'ok' }>): boolean => result.kind === 'error' && result.status === 404;
  return {
    async list(filter): Promise<ListRead> {
      const result = await api.list(filter);
      return result.kind === 'ok' ? { kind: 'ready', page: result.data } : failureOf(result);
    },
    async detail(id): Promise<DetailRead> {
      const result = await api.detail(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', shop: result.data };
      }
      return notFound(result) ? { kind: 'not-found' } : failureOf(result);
    },
    async menu(id, filter): Promise<MenuRead> {
      const result = await api.menu(id, filter);
      if (result.kind === 'ok') {
        return { kind: 'ready', page: result.data };
      }
      return notFound(result) ? { kind: 'not-found' } : failureOf(result);
    },
    async history(id, page): Promise<HistoryRead> {
      const result = await api.history(id, page);
      if (result.kind === 'ok') {
        return { kind: 'ready', page: result.data };
      }
      return notFound(result) ? { kind: 'not-found' } : failureOf(result);
    },
    async preview(id): Promise<PreviewRead> {
      const result = await api.preview(id);
      if (result.kind === 'ok') {
        return { kind: 'ready', preview: result.data };
      }
      return notFound(result) ? { kind: 'not-found' } : failureOf(result);
    },
    async command(request): Promise<ShopCommandResult> {
      if (session === undefined) {
        return { kind: 'not-wired' };
      }
      const csrf = session.csrf();
      if (csrf === undefined) {
        return { kind: 'session-expired' };
      }
      return resultOf(await api.command(csrf, request), session);
    },
  };
}
