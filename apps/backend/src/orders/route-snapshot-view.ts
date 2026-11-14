import { JsonObject } from '../idempotency/idempotency-executor';
import { RouteSnapshotRepository, RouteSnapshotRow } from './route-snapshot-repository';
import { TransactionContext } from '../transaction/transaction-context';

// P6-3 (#294): the `route` of an Order or delivery detail, read from the immutable snapshot the checkout quote (P6-2) pointed to. No M14 call happens
// here and nothing is recomputed. An Order or delivery without a snapshot (created before P6-2) gets `route: null` and `legacy_reference_only: true`:
// its stored distance and fee are kept, and no new route is attached to an old fee.
// The road (`geometry`) is given only when the reader may already see the drop-off point of that Order; otherwise the key is absent (not null).
// List views never carry `route` at all: they are built without these fields.

export interface RouteFields {
  readonly route: JsonObject | null;
  readonly legacy_reference_only: boolean;
}

/** The `route` object of one snapshot. `withGeometry` false drops the `geometry` key entirely. */
export function routeView(row: RouteSnapshotRow | undefined, withGeometry: boolean): JsonObject | null {
  if (row === undefined) {
    return null;
  }
  return {
    status: 'ROUTE',
    distance_m: row.distanceM,
    duration_s: row.durationS,
    route_version: row.routeVersion,
    ...(withGeometry ? { geometry: row.geometry } : {}),
  };
}

/** The `route` and the legacy flag for a pointer that may be NULL. A NULL pointer is the only legacy case: nothing is backfilled. */
export async function routeFieldsOf(snapshots: RouteSnapshotRepository, context: TransactionContext, snapshotId: string | null, withGeometry: boolean): Promise<RouteFields> {
  if (snapshotId === null) {
    return { route: null, legacy_reference_only: true };
  }
  const row = await snapshots.read(context, snapshotId);
  return { route: routeView(row, withGeometry), legacy_reference_only: false };
}
