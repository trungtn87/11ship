import { BadRequestException } from '@nestjs/common';
import { exactObject } from '../auth/auth-validation';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { TOPUP_REQUEST_STATES, TopupListCursor, TopupRequestState } from '../wallet/topup-request-repository';

// Strict parsers of the Shipper top-up request routes (M04-B2.1). Every body is an exact object: no driver id, wallet id, user id, state
// or bank field can arrive from a client. Failures never echo the offending key or value (a plain 400).

function reject(): never {
  throw new BadRequestException();
}

export const TOPUP_LIST_DEFAULT_LIMIT = 20;
export const TOPUP_LIST_MAX_LIMIT = 50;

/** POST /v1/driver/wallet/topup-requests: exact {amount_vnd}, a safe integer >= 1 (the minimum is a database parameter, checked later). */
export function parseCreateTopupRequest(body: unknown): { readonly amountVnd: number } {
  const amount = exactObject(body, ['amount_vnd']).amount_vnd;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) {
    return reject();
  }
  return { amountVnd: amount };
}

/** POST /v1/driver/wallet/topup-requests/:id/cancel: exact {expected_version}. */
export function parseCancelTopupRequest(body: unknown): { readonly expectedVersion: number } {
  const version = exactObject(body, ['expected_version']).expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return reject();
  }
  return { expectedVersion: version };
}

/** A path parameter that is not a canonical UUID cannot name any request: it reads as not found, like an unknown one. */
export function parseRequestIdParam(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new AppError('TOPUP_REQUEST_NOT_FOUND');
  }
  return value;
}

export interface TopupListQuery {
  readonly state: TopupRequestState | undefined;
  readonly limit: number;
  readonly after: TopupListCursor | undefined;
}

const CURSOR_PATTERN = /^([0-9]{1,16})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function encodeCursor(createdAtMs: number, requestId: string): string {
  return Buffer.from(`${createdAtMs}.${requestId}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): TopupListCursor {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(raw)) {
    return reject();
  }
  const match = CURSOR_PATTERN.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  const createdAtMs = match === null ? Number.NaN : Number(match[1]);
  if (match === null || !Number.isSafeInteger(createdAtMs) || !isCanonicalUuid(match[2])) {
    return reject();
  }
  return { createdAtMs, requestId: match[2] as string };
}

/** GET list: only `status`, `limit` (1..50, default 20) and `cursor`, each at most once, as plain strings. */
export function parseTopupListQuery(query: unknown): TopupListQuery {
  if (query === undefined) {
    return { state: undefined, limit: TOPUP_LIST_DEFAULT_LIMIT, after: undefined };
  }
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const source = query as Record<string, unknown>;
  if (!Object.keys(source).every((key) => key === 'status' || key === 'limit' || key === 'cursor')) {
    return reject();
  }
  const text = (key: string): string | undefined => {
    const value = source[key];
    if (value === undefined) {
      return undefined;
    }
    return typeof value === 'string' ? value : reject();
  };
  const status = text('status');
  if (status !== undefined && !TOPUP_REQUEST_STATES.includes(status as TopupRequestState)) {
    return reject();
  }
  const limitText = text('limit');
  let limit = TOPUP_LIST_DEFAULT_LIMIT;
  if (limitText !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limitText)) {
      return reject();
    }
    limit = Number(limitText);
    if (limit < 1 || limit > TOPUP_LIST_MAX_LIMIT) {
      return reject();
    }
  }
  const cursor = text('cursor');
  return { state: status as TopupRequestState | undefined, limit, after: cursor === undefined ? undefined : decodeCursor(cursor) };
}
