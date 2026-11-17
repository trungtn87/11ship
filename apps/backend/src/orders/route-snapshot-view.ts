import { JsonObject } from '../idempotency/idempotency-executor';
import { RouteSnapshotRepository, RouteSnapshotRow } from './route-snapshot-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { RouteLeg } from '../delivery/m14-route-client';
import { isValidPoint, LatLng } from '../shipping-policy/shipping-eligibility';

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

/**
 * The `route` and the legacy flag for a pointer that may be NULL.
 * `customerCreated` is the trusted source marker: an Order, or a delivery whose source is ORDER or CUSTOMER (the DB CHECK allows only DIRECT, ORDER,
 * CUSTOMER). A DIRECT call (created by the shop, never through a checkout quote) gets route null and the flag false, whatever its pointer holds.
 * For a customer-created record a NULL pointer means "created before P6-2": the flag is true and nothing is backfilled.
 */
export async function routeFieldsOf(snapshots: RouteSnapshotRepository, context: TransactionContext, snapshotId: string | null, withGeometry: boolean, customerCreated: boolean): Promise<RouteFields> {
  if (!customerCreated) {
    return { route: null, legacy_reference_only: false };
  }
  if (snapshotId === null) {
    return { route: null, legacy_reference_only: true };
  }
  const row = await snapshots.read(context, snapshotId);
  return { route: routeView(row, withGeometry), legacy_reference_only: false };
}

/** The part of the M14 route client a reference road needs: one leg between two points, or undefined when no clean route exists. */
export interface ReferenceRoads {
  route(from: LatLng, to: LatLng): Promise<RouteLeg | undefined>;
}

/**
 * P6-8b (#294): the CURRENT road of a legacy record (no snapshot), for reference only. It is computed on a read, never stored, and it carries the
 * geometry and nothing else: no distance and no time, so no new figure is attached to the fee in force. Any missing point, missing service or failed
 * answer is null ("chưa có tuyến"). The caller attaches the key only when the reader may see the drop-off point.
 */
export async function referenceRouteOf(roads: ReferenceRoads | undefined, from: { lat: number | null; lng: number | null }, to: { lat: number | null; lng: number | null }): Promise<JsonObject | null> {
  if (roads === undefined || from.lat === null || from.lng === null || to.lat === null || to.lng === null) {
    return null;
  }
  const start = { lat: from.lat, lng: from.lng };
  const end = { lat: to.lat, lng: to.lng };
  if (!isValidPoint(start) || !isValidPoint(end)) {
    return null;
  }
  const leg = await roads.route(start, end);
  return leg === undefined ? null : { status: 'REFERENCE', geometry: leg.geometry };
}

// P6-8b (#294, review fix): the M14 call never runs inside the read transaction. The read only RECORDS the endpoints it needs in a holder; the
// reference road is asked of M14 after the transaction has returned and released its connection (see readWithReferenceRoute).

export interface ReferencePoint {
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface ReferenceRequest {
  readonly from: ReferencePoint;
  readonly to: ReferencePoint;
}

/** Filled inside the read transaction; read after it ends. `request` stays null when the record needs no reference road. */
export interface ReferenceHolder {
  request: ReferenceRequest | null;
}

export function newReferenceHolder(): ReferenceHolder {
  return { request: null };
}

/** Records the endpoints a reference road is wanted for. A view passes its holder only on the GET readers; undefined means "not asked". */
export function requestReferenceRoute(holder: ReferenceHolder | undefined, from: ReferencePoint, to: ReferencePoint): void {
  if (holder !== undefined) {
    holder.request = { from, to };
  }
}

/** The one method of the transaction manager this sequencing needs. */
export interface ReadTransactions {
  withTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Runs a read in its transaction and only then attaches the reference road. The transaction, and the database connection it holds, is released
 * before `attach` calls M14, so a slow or failed route service never keeps a connection from the pool.
 */
export async function readWithReferenceRoute<T extends JsonObject>(
  transactions: ReadTransactions,
  read: (context: TransactionContext, holder: ReferenceHolder) => Promise<T>,
  attach: (view: T, holder: ReferenceHolder) => Promise<T>,
): Promise<T> {
  const holder = newReferenceHolder();
  const view = await transactions.withTransaction((context) => read(context, holder));
  return attach(view, holder);
}

/** Asks M14 for the requested reference road and attaches it as `reference_route` (null when none can be computed). Never called inside a transaction. */
export async function attachReferenceRoute<T extends JsonObject>(view: T, holder: ReferenceHolder, roads: ReferenceRoads | undefined): Promise<T> {
  if (holder.request !== null) {
    const out: JsonObject = view;
    out.reference_route = await referenceRouteOf(roads, holder.request.from, holder.request.to);
  }
  return view;
}
