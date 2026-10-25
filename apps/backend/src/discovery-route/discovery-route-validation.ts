import { BadRequestException } from '@nestjs/common';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parser of POST /v1/discovery/route-distances (issue #190, section 6). Unknown keys, a missing key, a non-finite number, a point outside the
// globe, a repeated or malformed shop id and more than MAX_SHOPS ids are the generic 400; nothing is echoed. The customer's position is the only personal
// value: it is rounded to ~11 m here, used for the route and the cache key, and never stored or logged.

export const ROUTE_DISTANCES_MAX_SHOPS = 20;
export const ORIGIN_DECIMALS = 4;

export interface RouteDistancesInput {
  readonly origin: { readonly lat: number; readonly lng: number };
  readonly shopIds: readonly string[];
}

function plain(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException();
  }
  return value as Record<string, unknown>;
}

function onlyKeys(source: Record<string, unknown>, keys: readonly string[]): void {
  const found = Object.keys(source);
  if (found.length !== keys.length || !keys.every((key) => Object.hasOwn(source, key))) {
    throw new BadRequestException();
  }
}

function coordinate(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new BadRequestException();
  }
  return Number(value.toFixed(ORIGIN_DECIMALS));
}

export function parseRouteDistancesBody(body: unknown): RouteDistancesInput {
  const source = plain(body);
  onlyKeys(source, ['origin', 'shop_ids']);
  const origin = plain(source.origin);
  onlyKeys(origin, ['lat', 'lng']);
  const ids = source.shop_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > ROUTE_DISTANCES_MAX_SHOPS || !ids.every((id) => isCanonicalUuid(id)) || new Set(ids).size !== ids.length) {
    throw new BadRequestException();
  }
  return { origin: { lat: coordinate(origin.lat, 90), lng: coordinate(origin.lng, 180) }, shopIds: ids as string[] };
}
