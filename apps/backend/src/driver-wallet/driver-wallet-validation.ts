import { BadRequestException } from '@nestjs/common';
import { exactObject } from '../auth/auth-validation';
import { AppError, TechnicalError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';
import { FEED_FILTERS, FeedCursor, FeedFilter } from '../wallet/wallet-read-repository';
import { WITHDRAWAL_STATES, WithdrawalCursor, WithdrawalState } from '../wallet/withdrawal-repository';
import { decodeCursor, encodeCursor, TOPUP_LIST_DEFAULT_LIMIT, TOPUP_LIST_MAX_LIMIT } from '../wallet-topup/topup-request-validation';

// Strict parsers of the Shipper wallet routes (M04-C). Every body is an exact object: no driver id, wallet id, user id, state, bank field or version can arrive
// from a client except the ones named here. Failures never echo the offending key or value (a plain 400).

function reject(): never {
  throw new BadRequestException();
}

export function safeJsonNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TechnicalError('internal', 'An amount is not a safe integer');
  }
  return number;
}

/** POST /v1/driver/wallet/withdrawals: exact {amount_vnd}, a safe integer >= 1 (the minimum is a database parameter, checked later). */
export function parseCreateWithdrawal(body: unknown): { readonly amountVnd: number } {
  const amount = exactObject(body, ['amount_vnd']).amount_vnd;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) {
    return reject();
  }
  return { amountVnd: amount };
}

/** POST /v1/driver/wallet/withdrawals/:id/cancel: exact {expected_version}. */
export function parseCancelWithdrawal(body: unknown): { readonly expectedVersion: number } {
  const version = exactObject(body, ['expected_version']).expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return reject();
  }
  return { expectedVersion: version };
}

/** A path parameter that is not a canonical UUID cannot name any withdrawal: it reads as not found, like an unknown one. */
export function parseWithdrawalIdParam(value: unknown): string {
  if (!isCanonicalUuid(value)) {
    throw new AppError('WITHDRAWAL_NOT_FOUND');
  }
  return value;
}

function plainQuery(query: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (query === undefined) {
    return {};
  }
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    return reject();
  }
  const source = query as Record<string, unknown>;
  if (!Object.keys(source).every((key) => allowed.includes(key))) {
    return reject();
  }
  return source;
}

function text(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : reject();
}

function limitOf(source: Record<string, unknown>): number {
  const limitText = text(source, 'limit');
  if (limitText === undefined) {
    return TOPUP_LIST_DEFAULT_LIMIT;
  }
  if (!/^[0-9]{1,3}$/.test(limitText) || Number(limitText) < 1 || Number(limitText) > TOPUP_LIST_MAX_LIMIT) {
    return reject();
  }
  return Number(limitText);
}

export interface WithdrawalListQuery {
  readonly state: WithdrawalState | undefined;
  readonly limit: number;
  readonly after: WithdrawalCursor | undefined;
}

/** GET withdrawals: only `status`, `limit` (1..50, default 20) and `cursor`, each at most once, as plain strings. */
export function parseWithdrawalListQuery(query: unknown): WithdrawalListQuery {
  const source = plainQuery(query, ['status', 'limit', 'cursor']);
  const status = text(source, 'status');
  if (status !== undefined && !WITHDRAWAL_STATES.includes(status as WithdrawalState)) {
    return reject();
  }
  const cursor = text(source, 'cursor');
  let after: WithdrawalCursor | undefined;
  if (cursor !== undefined) {
    const decoded = decodeCursor(cursor);
    after = { createdAtMs: decoded.createdAtMs, withdrawalId: decoded.requestId };
  }
  return { state: status as WithdrawalState | undefined, limit: limitOf(source), after };
}

export function encodeWithdrawalCursor(createdAtMs: number, withdrawalId: string): string {
  return encodeCursor(createdAtMs, withdrawalId);
}

export interface FeedQuery {
  readonly filter: FeedFilter;
  readonly limit: number;
  readonly after: FeedCursor | undefined;
}

const FEED_CURSOR = /^([0-9]{1,16})\.([LHETW]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function encodeFeedCursor(atMs: number, rowId: string): string {
  return Buffer.from(`${atMs}.${rowId}`, 'utf8').toString('base64url');
}

/** GET transactions: only `type` (all | topup | withdraw | commission | hold), `limit` (1..50, default 20) and `cursor`. */
export function parseFeedQuery(query: unknown): FeedQuery {
  const source = plainQuery(query, ['type', 'limit', 'cursor']);
  const type = text(source, 'type') ?? 'all';
  if (!FEED_FILTERS.includes(type as FeedFilter)) {
    return reject();
  }
  const cursor = text(source, 'cursor');
  let after: FeedCursor | undefined;
  if (cursor !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(cursor)) {
      return reject();
    }
    const match = FEED_CURSOR.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
    const atMs = match === null ? Number.NaN : Number(match[1]);
    if (match === null || !Number.isSafeInteger(atMs)) {
      return reject();
    }
    after = { atMs, rowId: match[2] as string };
  }
  return { filter: type as FeedFilter, limit: limitOf(source), after };
}

/** GET holds: only `status` (ACTIVE | CAPTURED | RELEASED). */
export function parseHoldsQuery(query: unknown): { readonly status: 'ACTIVE' | 'CAPTURED' | 'RELEASED' | undefined } {
  const source = plainQuery(query, ['status']);
  const status = text(source, 'status');
  if (status !== undefined && status !== 'ACTIVE' && status !== 'CAPTURED' && status !== 'RELEASED') {
    return reject();
  }
  return { status: status as 'ACTIVE' | 'CAPTURED' | 'RELEASED' | undefined };
}
