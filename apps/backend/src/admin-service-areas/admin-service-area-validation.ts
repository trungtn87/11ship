import { parseReason } from '../admin-access/admin-access-validation';
import { AppError } from '../common/app-errors';
import { isCanonicalUuid } from '../shared/identifiers';

// Strict parsers of the Administration "Vùng hoạt động" routes (issue #253). The bounds are the database's own CHECKs; nothing is defaulted.

const invalid = (): never => {
  throw new AppError('ADMIN_INPUT_INVALID');
};

export interface Coverage {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

export const AREA_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

function plain(body: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid();
  const proto = Object.getPrototypeOf(body) as unknown;
  if (proto !== Object.prototype && proto !== null) return invalid();
  const source = body as Record<string, unknown>;
  if (Object.keys(source).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(source, key))) return invalid();
  return source;
}

export function parseAreaId(value: unknown): string {
  return typeof value === 'string' && isCanonicalUuid(value) ? value : invalid();
}

function parseName(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  const text = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return text.length < 1 || [...text].length > 120 || /[\p{Cc}\p{Cf}]/u.test(text) ? invalid() : text;
}

function parseVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : invalid();
}

export function parseCoverage(value: unknown): Coverage {
  const source = plain(value, ['lat', 'lng', 'radius_m'], ['lat', 'lng', 'radius_m']);
  const { lat, lng, radius_m: radius } = source;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return invalid();
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return invalid();
  if (typeof radius !== 'number' || !Number.isSafeInteger(radius) || radius < 1 || radius > 100000) return invalid();
  return { latitude: lat, longitude: lng, radiusMeters: radius };
}

export type AreaStatusValue = 'ACTIVE' | 'INACTIVE';
const parseStatus = (value: unknown): AreaStatusValue => (value === 'ACTIVE' || value === 'INACTIVE' ? value : invalid());
const parseConfirm = (source: Record<string, unknown>): boolean => (Object.hasOwn(source, 'confirm_impact') ? (source.confirm_impact === true ? true : source.confirm_impact === false ? false : invalid()) : false);

export interface CreateAreaBody { readonly code: string; readonly name: string; readonly status: AreaStatusValue; readonly coverage: Coverage | null; readonly reason: string }
export function parseCreateAreaBody(body: unknown): CreateAreaBody {
  const source = plain(body, ['code', 'name', 'status', 'coverage', 'reason'], ['code', 'name', 'reason']);
  const code = source.code;
  if (typeof code !== 'string' || !AREA_CODE_PATTERN.test(code)) return invalid();
  return {
    code,
    name: parseName(source.name),
    status: Object.hasOwn(source, 'status') ? parseStatus(source.status) : 'INACTIVE',
    coverage: Object.hasOwn(source, 'coverage') && source.coverage !== null ? parseCoverage(source.coverage) : null,
    reason: parseReason(source.reason),
  };
}

/** `coverage` absent keeps the circle as it is; present replaces all three values. A circle is never cleared (a pin could then no longer be checked). */
export interface UpdateAreaBody { readonly expectedVersion: number; readonly name: string; readonly coverage: Coverage | undefined; readonly reason: string; readonly confirmImpact: boolean }
export function parseUpdateAreaBody(body: unknown): UpdateAreaBody {
  const source = plain(body, ['expected_version', 'name', 'coverage', 'reason', 'confirm_impact'], ['expected_version', 'name', 'reason']);
  return {
    expectedVersion: parseVersion(source.expected_version),
    name: parseName(source.name),
    coverage: Object.hasOwn(source, 'coverage') ? parseCoverage(source.coverage) : undefined,
    reason: parseReason(source.reason),
    confirmImpact: parseConfirm(source),
  };
}

export interface StatusAreaBody { readonly expectedVersion: number; readonly status: AreaStatusValue; readonly reason: string; readonly confirmImpact: boolean }
export function parseStatusAreaBody(body: unknown): StatusAreaBody {
  const source = plain(body, ['expected_version', 'status', 'reason', 'confirm_impact'], ['expected_version', 'status', 'reason']);
  return { expectedVersion: parseVersion(source.expected_version), status: parseStatus(source.status), reason: parseReason(source.reason), confirmImpact: parseConfirm(source) };
}

export interface ImpactQuery { readonly status: AreaStatusValue | null; readonly coverage: Coverage | null }
/** GET .../impact?status=INACTIVE or ?lat=&lng=&radius_m= : what a change WOULD do; nothing is written. */
export function parseImpactQuery(query: unknown): ImpactQuery {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) return invalid();
  const source = query as Record<string, unknown>;
  if (Object.keys(source).some((key) => !['status', 'lat', 'lng', 'radius_m'].includes(key))) return invalid();
  const geo = ['lat', 'lng', 'radius_m'].filter((key) => Object.hasOwn(source, key));
  if (geo.length !== 0 && geo.length !== 3) return invalid();
  const num = (value: unknown): number => (typeof value === 'string' && /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : invalid());
  return {
    status: Object.hasOwn(source, 'status') ? parseStatus(source.status) : null,
    coverage: geo.length === 0 ? null : parseCoverage({ lat: num(source.lat), lng: num(source.lng), radius_m: num(source.radius_m) }),
  };
}
