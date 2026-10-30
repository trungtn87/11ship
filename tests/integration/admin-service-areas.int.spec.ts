import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminApp, adminData, adminErrorCode, AdminResponse, sessionCookies, startAdminApp } from './support/admin-fixtures';
import { ActivatedAdmin, activatedAdmin, getAs, permission, postAs, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// Issue #253 on a REAL PostgreSQL: Hệ thống › Vùng hoạt động (Admin API). Any live administrator reads and previews; only SYSTEM writes (no shop or lock right
// is borrowed); transport checks, optimistic version, Idempotency-Key replay, audit + outbox of a real change, no change when nothing changes, and the public
// resolver reading the very same row. Fixture areas only (code ZT-253-*), removed afterwards.

const tag = randomBytes(3).toString('hex').toUpperCase();
const BASE = '/service-areas';

describe('issue #253 — service areas (Admin API)', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let viewer: ActivatedAdmin;
  const outcome = (response: AdminResponse): [number, string | undefined] => [response.status, adminErrorCode(response)];
  const body = (response: AdminResponse): Record<string, any> => adminData(response) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const asSystem = () => systemLoginOf(system);
  const create = (code: string, extra: Record<string, unknown> = {}, who = asSystem(), key?: string) => postAs(admin, who, BASE, { code, name: `Vùng thử ${code}`, reason: 'Lập vùng thử', ...extra }, key);
  const code = (suffix: string): string => `ZT-253-${tag}-${suffix}`;

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    viewer = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Xem vùng ${tag}`);
  });
  afterAll(async () => {
    try {
      await admin.pool.query(`DELETE FROM app.service_areas WHERE code LIKE 'ZT-253-%'`);
    } finally {
      await admin.close();
    }
  });

  it('SYSTEM creates an area without a circle (INACTIVE by default, "Chưa cấu hình GPS"), reads it back in the list and the detail; no session is 401', async () => {
    const created = await create(code('A'));
    expect(created.status).toBe(201);
    expect(body(created)).toMatchObject({ code: code('A'), status: 'INACTIVE', version: 1, coverage: null, gps_configured: false, shops_total: 0, pins_outside: 0 });
    const id = body(created).service_area_id as string;
    expect(body(await getAs(admin, asSystem(), `${BASE}/${id}`))).toMatchObject({ service_area_id: id, gps_configured: false });
    const listed = body(await getAs(admin, asSystem(), BASE)).items as Array<{ service_area_id: string }>;
    expect(listed.some((item) => item.service_area_id === id)).toBe(true);
    expect(outcome(await getAs(admin, undefined, BASE))).toEqual([401, 'ADMIN_SESSION_INVALID']);
  });

  it('a duplicate code is a 409 and writes nothing; invalid coverage (radius 0, latitude 91) and unknown fields are refused', async () => {
    expect((await create(code('B'))).status).toBe(201);
    expect(outcome(await create(code('B')))).toEqual([409, 'SERVICE_AREA_CODE_CONFLICT']);
    expect((await create(code('B2'), { coverage: { lat: 21, lng: 105, radius_m: 0 } })).status).toBe(400);
    expect((await create(code('B3'), { coverage: { lat: 91, lng: 105, radius_m: 1000 } })).status).toBe(400);
    expect((await create(code('B4'), { surprise: true })).status).toBe(400);
    const rows = await admin.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.service_areas WHERE code LIKE $1`, [`ZT-253-${tag}-B%`]);
    expect(rows.rows[0]?.n).toBe('1');
  });

  it('an ADMIN with the shop right reads and previews but never writes (403) and nothing is written; a SYSTEM write without CSRF or from another Origin is refused', async () => {
    const created = body(await create(code('C')));
    const id = created.service_area_id as string;
    expect(body(await getAs(admin, viewer.login, `${BASE}/${id}`)).service_area_id).toBe(id);
    expect((await getAs(admin, viewer.login, `${BASE}/${id}/impact?status=INACTIVE`)).status).toBe(200);
    expect(outcome(await create(code('C2'), {}, viewer.login))).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(outcome(await postAs(admin, viewer.login, `${BASE}/${id}/status`, { expected_version: 1, status: 'ACTIVE', reason: 'thử' }))).toEqual([403, 'ADMIN_FORBIDDEN']);
    const raw = { code: code('C3'), name: 'x', reason: 'thử' };
    expect(outcome(await admin.call('POST', BASE, { basePath: '/v1/admin', body: raw, cookies: sessionCookies(asSystem()), headers: { 'idempotency-key': randomUUID() } }))).toEqual([403, 'ADMIN_CSRF_INVALID']);
    expect(outcome(await admin.call('POST', BASE, { basePath: '/v1/admin', body: raw, origin: 'https://evil.example', cookies: sessionCookies(asSystem()), csrf: asSystem().csrf, headers: { 'idempotency-key': randomUUID() } }))).toEqual([403, 'ADMIN_CSRF_INVALID']);
    const n = await admin.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.service_areas WHERE code LIKE $1`, [`ZT-253-${tag}-C%`]);
    expect(n.rows[0]?.n).toBe('1');
    expect((await admin.pool.query(`SELECT 1 FROM app.audit_logs WHERE resource_id = $1::uuid AND actor_type = 'ADMIN'`, [id])).rowCount).toBe(0);
  });

  it('update sets name and circle; the version grows, audit and outbox keep the reason; a stale screen is a 409; the same key replays once; two writers on one version have one winner', async () => {
    const id = body(await create(code('D'))).service_area_id as string;
    const key = randomUUID();
    const change = { expected_version: 1, name: 'Vùng D mới', coverage: { lat: 21, lng: 105, radius_m: 5000 }, reason: 'Cấu hình vòng phủ' };
    const first = await postAs(admin, asSystem(), `${BASE}/${id}`, change, key);
    expect(first.status).toBe(200);
    expect(body(first)).toMatchObject({ version: 2, name: 'Vùng D mới', gps_configured: true, coverage: { lat: 21, lng: 105, radius_m: 5000 } });
    const replay = await postAs(admin, asSystem(), `${BASE}/${id}`, change, key);
    expect([replay.status, body(replay).version]).toEqual([200, 2]);
    expect(outcome(await postAs(admin, asSystem(), `${BASE}/${id}`, { ...change, name: 'Khác' }))).toEqual([409, 'VERSION_CONFLICT']);

    const audit = await admin.pool.query<{ actor_type: string; outcome: string; metadata: Record<string, unknown> }>(
      `SELECT actor_type, outcome, metadata FROM app.audit_logs WHERE action = 'admin.service_area.update.v1' AND resource_id = $1::uuid`, [id]);
    expect(audit.rows).toHaveLength(1); // the replay did not log again
    expect(audit.rows[0]).toMatchObject({ actor_type: 'SYSTEM', outcome: 'SUCCESS' });
    expect(audit.rows[0]?.metadata).toMatchObject({ reason: 'Cấu hình vòng phủ', geometry_changed: true, to_radius_m: 5000 });
    expect((await admin.pool.query(`SELECT 1 FROM app.outbox_events WHERE event_type = 'service_area.updated.v1' AND resource_id = $1::uuid`, [id])).rowCount).toBe(1);

    const racers = await Promise.all([
      postAs(admin, asSystem(), `${BASE}/${id}`, { expected_version: 2, name: 'Đua 1', reason: 'đua' }),
      postAs(admin, asSystem(), `${BASE}/${id}`, { expected_version: 2, name: 'Đua 2', reason: 'đua' }),
    ]);
    expect(racers.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('status: ACTIVE then INACTIVE are read back; asking for the state it already has changes and logs nothing; the public resolver reads the same row', async () => {
    const id = body(await create(code('E'), { coverage: { lat: 16, lng: 108, radius_m: 8000 } })).service_area_id as string;
    const on = await postAs(admin, asSystem(), `${BASE}/${id}/status`, { expected_version: 1, status: 'ACTIVE', reason: 'Mở vùng' });
    expect(body(on)).toMatchObject({ status: 'ACTIVE', version: 2 });
    const resolved = await admin.call('GET', '/service-areas/resolve?lat=16&lng=108', { basePath: '/v1' });
    expect(resolved.status).toBe(200);
    expect(JSON.stringify(resolved.body)).toContain(id);

    const same = await postAs(admin, asSystem(), `${BASE}/${id}/status`, { expected_version: 2, status: 'ACTIVE', reason: 'Lặp' });
    expect(body(same)).toMatchObject({ status: 'ACTIVE', version: 2 });
    const off = await postAs(admin, asSystem(), `${BASE}/${id}/status`, { expected_version: 2, status: 'INACTIVE', reason: 'Tắt vùng' });
    expect(body(off)).toMatchObject({ status: 'INACTIVE', version: 3, shops_total: 0 });
    const logged = await admin.pool.query(`SELECT 1 FROM app.audit_logs WHERE action = 'admin.service_area.status.v1' AND resource_id = $1::uuid`, [id]);
    expect(logged.rowCount).toBe(2);
    expect(JSON.stringify((await admin.call('GET', '/service-areas/resolve?lat=16&lng=108', { basePath: '/v1' })).body)).not.toContain(id);
  });

  it('the impact preview is read-only, needs a valid query, and reports no confirmation for an area with no public shop, no open order and no active delivery', async () => {
    const id = body(await create(code('F'), { status: 'ACTIVE', coverage: { lat: 10, lng: 106, radius_m: 3000 } })).service_area_id as string;
    const preview = body(await getAs(admin, asSystem(), `${BASE}/${id}/impact?status=INACTIVE`));
    expect(preview).toMatchObject({ shops_total: 0, shops_public: 0, orders_open: 0, active_deliveries: 0, requires_confirmation: false });
    expect((await getAs(admin, asSystem(), `${BASE}/${id}/impact?bogus=1`)).status).toBe(400);
    expect(outcome(await getAs(admin, asSystem(), `${BASE}/${randomUUID()}`))).toEqual([404, 'SERVICE_AREA_NOT_FOUND']);
    expect(body(await getAs(admin, asSystem(), `${BASE}/${id}`)).version).toBe(1);
  });
});
