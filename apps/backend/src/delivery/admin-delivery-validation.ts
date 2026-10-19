import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the Administration web's delivery routes (M07.07). The actor comes from the session and the target from the path; a body never
// names an actor, a state or a status: there is NO "set status" field, each action has its own conditions in the service. Anything that is not
// exactly the documented shape is ADMIN_INPUT_INVALID.

export const ADMIN_DELIVERY_ACTIONS = ['record-custody', 'adjust-after-pickup', 'refer-m11', 'release-assignment'] as const;
export type AdminDeliveryAction = (typeof ADMIN_DELIVERY_ACTIONS)[number];

export const ADMIN_STATE_FILTERS = ['waiting_driver', 'accepted', 'location_confirmed', 'delivering', 'completed', 'failed', 'cancelled_by_merchant', 'search_stopped'] as const;

const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 50;
const LIST_MAX_OFFSET = 100_000;
const SEARCH_MAX_CODEPOINTS = 80;
const REASON_MAX_CODEPOINTS = 500;
/** Vietnam is UTC+7: a date typed by an administrator is a day of that clock. */
const VIETNAM_OFFSET_MS = 7 * 3_600_000;

export function invalid(): never {
  throw new AppError('ADMIN_INPUT_INVALID');
}

export function plainObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return invalid();
  }
  return value as Record<string, unknown>;
}

export function onlyKeys(source: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
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

export function parseAdminDeliveryId(value: unknown): string {
  return isCanonicalUuid(value) ? value : invalid();
}

export function parseAdminAction(value: unknown): AdminDeliveryAction {
  return typeof value === 'string' && (ADMIN_DELIVERY_ACTIONS as readonly string[]).includes(value) ? (value as AdminDeliveryAction) : invalid();
}

export function parseNoQuery(query: unknown): void {
  onlyKeys(plainObject(query), []);
}

export function queryText(source: Record<string, unknown>, key: string, max: number): string {
  if (!Object.hasOwn(source, key)) {
    return '';
  }
  const value = source[key];
  if (typeof value !== 'string') {
    return invalid();
  }
  const trimmed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if ([...trimmed].length > max || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
    return invalid();
  }
  return trimmed;
}

export function integerParam(source: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  if (!Object.hasOwn(source, key)) {
    return fallback;
  }
  const raw = source[key];
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,6})$/.test(raw)) {
    return invalid();
  }
  const parsed = Number(raw);
  return parsed >= min && parsed <= max ? parsed : invalid();
}

/** `YYYY-MM-DD` as the start of that day in Vietnam time (epoch ms); undefined when absent. */
export function dayStart(source: Record<string, unknown>, key: string): number | null {
  const text = queryText(source, key, 10);
  if (text === '') {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) {
    return invalid();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const at = Date.UTC(year, month - 1, day);
  const check = new Date(at);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return invalid();
  }
  return at - VIETNAM_OFFSET_MS;
}

export interface AdminDeliveryListQuery {
  readonly q: string;
  readonly state: (typeof ADMIN_STATE_FILTERS)[number] | null;
  readonly goods: 'OPEN' | 'CLOSED' | null;
  readonly fromMs: number | null;
  /** Exclusive: the start of the day AFTER the typed "to" date. */
  readonly toMs: number | null;
  readonly shop: string;
  readonly shipper: string;
  readonly limit: number;
  readonly offset: number;
}

export function parseAdminListQuery(query: unknown): AdminDeliveryListQuery {
  const source = plainObject(query);
  onlyKeys(source, [], ['q', 'state', 'goods', 'from', 'to', 'shop', 'shipper', 'limit', 'offset']);
  const state = queryText(source, 'state', 32);
  const goods = queryText(source, 'goods', 8);
  if (state !== '' && !(ADMIN_STATE_FILTERS as readonly string[]).includes(state)) {
    invalid();
  }
  if (goods !== '' && goods !== 'OPEN' && goods !== 'CLOSED') {
    invalid();
  }
  const to = dayStart(source, 'to');
  return {
    q: queryText(source, 'q', SEARCH_MAX_CODEPOINTS),
    state: state === '' ? null : (state as (typeof ADMIN_STATE_FILTERS)[number]),
    goods: goods === '' ? null : goods,
    fromMs: dayStart(source, 'from'),
    toMs: to === null ? null : to + 86_400_000,
    shop: queryText(source, 'shop', SEARCH_MAX_CODEPOINTS),
    shipper: queryText(source, 'shipper', SEARCH_MAX_CODEPOINTS),
    limit: integerParam(source, 'limit', LIST_DEFAULT_LIMIT, 1, LIST_MAX_LIMIT),
    offset: integerParam(source, 'offset', 0, 0, LIST_MAX_OFFSET),
  };
}

export interface AdminActionInput {
  readonly expectedVersion: number;
  readonly reason: string;
  readonly resolution: 'GOODS_RETURNED' | 'HANDLED_NO_RETURN' | null;
  readonly feeVnd: number | null;
  readonly recipientAddress: string | null;
}

function reason(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const trimmed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...trimmed].length;
  return length < 1 || length > REASON_MAX_CODEPOINTS || /[\p{Cc}\p{Cf}]/u.test(trimmed) ? invalid() : trimmed;
}

/** POST .../actions/:action. Every action needs a reason; only its own extra fields are accepted. */
export function parseAdminActionBody(action: AdminDeliveryAction, body: unknown): AdminActionInput {
  const source = plainObject(body);
  const extras = action === 'record-custody' ? ['resolution'] : action === 'adjust-after-pickup' ? ['fee_vnd', 'recipient_address_text'] : [];
  onlyKeys(source, ['expected_version', 'reason'], extras);
  const version = source.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    invalid();
  }
  let resolution: AdminActionInput['resolution'] = null;
  if (action === 'record-custody') {
    if (source.resolution !== 'GOODS_RETURNED' && source.resolution !== 'HANDLED_NO_RETURN') {
      invalid();
    }
    resolution = source.resolution as 'GOODS_RETURNED' | 'HANDLED_NO_RETURN';
  }
  let feeVnd: number | null = null;
  let recipientAddress: string | null = null;
  if (action === 'adjust-after-pickup') {
    if (Object.hasOwn(source, 'fee_vnd')) {
      const fee = source.fee_vnd;
      if (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000) {
        invalid();
      }
      feeVnd = fee as number;
    }
    if (Object.hasOwn(source, 'recipient_address_text')) {
      const address = source.recipient_address_text;
      const trimmed = typeof address === 'string' ? address.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
      if (trimmed === '' || [...trimmed].length > 300 || /[\p{Cc}\p{Cf}]/u.test(trimmed)) {
        invalid();
      }
      recipientAddress = trimmed;
    }
    if (feeVnd === null && recipientAddress === null) {
      invalid();
    }
  }
  return { expectedVersion: version, reason: reason(source.reason), resolution, feeVnd, recipientAddress };
}
