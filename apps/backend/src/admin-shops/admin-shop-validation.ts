import { parseReason } from '../admin-access/admin-access-validation';
import { AppError } from '../common/app-errors';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { isCanonicalUuid } from '../shared/identifiers';
import { SHOP_STATUSES, ShopStatus } from '../shop/shop-types';
import { SETUP_STATES, SetupState } from '../shop-setup/shop-setup-rules';

// Strict parsers of the shop-management routes of the administration web (M02 "Quản lý quán"). The actor comes from the session and the target
// from the path; a body never names an actor, a status or a right. Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID.

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;
export const LIST_MAX_OFFSET = 100000;
export const SEARCH_MAX_CODEPOINTS = 80;

export const SCHEDULE_FILTERS = ['OPEN', 'CLOSED'] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];

export type { SetupState } from '../shop-setup/shop-setup-rules';

export const MENU_STATUS_FILTERS = ['VISIBLE', 'HIDDEN'] as const;
export type MenuStatusFilter = (typeof MENU_STATUS_FILTERS)[number];

function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    invalid();
  }
  return value as Record<string, unknown>;
}

function onlyKeys(source: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  for (const key of required) {
    if (!Object.hasOwn(source, key)) {
      invalid();
    }
  }
  for (const key of Object.keys(source)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalid();
    }
  }
}

function queryValue(source: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(source, key)) {
    return undefined;
  }
  const value = source[key];
  if (typeof value !== 'string') {
    invalid();
  }
  return value;
}

function integerParam(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^(0|[1-9][0-9]{0,6})$/.test(raw)) {
    invalid();
  }
  const parsed = Number(raw);
  if (parsed < min || parsed > max) {
    invalid();
  }
  return parsed;
}

export function parseShopId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
}

export function parseNoQuery(query: unknown): void {
  onlyKeys(plainObject(query), []);
}

interface SearchText {
  /** The text as typed, trimmed (echoed back so the screen keeps it). */
  readonly q: string | null;
  readonly name: string | null;
  readonly digits: string | null;
}

function parseSearch(raw: string | undefined): SearchText {
  if (raw === undefined) {
    return { q: null, name: null, digits: null };
  }
  const trimmed = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if ([...trimmed].length > SEARCH_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    invalid();
  }
  if (trimmed === '') {
    return { q: null, name: null, digits: null };
  }
  // A phone-like text also searches the numbers: digits only, without the leading 0 / +, so "0912..." finds "+84912...".
  const digits = /^[+0-9][0-9 .+-]*$/u.test(trimmed) ? trimmed.replace(/\D/gu, '').replace(/^0+/u, '') : '';
  return { q: trimmed, name: likeContains(foldVietnamese(trimmed)), digits: digits.length >= 3 ? likeContains(digits) : null };
}

function page(source: Record<string, unknown>): { limit: number; offset: number } {
  return { limit: integerParam(queryValue(source, 'limit'), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT), offset: integerParam(queryValue(source, 'offset'), 0, 0, LIST_MAX_OFFSET) };
}

function choice<T extends string>(raw: string | undefined, allowed: readonly T[]): T | null {
  if (raw === undefined || raw === 'ALL') {
    return null;
  }
  if (!(allowed as readonly string[]).includes(raw)) {
    invalid();
  }
  return raw as T;
}

export interface ShopListQuery extends SearchText {
  readonly areaId: string | null;
  readonly profile: ShopStatus | null;
  readonly schedule: ScheduleFilter | null;
  /** Issue #190: the setup state (Chưa hoàn tất / Đã kích hoạt / Tạm khóa / Cần kiểm tra). */
  readonly setup: SetupState | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseShopListQuery(query: unknown): ShopListQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'area', 'profile', 'schedule', 'setup', 'limit', 'offset']);
  const area = queryValue(source, 'area');
  if (area !== undefined && area !== 'ALL' && !isCanonicalUuid(area)) {
    invalid();
  }
  return {
    ...parseSearch(queryValue(source, 'q')),
    areaId: area === undefined || area === 'ALL' ? null : area,
    profile: choice(queryValue(source, 'profile'), SHOP_STATUSES),
    schedule: choice(queryValue(source, 'schedule'), SCHEDULE_FILTERS),
    setup: choice(queryValue(source, 'setup'), SETUP_STATES),
    ...page(source),
  };
}

export interface ShopMenuQuery {
  readonly q: string | null;
  readonly name: string | null;
  readonly categoryId: string | null;
  readonly status: MenuStatusFilter | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseShopMenuQuery(query: unknown): ShopMenuQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'category', 'status', 'limit', 'offset']);
  const category = queryValue(source, 'category');
  if (category !== undefined && category !== 'ALL' && !isCanonicalUuid(category)) {
    invalid();
  }
  const search = parseSearch(queryValue(source, 'q'));
  return { q: search.q, name: search.name, categoryId: category === undefined || category === 'ALL' ? null : category, status: choice(queryValue(source, 'status'), MENU_STATUS_FILTERS), ...page(source) };
}

export interface ShopHistoryQuery {
  readonly limit: number;
  readonly offset: number;
}

export function parseShopHistoryQuery(query: unknown): ShopHistoryQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['limit', 'offset']);
  return page(source);
}

export interface StatusChangeBody {
  readonly expectedVersion: number;
  readonly reason: string;
}

/** disable / enable: the version the screen saw and a mandatory reason of 1-500 characters. */
export interface SetupRequestBody {
  readonly expectedVersion: number;
  /** Mandatory for request-info (the text the owner is shown); the server-side reason of clear-request. */
  readonly reason: string;
}

/** request-info / clear-request: the version the screen saw and a mandatory note of 1-500 characters (same rule as disable / enable). */
export function parseSetupRequestBody(body: unknown): SetupRequestBody {
  return parseStatusChangeBody(body);
}

export function parseStatusChangeBody(body: unknown): StatusChangeBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'reason']);
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    invalid();
  }
  return { expectedVersion: version, reason: parseReason(source.reason) };
}
