import { BadRequestException } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';
import { ShopRevenueCursor, ShopRevenuePeriod } from '../orders/shop-revenue-reader';

// GET /v1/shop/revenue/summary?from&to and GET /v1/shop/revenue/orders?from&to&limit&cursor (issue #391). Only these keys exist. A failure never echoes the value.
// Period rules: Vietnam calendar days, both ends inclusive, at most 92 days (the same bound as the Shipper income of #395).

export const SHOP_REVENUE_DEFAULT_LIMIT = 20;
export const SHOP_REVENUE_MAX_LIMIT = 50;
const REVENUE_MAX_DAYS = 92;
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function reject(): never {
  throw new BadRequestException();
}

function plain(query: unknown, allowed: readonly string[]): Record<string, unknown> {
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

/** A calendar date string that names a real day; refuses 2026-02-30 and the like. */
function dayMsOf(value: unknown): number {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return reject();
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    return reject();
  }
  return ms;
}

function parsePeriod(from: unknown, to: unknown): ShopRevenuePeriod & { readonly days: number } {
  const fromMs = dayMsOf(from);
  const toMs = dayMsOf(to);
  if (toMs < fromMs) {
    return reject();
  }
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days > REVENUE_MAX_DAYS) {
    return reject();
  }
  return { from: from as string, to: to as string, days };
}

export function parseRevenueSummaryQuery(query: unknown): { period: ShopRevenuePeriod; days: number } {
  const source = plain(query, ['from', 'to']);
  const parsed = parsePeriod(source.from, source.to);
  return { period: { from: parsed.from, to: parsed.to }, days: parsed.days };
}

export function parseRevenueOrdersQuery(query: unknown): { period: ShopRevenuePeriod; limit: number; cursor: ShopRevenueCursor | undefined } {
  const source = plain(query, ['from', 'to', 'limit', 'cursor']);
  const parsed = parsePeriod(source.from, source.to);
  let limit = SHOP_REVENUE_DEFAULT_LIMIT;
  if (source.limit !== undefined) {
    if (typeof source.limit !== 'string' || !/^[0-9]{1,3}$/.test(source.limit)) {
      return reject();
    }
    limit = Number(source.limit);
    if (limit < 1 || limit > SHOP_REVENUE_MAX_LIMIT) {
      return reject();
    }
  }
  let cursor: ShopRevenueCursor | undefined;
  if (source.cursor !== undefined) {
    if (typeof source.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(source.cursor)) {
      return reject();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(source.cursor, 'base64url').toString('utf8'));
    } catch {
      return reject();
    }
    const value = decoded as { at?: unknown; id?: unknown };
    if (typeof value.at !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(value.at) || !isCanonicalUuid(value.id)) {
      return reject();
    }
    cursor = { endedAt: value.at, orderId: value.id };
  }
  return { period: { from: parsed.from, to: parsed.to }, limit, cursor };
}

/** The opaque cursor a page hands to the next one. */
export function encodeRevenueCursor(cursor: ShopRevenueCursor): string {
  return Buffer.from(JSON.stringify({ at: cursor.endedAt, id: cursor.orderId }), 'utf8').toString('base64url');
}
