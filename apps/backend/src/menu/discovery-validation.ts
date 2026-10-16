import { BadRequestException } from '@nestjs/common';
import { isWellFormed } from '../auth/auth-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import { foldVietnamese } from '../shared/fold-vietnamese';

// Strict query parsers of the public discovery routes (M02, docs/current/M02-discovery-UI-LOCKED-20261016.md). Unknown parameters,
// repeated parameters and malformed values are the generic 400; nothing is echoed.

export const DISCOVERY_DEFAULT_LIMIT = 30;
export const DISCOVERY_MAX_LIMIT = 50;
export const DISCOVERY_MAX_OFFSET = 10_000;
export const SEARCH_MAX_LENGTH = 100;

export interface DiscoveryQuery {
  readonly areaId: string;
  readonly categoryId: string | null;
  readonly openOnly: boolean;
  /** Folded (see foldVietnamese), '' when there is no term. */
  readonly term: string;
  readonly limit: number;
  readonly offset: number;
}

function single(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException();
  }
  return value;
}

export function parseDiscoveryQuery(query: unknown): DiscoveryQuery {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new BadRequestException();
  }
  const record = query as Record<string, unknown>;
  const allowed = new Set(['area_id', 'category_id', 'open_only', 'q', 'limit', 'offset']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new BadRequestException();
    }
  }
  const areaId = single(record.area_id);
  if (areaId === undefined || !isCanonicalUuid(areaId)) {
    throw new BadRequestException();
  }
  const categoryRaw = single(record.category_id);
  if (categoryRaw !== undefined && !isCanonicalUuid(categoryRaw)) {
    throw new BadRequestException();
  }
  const openRaw = single(record.open_only);
  if (openRaw !== undefined && openRaw !== 'true' && openRaw !== 'false') {
    throw new BadRequestException();
  }
  const text = single(record.q) ?? '';
  if (!isWellFormed(text) || text.includes('\u0000') || [...text].length > SEARCH_MAX_LENGTH) {
    throw new BadRequestException();
  }
  const limit = integer(single(record.limit), DISCOVERY_DEFAULT_LIMIT, 1, DISCOVERY_MAX_LIMIT);
  const offset = integer(single(record.offset), 0, 0, DISCOVERY_MAX_OFFSET);
  return { areaId, categoryId: categoryRaw ?? null, openOnly: openRaw === 'true', term: foldVietnamese(text), limit, offset };
}

function integer(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^\d{1,6}$/.test(raw)) {
    throw new BadRequestException();
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new BadRequestException();
  }
  return value;
}
