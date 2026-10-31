import { ApiClient, ApiResult, record, str } from './api.js';

// Điều hành › Bản đồ vận hành (issue #262, IV). Strict parser of GET /v1/admin/overview/map and the pure geometry that turns real WGS84 coordinates into an internal SVG
// sketch. No tiles, no third-party map, no route: what is drawn is the circles of the service areas, the pins of the active shops and the latest position of the Shippers
// who are Online, each only when the server sent it (the server withholds what the actor may not see). A position is LIVE or STALE; a Shipper with no usable position is counted, never drawn.

export interface MapZone {
  readonly id: string;
  readonly name: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly coverage: { readonly lat: number; readonly lng: number; readonly radiusM: number } | null;
}

export interface MapShop {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
}

export interface MapShipper {
  readonly id: string;
  readonly code: string | null;
  readonly name: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly ageSeconds: number;
  readonly freshness: 'LIVE' | 'STALE';
}

export interface OpsMap {
  readonly generatedAt: string;
  readonly zones: readonly MapZone[];
  /** null = the actor may not see shops. */
  readonly shops: readonly MapShop[] | null;
  readonly shopsWithoutPin: number | null;
  /** null = the actor may not see Shippers. */
  readonly shippers: readonly MapShipper[] | null;
  readonly shippersOnline: number | null;
  readonly shippersWithoutPosition: number | null;
  readonly truncated: boolean;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const whole = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const inRange = (lat: number, lng: number): boolean => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export function parseOpsMap(data: Record<string, unknown>): OpsMap | undefined {
  const generatedAt = str(data.generated_at);
  if (generatedAt === undefined || !Array.isArray(data.zones) || typeof data.truncated !== 'boolean') return undefined;
  const zones: MapZone[] = [];
  for (const raw of data.zones) {
    const z = record(raw);
    const id = str(z?.service_area_id);
    const name = str(z?.name);
    const status = z?.status === 'ACTIVE' || z?.status === 'INACTIVE' ? z.status : undefined;
    if (z === undefined || id === undefined || name === undefined || status === undefined) return undefined;
    let coverage: MapZone['coverage'] = null;
    if (z.coverage !== null) {
      const c = record(z.coverage);
      const lat = num(c?.lat);
      const lng = num(c?.lng);
      const radius = whole(c?.radius_m);
      if (lat === undefined || lng === undefined || radius === undefined || !inRange(lat, lng)) return undefined;
      coverage = { lat, lng, radiusM: radius };
    }
    zones.push({ id, name, status, coverage });
  }
  let shops: MapShop[] | null = null;
  if (data.shops !== null) {
    if (!Array.isArray(data.shops)) return undefined;
    shops = [];
    for (const raw of data.shops) {
      const s = record(raw);
      const id = str(s?.shop_id);
      const name = str(s?.name);
      const lat = num(s?.lat);
      const lng = num(s?.lng);
      if (id === undefined || name === undefined || lat === undefined || lng === undefined || !inRange(lat, lng)) return undefined;
      shops.push({ id, name, lat, lng });
    }
  }
  let shippers: MapShipper[] | null = null;
  if (data.shippers !== null) {
    if (!Array.isArray(data.shippers)) return undefined;
    shippers = [];
    for (const raw of data.shippers) {
      const s = record(raw);
      const id = str(s?.driver_id);
      const lat = num(s?.lat);
      const lng = num(s?.lng);
      const age = whole(s?.age_seconds);
      const freshness = s?.freshness === 'LIVE' || s?.freshness === 'STALE' ? s.freshness : undefined;
      if (id === undefined || lat === undefined || lng === undefined || age === undefined || freshness === undefined || !inRange(lat, lng)) return undefined;
      shippers.push({ id, code: typeof s?.code === 'string' ? s.code : null, name: typeof s?.name === 'string' ? s.name : null, lat, lng, ageSeconds: age, freshness });
    }
  }
  const counts = [data.shops_without_pin, data.shippers_online, data.shippers_without_position];
  if (counts.some((c) => c !== null && whole(c) === undefined)) return undefined;
  return {
    generatedAt,
    zones,
    shops,
    shopsWithoutPin: data.shops_without_pin === null ? null : (data.shops_without_pin as number),
    shippers,
    shippersOnline: data.shippers_online === null ? null : (data.shippers_online as number),
    shippersWithoutPosition: data.shippers_without_position === null ? null : (data.shippers_without_position as number),
    truncated: data.truncated,
  };
}

export class OpsMapApi extends ApiClient {
  read(): Promise<ApiResult<OpsMap>> {
    return this.call({ method: 'GET', path: '/admin/overview/map' }, parseOpsMap);
  }
}

// ---- geometry ----------------------------------------------------------------------------------------------------------------

export const SKETCH_SIZE = 320;
const PADDING = 16;
const METRES_PER_DEGREE_LAT = 111_194.9266;

export interface Sketch {
  readonly project: (lat: number, lng: number) => { readonly x: number; readonly y: number };
  /** Metres to sketch units (the same factor on both axes: a circle stays a circle). */
  readonly scale: number;
  /** Metres covered by the sketch's width, for the scale label. */
  readonly widthMetres: number;
}

/**
 * Equirectangular fit of every point and every circle into a SIZE x SIZE box: longitude is shrunk by cos(latitude of the centre), north is up, the factor is the same on both
 * axes. It is a sketch for telling "who is where" apart, not a map: it never claims to show roads or distances between two points.
 */
export function fitSketch(points: readonly { readonly lat: number; readonly lng: number }[], circles: readonly { readonly lat: number; readonly lng: number; readonly radiusM: number }[], size = SKETCH_SIZE): Sketch | undefined {
  const centre = points[0] ?? circles[0];
  if (centre === undefined) return undefined;
  const k = Math.cos((centre.lat * Math.PI) / 180);
  const mx = (lng: number): number => lng * k * METRES_PER_DEGREE_LAT;
  const my = (lat: number): number => lat * METRES_PER_DEGREE_LAT;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    xs.push(mx(p.lng));
    ys.push(my(p.lat));
  }
  for (const c of circles) {
    xs.push(mx(c.lng) - c.radiusM, mx(c.lng) + c.radiusM);
    ys.push(my(c.lat) - c.radiusM, my(c.lat) + c.radiusM);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 200);
  const scale = (size - 2 * PADDING) / span;
  const offX = PADDING + ((size - 2 * PADDING) - (maxX - minX) * scale) / 2;
  const offY = PADDING + ((size - 2 * PADDING) - (maxY - minY) * scale) / 2;
  return {
    scale,
    widthMetres: Math.round(size / scale),
    project: (lat, lng) => ({ x: offX + (mx(lng) - minX) * scale, y: size - (offY + (my(lat) - minY) * scale) }),
  };
}
