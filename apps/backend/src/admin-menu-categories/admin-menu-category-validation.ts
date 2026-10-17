import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { CATEGORY_ORDER_MAX, normalizeCategoryName } from '../menu/menu-category-name';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { CategoryStatus } from '../menu/menu-category-admin-repository';

// Strict parsers of the dish-group management routes (M02, Administration web). The actor comes from the session and the target
// from the path; the body never names an actor, a role or a version of anything but the group itself. Anything that is not exactly
// the documented shape is ADMIN_INPUT_INVALID. Nothing is repaired: a name is normalised (white space, composition) and checked, an
// order or a status that is not valid is refused.

export const LIST_DEFAULT_LIMIT = 10;
export const LIST_MAX_LIMIT = 50;
export const LIST_MAX_OFFSET = 100000;
export const SEARCH_MAX_CODEPOINTS = 80;

export type StatusFilter = CategoryStatus | null;

export interface CategoryListQuery {
  readonly pattern: string | null;
  /** The search text as typed, trimmed (echoed back so the screen keeps it). */
  readonly q: string | null;
  readonly status: StatusFilter;
  readonly limit: number;
  readonly offset: number;
}

export interface CreateCategoryBody {
  readonly name: string;
  /** null = the default: after the last group. */
  readonly sortOrder: number | null;
  readonly status: CategoryStatus;
}

export interface UpdateCategoryBody {
  readonly expectedVersion: number;
  readonly name: string;
  readonly sortOrder: number;
  readonly status: CategoryStatus;
}

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

function onlyKeys(source: Record<string, unknown>, required: readonly string[], optional: readonly string[]): void {
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

export function parseCategoryId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
}

function order(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > CATEGORY_ORDER_MAX) {
    invalid();
  }
  return value;
}

function status(value: unknown): CategoryStatus {
  if (value !== 'ACTIVE' && value !== 'INACTIVE') {
    invalid();
  }
  return value;
}

function name(value: unknown): string {
  const normalized = normalizeCategoryName(value);
  if (normalized === undefined) {
    invalid();
  }
  return normalized;
}

function queryValue(source: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(source, key)) {
    return undefined;
  }
  const value = source[key];
  // A repeated parameter arrives as an array: refused, never joined.
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

export function parseCategoryListQuery(query: unknown): CategoryListQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'status', 'limit', 'offset']);
  const rawQ = queryValue(source, 'q');
  let q: string | null = null;
  let pattern: string | null = null;
  if (rawQ !== undefined) {
    const trimmed = rawQ.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if ([...trimmed].length > SEARCH_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      invalid();
    }
    if (trimmed.length > 0) {
      q = trimmed;
      pattern = likeContains(foldVietnamese(trimmed));
    }
  }
  const rawStatus = queryValue(source, 'status');
  let filter: StatusFilter = null;
  if (rawStatus !== undefined && rawStatus !== 'ALL') {
    filter = status(rawStatus);
  }
  return {
    q,
    pattern,
    status: filter,
    limit: integerParam(queryValue(source, 'limit'), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT),
    offset: integerParam(queryValue(source, 'offset'), 0, 0, LIST_MAX_OFFSET),
  };
}

export function parseCreateBody(body: unknown): CreateCategoryBody {
  const source = plainObject(body);
  onlyKeys(source, ['name'], ['sort_order', 'status']);
  return {
    name: name(source.name),
    sortOrder: Object.hasOwn(source, 'sort_order') ? order(source.sort_order) : null,
    status: Object.hasOwn(source, 'status') ? status(source.status) : 'ACTIVE',
  };
}

export function parseUpdateBody(body: unknown): UpdateCategoryBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'name', 'sort_order', 'status'], []);
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    invalid();
  }
  return { expectedVersion: version, name: name(source.name), sortOrder: order(source.sort_order), status: status(source.status) };
}
