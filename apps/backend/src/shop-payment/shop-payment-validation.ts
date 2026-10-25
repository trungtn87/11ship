import { BadRequestException } from '@nestjs/common';
import { exactObject } from '../auth/auth-validation';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { SHOP_PAYMENT_LIST_DEFAULT, SHOP_PAYMENT_LIST_MAX, SHOP_PAYMENT_MAX_AMOUNT_VND, SHOP_PAYMENT_PURPOSES, SHOP_PAYMENT_STATES, ShopPaymentPurpose, ShopPaymentState } from './shop-payment-constants';
import { ShopPaymentCursor } from './shop-payment-repository';

// Strict parsers of the shop's own payment request routes (#198). A body is an exact object: no shop id, user id, state, bank or time arrives from a client.
// Failures never echo the offending key or value (a plain 400); a path id that is not a canonical UUID reads as not found.

function reject(): never {
  throw new BadRequestException();
}

export interface CreatePaymentInput {
  readonly purpose: ShopPaymentPurpose;
  readonly amountVnd: number;
}

/** POST /v1/shop/me/payment-requests: exact {purpose, amount_vnd}. */
export function parseCreatePayment(body: unknown): CreatePaymentInput {
  const input = exactObject(body, ['purpose', 'amount_vnd']);
  const { purpose, amount_vnd: amount } = input;
  if (typeof purpose !== 'string' || !(SHOP_PAYMENT_PURPOSES as readonly string[]).includes(purpose) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 || amount > SHOP_PAYMENT_MAX_AMOUNT_VND) {
    return reject();
  }
  return { purpose: purpose as ShopPaymentPurpose, amountVnd: amount };
}

/** POST .../report-transfer carries nothing: the shop only says "I transferred". An absent body and `{}` are the same. */
export function parseEmptyBody(body: unknown): void {
  if (body === undefined || body === null) {
    return;
  }
  exactObject(body, []);
}

/** POST .../cancel: exact {expected_version}. */
export function parseCancelPayment(body: unknown): { readonly expectedVersion: number } {
  const version = exactObject(body, ['expected_version']).expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return reject();
  }
  return { expectedVersion: version };
}

export function parsePaymentId(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new AppError('SHOP_PAYMENT_NOT_FOUND');
  }
  return value;
}

const CURSOR_PATTERN = /^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function encodePaymentCursor(createdAtMs: number, requestId: string): string {
  return Buffer.from(`${String(createdAtMs)}.${requestId}`, 'utf8').toString('base64url');
}

export function decodePaymentCursor(raw: string, fail: () => never = reject): ShopPaymentCursor {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(raw)) {
    return fail();
  }
  const match = CURSOR_PATTERN.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  const createdAtMs = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(createdAtMs) || !isCanonicalUuid(match[2])) {
    return fail();
  }
  return { createdAtMs, requestId: match[2] as string };
}

export interface PaymentListQuery {
  readonly state: ShopPaymentState | undefined;
  readonly limit: number;
  readonly after: ShopPaymentCursor | undefined;
}

/** Only `status`, `limit` (1..50, default 20) and `cursor`, each at most once, as plain strings. `fail` lets the administration answer its own error code. */
export function parsePaymentListQuery(query: unknown, extra: readonly string[] = [], fail: () => never = reject): { list: PaymentListQuery; extras: Record<string, string> } {
  if (query === undefined || query === null) {
    return { list: { state: undefined, limit: SHOP_PAYMENT_LIST_DEFAULT, after: undefined }, extras: {} };
  }
  if (typeof query !== 'object' || Array.isArray(query)) {
    return fail();
  }
  const source = query as Record<string, unknown>;
  const allowed = ['status', 'limit', 'cursor', ...extra];
  if (!Object.keys(source).every((key) => allowed.includes(key))) {
    return fail();
  }
  const text = (key: string): string | undefined => {
    const value = source[key];
    return value === undefined ? undefined : typeof value === 'string' ? value : fail();
  };
  const status = text('status');
  if (status !== undefined && !(SHOP_PAYMENT_STATES as readonly string[]).includes(status)) {
    return fail();
  }
  const limitText = text('limit');
  let limit = SHOP_PAYMENT_LIST_DEFAULT;
  if (limitText !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > SHOP_PAYMENT_LIST_MAX) {
      return fail();
    }
    limit = Number(limitText);
  }
  const cursor = text('cursor');
  const extras: Record<string, string> = {};
  for (const key of extra) {
    const value = text(key);
    if (value !== undefined) {
      extras[key] = value;
    }
  }
  return { list: { state: status as ShopPaymentState | undefined, limit, after: cursor === undefined ? undefined : decodePaymentCursor(cursor, fail) }, extras };
}
