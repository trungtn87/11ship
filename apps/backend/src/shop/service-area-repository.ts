import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-errors';
import { TransactionContext } from '../transaction/transaction-context';
import { ServiceAreaStatus } from './shop-types';

export interface ServiceAreaRow {
  readonly serviceAreaId: string;
  readonly status: ServiceAreaStatus;
  /** The configured circle, or undefined while the area has no geometry ("Chưa cấu hình GPS"). */
  readonly coverage?: { readonly latitude: number; readonly longitude: number; readonly radiusMeters: number };
}

/** What a client may choose from: an ACTIVE area's identifier and its display name, nothing else (no code, no geometry). */
export interface ActiveServiceAreaRow {
  readonly serviceAreaId: string;
  readonly name: string;
}

export interface ServiceAreaCoverage extends ActiveServiceAreaRow {
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

/**
 * Where a pickup pin stands against the circle the server has configured for an area (issue #252). UNCONFIGURED is NOT "verified": the area has no
 * geometry, so nothing can be proved either way. Writers keep accepting the pin for such an area (the legacy shops of an area nobody configured yet stay
 * intact) and the Admin screen shows the missing geometry; no radius is ever invented here.
 */
export type PinPlacement = 'INSIDE' | 'OUTSIDE' | 'UNCONFIGURED';

const EARTH_RADIUS_M = 6371008.8;

/** Great-circle (haversine) distance in metres: the one formula of containment, shared by the resolver and the pin guard. */
export function distanceMeters(latA: number, lngA: number, latB: number, lngB: number): number {
  const radians = Math.PI / 180;
  const sinLat = Math.sin((latA - latB) * radians / 2);
  const sinLng = Math.sin((lngA - lngB) * radians / 2);
  const haversine = sinLat ** 2 + Math.cos(latA * radians) * Math.cos(latB * radians) * sinLng ** 2;
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

export function placeOfPin(area: Pick<ServiceAreaRow, 'coverage'>, latitude: number, longitude: number): PinPlacement {
  if (area.coverage === undefined) return 'UNCONFIGURED';
  return distanceMeters(latitude, longitude, area.coverage.latitude, area.coverage.longitude) <= area.coverage.radiusMeters ? 'INSIDE' : 'OUTSIDE';
}

/** The write guard of issue #252: a pin the server can prove to lie outside the chosen area is refused (never moved to another area). An area without geometry cannot prove it. */
export function assertPinInArea(area: ServiceAreaRow, latitude: number | null, longitude: number | null): void {
  if (latitude === null || longitude === null) return;
  if (placeOfPin(area, latitude, longitude) === 'OUTSIDE') {
    throw new AppError('PICKUP_OUTSIDE_SERVICE_AREA');
  }
}

/**
 * SQL twin of `placeOfPin`, for the public reads: true when the area has no geometry (not provable, legacy-compatible), the shop has no pin yet (the
 * pickup-point rule answers that one) or the pin lies inside the circle. Same sphere radius and formula, so a list never disagrees with a save.
 */
export function pinInAreaSql(shopAlias: string, areaAlias: string): string {
  return `(${areaAlias}.coverage_radius_m IS NULL OR ${shopAlias}.pickup_lat IS NULL OR ${shopAlias}.pickup_lng IS NULL
     OR ${EARTH_RADIUS_M} * 2 * asin(sqrt(least(1.0, greatest(0.0,
          power(sin(radians(${shopAlias}.pickup_lat - ${areaAlias}.coverage_lat) / 2), 2)
          + cos(radians(${shopAlias}.pickup_lat)) * cos(radians(${areaAlias}.coverage_lat)) * power(sin(radians(${shopAlias}.pickup_lng - ${areaAlias}.coverage_lng) / 2), 2))))) <= ${areaAlias}.coverage_radius_m)`;
}

/** Exact containment of configured circles; overlaps use the smallest circle then stable id. */
export function containingServiceArea(rows: readonly ServiceAreaCoverage[], latitude: number, longitude: number): ActiveServiceAreaRow | undefined {
  return [...rows].sort((a, b) => a.radiusMeters - b.radiusMeters || a.serviceAreaId.localeCompare(b.serviceAreaId))
    .find((row) => distanceMeters(latitude, longitude, row.latitude, row.longitude) <= row.radiusMeters);
}

/** SQL for app.service_areas read by the shop flows. The Administration writes live in AdminServiceAreaRepository (SYSTEM only). */
@Injectable()
export class ServiceAreaRepository {
  async resolve(context: TransactionContext, latitude: number, longitude: number): Promise<ActiveServiceAreaRow | undefined> {
    const result = await context.query<{ service_area_id: string; name: string; coverage_lat: number; coverage_lng: number; coverage_radius_m: number }>(
      `SELECT service_area_id, name, coverage_lat, coverage_lng, coverage_radius_m
         FROM app.service_areas
        WHERE status = 'ACTIVE' AND coverage_radius_m IS NOT NULL`,
    );
    return containingServiceArea(result.rows.map((row) => ({
      serviceAreaId: row.service_area_id, name: row.name,
      latitude: row.coverage_lat, longitude: row.coverage_lng, radiusMeters: row.coverage_radius_m,
    })), latitude, longitude);
  }

  /**
   * Locks the area row FOR SHARE and returns its CURRENT state (read after the lock, so an UPDATE that
   * committed while this call waited is seen). FOR SHARE conflicts with an UPDATE of the row, so an operator
   * cannot deactivate the area (or move its circle) between this check and the commit of the caller's transaction,
   * while any number of shops can hold the same area locked at once (they do not serialize on a popular area).
   * Returns undefined when no such area exists. Whether the status is acceptable is the caller's rule.
   */
  async lockShared(context: TransactionContext, serviceAreaId: string): Promise<ServiceAreaRow | undefined> {
    const result = await context.query<{ service_area_id: string; status: ServiceAreaStatus; coverage_lat: number | null; coverage_lng: number | null; coverage_radius_m: number | null }>(
      `SELECT service_area_id, status, coverage_lat, coverage_lng, coverage_radius_m
         FROM app.service_areas
        WHERE service_area_id = $1::uuid
          FOR SHARE`,
      [serviceAreaId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const configured = row.coverage_lat !== null && row.coverage_lng !== null && row.coverage_radius_m !== null;
    return {
      serviceAreaId: row.service_area_id,
      status: row.status,
      ...(configured ? { coverage: { latitude: Number(row.coverage_lat), longitude: Number(row.coverage_lng), radiusMeters: Number(row.coverage_radius_m) } } : {}),
    };
  }

  /** Every area, ACTIVE or not, for the administration filter (a shop may sit in an area that was switched off). Read only. */
  async listAll(context: TransactionContext): Promise<{ serviceAreaId: string; name: string; status: ServiceAreaStatus }[]> {
    const result = await context.query<{ service_area_id: string; name: string; status: ServiceAreaStatus }>(
      `SELECT service_area_id, name, status FROM app.service_areas ORDER BY name ASC, service_area_id ASC`,
    );
    return result.rows.map((row) => ({ serviceAreaId: row.service_area_id, name: row.name, status: row.status }));
  }

  /**
   * The ACTIVE areas a shop can pick during onboarding, by name and then by identifier so that the order is the same on
   * every call. A plain read: no lock (a later deactivation is caught by the FOR SHARE re-check of save and complete),
   * no write, and no row of any other table.
   */
  async listActive(context: TransactionContext): Promise<ActiveServiceAreaRow[]> {
    const result = await context.query<{ service_area_id: string; name: string }>(
      `SELECT service_area_id, name
         FROM app.service_areas
        WHERE status = 'ACTIVE'
        ORDER BY name ASC, service_area_id ASC`,
    );
    return result.rows.map((row) => ({ serviceAreaId: row.service_area_id, name: row.name }));
  }
}
