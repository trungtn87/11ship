import { describe, expect, it } from '@jest/globals';
import { RouteSnapshotRepository, RouteSnapshotRow } from './route-snapshot-repository';
import { routeFieldsOf, routeView } from './route-snapshot-view';

// P6-3 (#294): the `route` of a view. These cases are pure: the database paths are in tests/integration/p6-3-route-view.int.spec.ts.

const SNAPSHOT: RouteSnapshotRow = {
  id: '22222222-2222-4222-8222-222222222222',
  routeVersion: 'valhalla-3.9.1/motorcycle-shortest/test-a',
  distanceM: 2500,
  durationS: 420,
  geometry: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
};

/** A snapshot reader that records how often it is asked: the view must read at most once per call (no N+1). */
function fakeSnapshots(row: RouteSnapshotRow | undefined): { repo: RouteSnapshotRepository; reads: string[] } {
  const reads: string[] = [];
  const repo = {
    read: async (_context: unknown, id: string) => {
      reads.push(id);
      return row !== undefined && row.id === id ? row : undefined;
    },
  } as unknown as RouteSnapshotRepository;
  return { repo, reads };
}

const CONTEXT = {} as never;

describe('P6-3 route view: the object', () => {
  it('gives distance, time, version and status, with the road only when the reader may see it', () => {
    expect(routeView(SNAPSHOT, true)).toEqual({
      status: 'ROUTE',
      distance_m: 2500,
      duration_s: 420,
      route_version: SNAPSHOT.routeVersion,
      geometry: SNAPSHOT.geometry,
    });
  });

  it('without the right to the road the geometry KEY is absent (not null), and the distance and time stay', () => {
    const view = routeView(SNAPSHOT, false);
    expect(view).toEqual({ status: 'ROUTE', distance_m: 2500, duration_s: 420, route_version: SNAPSHOT.routeVersion });
    expect(view !== null && 'geometry' in view).toBe(false);
  });

  it('is null when the snapshot row does not exist', () => {
    expect(routeView(undefined, true)).toBeNull();
  });
});

describe('P6-3 route view: a pointer that may be NULL', () => {
  it('a customer-created record without a snapshot (before P6-2) gets route null and the legacy flag, and nothing is read', async () => {
    const { repo, reads } = fakeSnapshots(SNAPSHOT);
    expect(await routeFieldsOf(repo, CONTEXT, null, true, true)).toEqual({ route: null, legacy_reference_only: true });
    expect(await routeFieldsOf(repo, CONTEXT, null, false, true)).toEqual({ route: null, legacy_reference_only: true });
    expect(reads).toEqual([]);
  });

  it('a customer-created record with a snapshot gives its route with the flag off, and exactly one read', async () => {
    const { repo, reads } = fakeSnapshots(SNAPSHOT);
    expect(await routeFieldsOf(repo, CONTEXT, SNAPSHOT.id, true, true)).toMatchObject({ route: { distance_m: 2500, geometry: SNAPSHOT.geometry }, legacy_reference_only: false });
    expect(reads).toEqual([SNAPSHOT.id]);
  });

  it('a shop-created DIRECT call (not customer-created) gets route null and the flag FALSE, with or without a pointer, and nothing is read', async () => {
    const { repo, reads } = fakeSnapshots(SNAPSHOT);
    expect(await routeFieldsOf(repo, CONTEXT, null, true, false)).toEqual({ route: null, legacy_reference_only: false });
    expect(await routeFieldsOf(repo, CONTEXT, SNAPSHOT.id, true, false)).toEqual({ route: null, legacy_reference_only: false });
    expect(reads).toEqual([]);
  });

  it('a pointer whose row is missing gives route null with the flag off (not mistaken for a legacy record)', async () => {
    const { repo } = fakeSnapshots(undefined);
    expect(await routeFieldsOf(repo, CONTEXT, SNAPSHOT.id, true, true)).toEqual({ route: null, legacy_reference_only: false });
  });

  it('withGeometry false is honoured through the helper too', async () => {
    const { repo } = fakeSnapshots(SNAPSHOT);
    const fields = await routeFieldsOf(repo, CONTEXT, SNAPSHOT.id, false, true);
    expect(fields.route !== null && 'geometry' in fields.route).toBe(false);
  });
});
