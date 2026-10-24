import { AppError } from '../common/app-errors';
import { parseReason } from '../admin-access/admin-access-validation';
import { SHIPPER_LIST_STATUSES, ShipperListFilter, ShipperListStatus } from '../driver/driver-admin-query-repository';
import { DRIVER_TYPES, DriverType } from '../driver/driver-types';
import { foldVietnamese, likeContains } from '../shared/fold-vietnamese';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the Shipper management routes of the administration web (M03). The actor comes from the session and the target from
// the path; a body never names an actor, a role or a status. Anything that is not exactly the documented shape is ADMIN_INPUT_INVALID.

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 50;
export const LIST_MAX_OFFSET = 100000;
export const SEARCH_MAX_CODEPOINTS = 80;
export const REASON_MAX_CODEPOINTS = 500;

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

export function parseDriverId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    invalid();
  }
  return value;
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

export interface ShipperListQuery {
  readonly filter: ShipperListFilter;
  /** The search text as typed, trimmed (echoed back so the screen keeps it). */
  readonly q: string | null;
  readonly limit: number;
  readonly offset: number;
}

export function parseShipperListQuery(query: unknown): ShipperListQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'status', 'limit', 'offset']);
  const rawQ = queryValue(source, 'q');
  let q: string | null = null;
  let pattern: ShipperListFilter['pattern'] = null;
  if (rawQ !== undefined) {
    const trimmed = rawQ.normalize('NFC').replace(/\s+/gu, ' ').trim();
    if ([...trimmed].length > SEARCH_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
      invalid();
    }
    if (trimmed.length > 0) {
      q = trimmed;
      // A phone-like text also searches the number: digits only, without the leading 0 / +, so "0912..." finds "+84912...".
      const digits = /^[+0-9][0-9 .+-]*$/u.test(trimmed) ? trimmed.replace(/\D/gu, '').replace(/^0+/u, '') : '';
      pattern = { name: likeContains(foldVietnamese(trimmed)), code: likeContains(trimmed), phone: digits.length >= 3 ? likeContains(digits) : null };
    }
  }
  const rawStatus = queryValue(source, 'status');
  let status: ShipperListStatus | null = null;
  if (rawStatus !== undefined && rawStatus !== 'ALL') {
    if (!(SHIPPER_LIST_STATUSES as readonly string[]).includes(rawStatus)) {
      invalid();
    }
    status = rawStatus as ShipperListStatus;
  }
  return {
    q,
    filter: { pattern, status },
    limit: integerParam(queryValue(source, 'limit'), LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT),
    offset: integerParam(queryValue(source, 'offset'), 0, 0, LIST_MAX_OFFSET),
  };
}

export function parseNoQuery(query: unknown): void {
  onlyKeys(plainObject(query), []);
}

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid();
  }
  return value;
}

function reason(value: unknown): string {
  if (typeof value !== 'string') {
    invalid();
  }
  const trimmed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...trimmed].length;
  if (length < 1 || length > REASON_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    invalid();
  }
  return trimmed;
}

/** Commands that only name the version they were decided on. */
export interface VersionBody {
  readonly expectedVersion: number;
}
export function parseVersionBody(body: unknown): VersionBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version']);
  return { expectedVersion: expectedVersion(source.expected_version) };
}

/** Commands that need a reason (reject, lock, bank reject, closure reject). */
export interface ReasonBody extends VersionBody {
  readonly reason: string;
}
export function parseReasonBody(body: unknown): ReasonBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'reason']);
  return { expectedVersion: expectedVersion(source.expected_version), reason: reason(source.reason) };
}

export interface ClassifyBody extends VersionBody {
  readonly driverType: DriverType;
}
export function parseClassifyBody(body: unknown): ClassifyBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'driver_type']);
  if (typeof source.driver_type !== 'string' || !(DRIVER_TYPES as readonly string[]).includes(source.driver_type)) {
    invalid();
  }
  return { expectedVersion: expectedVersion(source.expected_version), driverType: source.driver_type as DriverType };
}

export interface WalletParametersBody {
  readonly expectedVersion: number;
  readonly topupMinVnd: number;
  readonly withdrawMinVnd: number;
  /** M12-D: why the parameter changes, written to the audit row. Optional so the older screen keeps working. */
  readonly reason: string | null;
}

/** Whole VND, positive, at most one billion: anything else (a decimal, a string, zero, a negative, an extra key) is refused. */
export function parseWalletParametersBody(body: unknown, max: number): WalletParametersBody {
  const source = plainObject(body);
  onlyKeys(source, ['expected_version', 'topup_min_vnd', 'withdraw_min_vnd'], ['reason']);
  const amount = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
      invalid();
    }
    return value;
  };
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    invalid();
  }
  return { expectedVersion: version, topupMinVnd: amount(source.topup_min_vnd), withdrawMinVnd: amount(source.withdraw_min_vnd), reason: Object.hasOwn(source, 'reason') ? parseReason(source.reason) : null };
}
