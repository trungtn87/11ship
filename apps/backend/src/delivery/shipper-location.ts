import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { ShipperLocation, ShipperLocationPort } from '../shipping-policy/shipping-ports';
import { TransactionContext } from '../transaction/transaction-context';
import { LOCATION_FRESH_MS } from './delivery-constants';
import { locationValid } from './delivery-rules';

// M14, the part M07 needs: the Shipper's LATEST position. One row per Shipper, overwritten by every report; there is no history table, no trail
// and no export. The time is the SERVER clock when the position arrived (a phone clock is never trusted). Freshness and validity are M14's
// verdicts here (delivery-rules.ts), handed to M06 through the location port.

export interface StoredLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly recordedAtMs: number;
  /** Age in seconds on the database clock at the moment of the read. */
  readonly ageSeconds: number;
}

interface RawLocation {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  recorded_ms: string;
  age_s: string;
}

@Injectable()
export class ShipperLocationRepository {
  async countFreshAmong(context:TransactionContext,ids:readonly string[]):Promise<number> {
    const r=(await context.query<{n:string}>(`SELECT count(*)::text AS n FROM app.shipper_latest_locations WHERE driver_id=ANY($1::uuid[])
      AND recorded_at>=clock_timestamp()-($2::float8*interval '1 millisecond') AND NOT(lat=0 AND lng=0)`,[ids,LOCATION_FRESH_MS])).rows[0]!;
    const n=Number(r.n);if(!Number.isSafeInteger(n))throw new TechnicalError('internal','Invalid location count');return n;
  }

  /** Keeps ONLY the latest position of the Shipper (INSERT or overwrite). Returns the stored time. */
  async upsert(context: TransactionContext, driverId: string, lat: number, lng: number, accuracyM: number | null): Promise<void> {
    await context.query(
      `INSERT INTO app.shipper_latest_locations (driver_id, lat, lng, accuracy_m, recorded_at)
       VALUES ($1::uuid, $2::float8, $3::float8, $4::float8, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at`,
      [driverId, lat, lng, accuracyM],
    );
  }

  /** The latest positions of several Shippers at once (a Shipper with none is absent). Ages are on the database clock. */
  async findMany(context: TransactionContext, driverIds: readonly string[]): Promise<Map<string, StoredLocation>> {
    const out = new Map<string, StoredLocation>();
    if (driverIds.length === 0) {
      return out;
    }
    const result = await context.query<RawLocation & { driver_id: string }>(
      `SELECT driver_id::text AS driver_id, lat, lng, accuracy_m, (extract(epoch FROM recorded_at) * 1000)::bigint::text AS recorded_ms,
              floor(extract(epoch FROM (date_trunc('milliseconds', clock_timestamp()) - recorded_at)))::text AS age_s
         FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])`,
      [driverIds],
    );
    for (const row of result.rows) {
      const recordedAtMs = Number(row.recorded_ms);
      const ageSeconds = Number(row.age_s);
      if (!Number.isSafeInteger(recordedAtMs) || !Number.isFinite(ageSeconds)) {
        throw new TechnicalError('internal', 'Database returned an unexpected position');
      }
      out.set(row.driver_id, { lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m, recordedAtMs, ageSeconds });
    }
    return out;
  }

  /**
   * The Shippers whose latest position lies inside a box around a point and is still fresh (LOCATION_FRESH_MS, the same threshold M06 uses), nearest first.
   * A cheap prefilter: a Shipper whose position went stale is not told about new deliveries; M06 still decides the real radius and freshness.
   */
  async driversNear(context: TransactionContext, lat: number, lng: number, radiusM: number, limit: number): Promise<string[]> {
    const dLat = radiusM / 111_000;
    const dLng = radiusM / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const result = await context.query<{ driver_id: string }>(
      `SELECT driver_id FROM app.shipper_latest_locations
        WHERE lat BETWEEN $1::float8 AND $2::float8 AND lng BETWEEN $3::float8 AND $4::float8
          AND recorded_at >= clock_timestamp() - ($8::float8 * interval '1 millisecond')
        ORDER BY (lat - $5::float8) * (lat - $5::float8) + (lng - $6::float8) * (lng - $6::float8) LIMIT $7`,
      [lat - dLat, lat + dLat, lng - dLng, lng + dLng, lat, lng, limit, LOCATION_FRESH_MS],
    );
    return result.rows.map((r) => r.driver_id);
  }

  async find(context: TransactionContext, driverId: string): Promise<StoredLocation | undefined> {
    const result = await context.query<RawLocation>(
      `SELECT lat, lng, accuracy_m, (extract(epoch FROM recorded_at) * 1000)::bigint::text AS recorded_ms,
              floor(extract(epoch FROM (date_trunc('milliseconds', clock_timestamp()) - recorded_at)))::text AS age_s
         FROM app.shipper_latest_locations WHERE driver_id = $1::uuid`,
      [driverId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    const recordedAtMs = Number(row.recorded_ms);
    const ageSeconds = Number(row.age_s);
    if (!Number.isSafeInteger(recordedAtMs) || !Number.isFinite(ageSeconds)) {
      throw new TechnicalError('internal', 'Database returned an unexpected position');
    }
    return { lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m, recordedAtMs, ageSeconds: Math.max(0, ageSeconds) };
  }
}

/** M14's answer for M06: the latest position with its own verdicts on freshness and validity. */
@Injectable()
export class ShipperLocationReader implements ShipperLocationPort {
  constructor(private readonly locations: ShipperLocationRepository) {}

  async current(context: TransactionContext, driverId: string): Promise<ShipperLocation | undefined> {
    const stored = await this.locations.find(context, driverId);
    if (stored === undefined) {
      return undefined;
    }
    return {
      point: { lat: stored.lat, lng: stored.lng },
      recordedAtMs: stored.recordedAtMs,
      fresh: stored.ageSeconds * 1000 <= LOCATION_FRESH_MS,
      valid: locationValid(stored.lat, stored.lng, stored.accuracyM),
    };
  }
}

/**
 * Whether the app must keep sharing the position: the Shipper wants orders (switch on while ACTIVE) or still has work to finish. Both the profile
 * (`presence`) and every position report answer with this, so the app starts and stops its location service from the server's word.
 */
export const shouldShareLocation = (driver: { readonly status: string; readonly acceptingDeliveries: boolean }, hasActiveWork: boolean): boolean =>
  (driver.acceptingDeliveries && driver.status === 'ACTIVE') || hasActiveWork;
