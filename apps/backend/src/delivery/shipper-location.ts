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
  /** Keeps ONLY the latest position of the Shipper (INSERT or overwrite). Returns the stored time. */
  async upsert(context: TransactionContext, driverId: string, lat: number, lng: number, accuracyM: number | null): Promise<void> {
    await context.query(
      `INSERT INTO app.shipper_latest_locations (driver_id, lat, lng, accuracy_m, recorded_at)
       VALUES ($1::uuid, $2::float8, $3::float8, $4::float8, date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (driver_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, accuracy_m = EXCLUDED.accuracy_m, recorded_at = EXCLUDED.recorded_at`,
      [driverId, lat, lng, accuracyM],
    );
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
