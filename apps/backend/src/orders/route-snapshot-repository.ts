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
  /** Stores a new snapshot of the leg and returns its id. Every quote gets its own row: an identical answer is not reused, so each address change is a new snapshot. */
  async create(context: TransactionContext, leg: RouteLeg): Promise<string> {
    const id = randomUUID();
    await context.query(
      `INSERT INTO app.route_snapshots (id, route_version, distance_m, duration_s, geometry)
       VALUES ($1::uuid, $2, $3::int, $4::int, $5)`,
      [id, leg.routeVersion, leg.distanceM, leg.seconds, leg.geometry],
    );
    return id;
  }

  async find(context: TransactionContext, id: string): Promise<RouteSnapshotRow | undefined> {
    const result = await context.query<RawRouteSnapshot>(
      `SELECT id::text AS id, route_version, distance_m, duration_s, geometry FROM app.route_snapshots WHERE id = $1::uuid`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : { id: row.id, routeVersion: row.route_version, distanceM: row.distance_m, durationS: row.duration_s, geometry: row.geometry };
  }
}
