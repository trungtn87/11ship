import { ApiClient, ApiResult, record, str } from './api.js';

// Hệ thống -> Vùng hoạt động (issue #253). Strict parsers of /v1/admin/service-areas: an answer that does not have the documented shape is "network"
// (never half-shown). SYSTEM writes, every administrator reads; the server decides again on every call.

export interface ZoneCoverage {
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number;
}

export interface Zone {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
  /** null = "Chưa cấu hình GPS". */
  readonly coverage: ZoneCoverage | null;
  readonly shopsTotal: number;
  readonly shopsPublic: number;
  readonly pinsOutside: number;
  readonly updatedAt: string;
  /** Only the detail answer carries them. */
  readonly ordersOpen: number | null;
  readonly activeDeliveries: number | null;
}

export interface ZoneImpact {
  readonly shopsTotal: number;
  readonly shopsPublic: number;
  readonly pinsOutsideCurrent: number;
  readonly pinsOutsideProposed: number;
  readonly publicShopsNewlyOutside: number;
  readonly ordersOpen: number;
  readonly activeDeliveries: number;
  readonly requiresConfirmation: boolean;
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);

export function parseZone(data: Record<string, unknown>): Zone | undefined {
  const id = str(data.service_area_id);
  const code = str(data.code);
  const name = str(data.name);
  const status = data.status === 'ACTIVE' || data.status === 'INACTIVE' ? data.status : undefined;
  const version = count(data.version);
  const shopsTotal = count(data.shops_total);
  const shopsPublic = count(data.shops_public);
  const pinsOutside = count(data.pins_outside);
  const updatedAt = str(data.updated_at);
  if (id === undefined || code === undefined || name === undefined || status === undefined || version === undefined || shopsTotal === undefined || shopsPublic === undefined || pinsOutside === undefined || updatedAt === undefined) {
    return undefined;
  }
  let coverage: ZoneCoverage | null = null;
  if (data.coverage !== null) {
    const c = record(data.coverage);
    if (c === undefined || typeof c.lat !== 'number' || typeof c.lng !== 'number' || count(c.radius_m) === undefined) return undefined;
    coverage = { lat: c.lat, lng: c.lng, radiusM: c.radius_m as number };
  }
  return { id, code, name, status, version, coverage, shopsTotal, shopsPublic, pinsOutside, updatedAt, ordersOpen: count(data.orders_open) ?? null, activeDeliveries: count(data.active_deliveries) ?? null };
}

export function parseZoneList(data: Record<string, unknown>): Zone[] | undefined {
  if (!Array.isArray(data.items)) return undefined;
  const zones = data.items.map((item) => parseZone(record(item) ?? {}));
  return zones.every((zone): zone is Zone => zone !== undefined) ? zones : undefined;
}

export function parseImpact(data: Record<string, unknown>): ZoneImpact | undefined {
  const values = [data.shops_total, data.shops_public, data.pins_outside_current, data.pins_outside_proposed, data.public_shops_newly_outside, data.orders_open, data.active_deliveries].map(count);
  if (values.some((value) => value === undefined) || typeof data.requires_confirmation !== 'boolean') return undefined;
  const [shopsTotal, shopsPublic, pinsOutsideCurrent, pinsOutsideProposed, publicShopsNewlyOutside, ordersOpen, activeDeliveries] = values as number[];
  return { shopsTotal, shopsPublic, pinsOutsideCurrent, pinsOutsideProposed, publicShopsNewlyOutside, ordersOpen, activeDeliveries, requiresConfirmation: data.requires_confirmation };
}

export interface CoverageInput {
  readonly lat: number;
  readonly lng: number;
  readonly radius_m: number;
}

/** Client-side check with the SAME bounds as the server and the database (WGS84, radius 1..100000 m); the server refuses anything else anyway. */
export function validateCoverage(lat: number, lng: number, radiusM: number): string | undefined {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Vĩ độ phải từ -90 đến 90.';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Kinh độ phải từ -180 đến 180.';
  if (!Number.isSafeInteger(radiusM) || radiusM < 1 || radiusM > 100000) return 'Bán kính phải là số nguyên từ 1 đến 100000 mét.';
  return undefined;
}

const BASE = '/admin/service-areas';

export class ZonesApi extends ApiClient {
  list(): Promise<ApiResult<Zone[]>> {
    return this.call({ method: 'GET', path: BASE }, parseZoneList);
  }

  detail(id: string): Promise<ApiResult<Zone>> {
    return this.call({ method: 'GET', path: `${BASE}/${id}` }, parseZone);
  }

  impact(id: string, change: { status?: 'ACTIVE' | 'INACTIVE'; coverage?: CoverageInput }): Promise<ApiResult<ZoneImpact>> {
    const query = new URLSearchParams();
    if (change.status !== undefined) query.set('status', change.status);
    if (change.coverage !== undefined) {
      query.set('lat', String(change.coverage.lat));
      query.set('lng', String(change.coverage.lng));
      query.set('radius_m', String(change.coverage.radius_m));
    }
    const suffix = query.toString();
    return this.call({ method: 'GET', path: `${BASE}/${id}/impact${suffix === '' ? '' : `?${suffix}`}` }, parseImpact);
  }

  create(csrf: string, key: string, body: { code: string; name: string; status: 'ACTIVE' | 'INACTIVE'; coverage?: CoverageInput; reason: string }): Promise<ApiResult<Zone>> {
    return this.call({ method: 'POST', path: BASE, csrf, idempotencyKey: key, body }, parseZone, [201]);
  }

  update(csrf: string, key: string, id: string, body: { expected_version: number; name: string; coverage?: CoverageInput; reason: string; confirm_impact?: boolean }): Promise<ApiResult<Zone>> {
    return this.call({ method: 'POST', path: `${BASE}/${id}`, csrf, idempotencyKey: key, body }, parseZone);
  }

  setStatus(csrf: string, key: string, id: string, body: { expected_version: number; status: 'ACTIVE' | 'INACTIVE'; reason: string; confirm_impact?: boolean }): Promise<ApiResult<Zone>> {
    return this.call({ method: 'POST', path: `${BASE}/${id}/status`, csrf, idempotencyKey: key, body }, parseZone);
  }
}
