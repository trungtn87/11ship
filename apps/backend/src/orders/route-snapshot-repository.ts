import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RouteLeg } from '../delivery/m14-route-client';
import { TransactionContext } from '../transaction/transaction-context';

// P6-2 (#294): the immutable route snapshot behind a checkout quote. A row is the M14 answer itself (route_version, whole metres, seconds, polyline6);
// the database refuses UPDATE / DELETE / TRUNCATE, so the distance and geometry an Order points to never change.

export interface RouteSnapshotRow {
  readonly id: string;
  readonly routeVersion: string;
  readonly distanceM: number;
  readonly durationS: number;
  readonly geometry: string;
}

interface RawRouteSnapshot {
  id: string;
  route_version: string;
  distance_m: number;
  duration_s: number;
  geometry: string;
}

/** True when a stored snapshot is exactly the leg a fresh routing answer gives: same engine version, same metres, same time, same road. */
export function routeSnapshotMatchesLeg(row: RouteSnapshotRow, leg: RouteLeg): boolean {
  return row.routeVersion === leg.routeVersion && row.distanceM === leg.distanceM && row.durationS === leg.seconds && row.geometry === leg.geometry;
}

@Injectable()
export class RouteSnapshotRepository {
  /**
   * Stores the snapshot of the leg and returns its id. An identical route (same engine version, metres, time and road) is NOT stored twice: the
   * content_key is unique, so the existing row is returned. A row is locked (FOR KEY SHARE) before it is returned, so the retention job cannot delete it
   * before the caller references it; if the job got there first, the row is gone and a new one is stored.
   */
  async create(context: TransactionContext, leg: RouteLeg): Promise<string> {
    const inserted = await context.query<{ id: string }>(
      `INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry)
       VALUES ($1::uuid, $2, $3::int, $4::int, $5)
       ON CONFLICT (content_key) DO NOTHING
       RETURNING id::text AS id`,
      [randomUUID(), leg.routeVersion, leg.distanceM, leg.seconds, leg.geometry],
    );
    if (inserted.rows[0] !== undefined) {
      return inserted.rows[0].id;
    }
    const existing = await context.query<{ id: string }>(
      `SELECT id::text AS id FROM app.route_snapshots
        WHERE route_version = $1 AND distance_m = $2::int AND duration_s = $3::int AND geometry = $4
        FOR KEY SHARE`,
      [leg.routeVersion, leg.distanceM, leg.seconds, leg.geometry],
    );
    const row = existing.rows[0];
    if (row !== undefined) {
      return row.id;
    }
    // The identical row was removed between the two statements (retention): store it again.
    return this.create(context, leg);
  }

  /** The snapshot with this id, locked (FOR KEY SHARE) for the caller's transaction; undefined when it does not exist (never stored, or already removed). */
  async find(context: TransactionContext, id: string): Promise<RouteSnapshotRow | undefined> {
    const result = await context.query<RawRouteSnapshot>(
      `SELECT id::text AS id, route_version, distance_m, duration_s, geometry FROM app.route_snapshots WHERE id = $1::uuid FOR KEY SHARE`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { id: row.id, routeVersion: row.route_version, distanceM: row.distance_m, durationS: row.duration_s, geometry: row.geometry };
  }

  /** Retention (D6-3): removes at most 200 snapshots older than the interval that nothing references. Returns how many were removed. */
  async purgeUnreferenced(context: TransactionContext, olderThan: string): Promise<number> {
    const result = await context.query<{ n: number }>('SELECT app.purge_unreferenced_route_snapshots($1::interval)::int AS n', [olderThan]);
    return result.rows[0]?.n ?? 0;
  }
}
