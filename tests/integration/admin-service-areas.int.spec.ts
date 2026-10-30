import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import {
  ADMIN_PASSWORD,
  AdminApp,
  adminData,
  adminErrorCode,
  AdminResponse,
  cookieFrom,
  count,
  loginStep,
  preauthCookies,
  rewindAcceptedStep,
  sessionCookies,
  startAdminApp,
  totpNow,
} from './support/admin-fixtures';
import { begin, ok, post } from './support/activation-fixtures';
import { ADMIN_SESSION_COOKIE } from '../../apps/backend/src/admin-auth/admin-auth-constants';
import { createActiveShopFor, Phone, randomPhone } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
import { createInvitation, createPayload, systemSession, SystemSession } from './support/provisioning-fixtures';

// Issue #253 — Hệ thống › Vùng hoạt động (API) against the real Nest pipeline and PostgreSQL: SYSTEM writes, any live ADMIN reads, the strict inputs, the
// impact preview and its confirmation, version / idempotency / concurrency, audit + outbox, and that nothing is deleted, moved or rewritten (shops, deliveries,
// the areas that already exist). Fixtures are fake areas and shops.

const BASE = '/v1/admin';
const tag = randomBytes(3).toString('hex').toUpperCase();

interface AdminLogin {
  readonly cookie: string;
  readonly csrf: string;
}

type Json = Record<string, unknown>;
const row = (appName: string, view: boolean, lock = false, shops = false): Record<string, unknown> => ({ app: appName, can_view: view, can_review_profile: false, can_lock: lock, ...(shops ? { can_manage_shops: true } : {}) });

describe('admin service areas (API)', () => {
  let app: AdminApp;
  let system: SystemSession;
  let viewer: AdminLogin;
  let manager: AdminLogin;
  const areaIds: string[] = [];

  async function activatedAdmin(permissions: Record<string, unknown>[], fullName: string): Promise<{ phone: Phone; userId: string; secret: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const invitation = await createInvitation(app, system, createPayload(phone.local, { full_name: fullName, permissions }));
    const token = invitation.link.split('#t=')[1] as string;
    const session = await begin(app, { invitationId: invitation.invitationId, token, phone });
    ok(await post(app, '/password', session, { password: ADMIN_PASSWORD }));
    const secret = String(adminData(ok(await post(app, '/totp/enrollment', session))).secret);
    ok(await post(app, '/complete', session, { code: totpNow(secret) }));
    const found = await app.pool.query<{ user_id: string }>('SELECT user_id FROM app.users WHERE phone_normalized = $1', [phone.normalized]);
    return { phone, userId: (found.rows[0] as { user_id: string }).user_id, secret };
  }

  async function login(who: { phone: Phone; userId: string; secret: string }): Promise<AdminLogin> {
    const preauth = await loginStep(app, { phone: who.phone, password: ADMIN_PASSWORD, userId: who.userId });
    await rewindAcceptedStep(app, who.userId);
    const verified = await app.call('POST', '/totp/verify', { body: { code: totpNow(who.secret) }, cookies: preauthCookies(preauth), csrf: preauth.csrf });
    if (verified.status !== 200) throw new Error(`admin login failed: ${verified.status} ${verified.text}`);
    return { cookie: String(cookieFrom(verified, ADMIN_SESSION_COOKIE)), csrf: String(adminData(verified).csrf_token) };
  }

  const systemLogin = (): AdminLogin => ({ cookie: system.login.cookie, csrf: system.login.csrf });
  const read = (who: AdminLogin | undefined, path: string): Promise<AdminResponse> => app.call('GET', path, { basePath: BASE, ...(who === undefined ? {} : { cookies: sessionCookies(who) }) });
  const codeOf = (response: AdminResponse): { status: number; code: string | undefined } => ({ status: response.status, code: adminErrorCode(response) });
  const write = async (who: AdminLogin, path: string, body: unknown, options: { key?: string | null; csrf?: string | null } = {}): Promise<AdminResponse> => {
    await app.clearLimits();
    const key = options.key === undefined ? randomUUID() : options.key;
    return app.call('POST', path, {
      basePath: BASE,
      body,
      cookies: sessionCookies(who),
      ...(options.csrf === null ? {} : { csrf: options.csrf ?? who.csrf }),
      ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
    });
  };

  const audits = (areaId: string, action: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2', [areaId, action]);
  const events = (areaId: string, type: string): Promise<number> => count(app.pool, 'SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = $2', [areaId, type]);
  const areaRow = async (id: string) => (await app.pool.query<{ name: string; status: string; version: string; coverage_lat: number | null; coverage_radius_m: number | null }>('SELECT name, status, version::text AS version, coverage_lat, coverage_radius_m FROM app.service_areas WHERE service_area_id = $1::uuid', [id])).rows[0]!;
  const circle = { lat: 21, lng: 105, radius_m: 5000 };

  async function create(over: Record<string, unknown> = {}): Promise<AdminResponse> {
    const code = `ZA-${tag}-${randomBytes(3).toString('hex')}`;
    const response = await write(systemLogin(), '/service-areas', { code, name: `Vùng thử ${code}`, reason: 'Tạo vùng thử', ...over });
    if (response.status === 201) areaIds.push(String(adminData(response).service_area_id));
    return response;
  }

  async function shopIn(areaId: string, pin: { lat: number; lng: number }): Promise<{ shopId: string; ownerId: string }> {
    const phone = randomPhone();
    app.track(phone.normalized);
    const ownerId = randomUUID();
    await app.pool.query(
      `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, clock_timestamp(), 'PHONE_VERIFIED', 'ACTIVE', 1, clock_timestamp(), clock_timestamp())`,
      [ownerId, phone.normalized, await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD)],
    );
    const shopId = await createActiveShopFor(app.pool, ownerId, areaId);
    await app.pool.query(`UPDATE app.shops SET pickup_lat = $2, pickup_lng = $3, activated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [shopId, pin.lat, pin.lng]);
    return { shopId, ownerId };
  }

  beforeAll(async () => {
    app = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(app);
    viewer = await login(await activatedAdmin([row('SHOP', true)], `Quản trị xem vùng ${tag}`));
    // The strongest ADMIN rights of the shop side: they still give nothing here.
    manager = await login(await activatedAdmin([row('SHOP', true, true, true)], `Quản trị quán ${tag}`));
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.pool.query('DELETE FROM app.deliveries WHERE shop_id IN (SELECT shop_id FROM app.shops WHERE service_area_id = ANY($1::uuid[]))', [areaIds]).catch(() => undefined);
      await app.close();
      await app.pool.query('DELETE FROM app.service_areas WHERE service_area_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM app.shops s WHERE s.service_area_id = service_areas.service_area_id)', [areaIds]).catch(() => undefined);
    }
  });

  it('rights: any live administrator reads and previews; only SYSTEM writes, whatever shop rights an ADMIN holds; no session is 401, no CSRF is refused', async () => {
    const made = await create({ coverage: circle });
    expect(made.status).toBe(201);
    const id = String(adminData(made).service_area_id);
    for (const path of ['/service-areas', `/service-areas/${id}`, `/service-areas/${id}/impact?status=INACTIVE`]) {
      expect([path, (await read(systemLogin(), path)).status]).toEqual([path, 200]);
      expect([path, (await read(viewer, path)).status]).toEqual([path, 200]);
      expect([path, (await read(manager, path)).status]).toEqual([path, 200]);
      expect([path, codeOf(await read(undefined, path))]).toEqual([path, { status: 401, code: 'ADMIN_SESSION_INVALID' }]);
    }
    const before = await areaRow(id);
    for (const who of [viewer, manager]) {
      expect(codeOf(await write(who, '/service-areas', { code: `ZA-${tag}-no`, name: 'Không được', reason: 'x' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await write(who, `/service-areas/${id}`, { expected_version: 1, name: 'Đổi tên', reason: 'x' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
      expect(codeOf(await write(who, `/service-areas/${id}/status`, { expected_version: 1, status: 'ACTIVE', reason: 'x' }))).toEqual({ status: 403, code: 'ADMIN_FORBIDDEN' });
    }
    expect((await write(systemLogin(), `/service-areas/${id}`, { expected_version: 1, name: 'Không CSRF', reason: 'x' }, { csrf: null })).status).toBeGreaterThanOrEqual(400);
    expect((await write(systemLogin(), `/service-areas/${id}`, { expected_version: 1, name: 'Không khóa', reason: 'x' }, { key: null })).status).toBeGreaterThanOrEqual(400);
    expect(await areaRow(id)).toEqual(before);
  });

  it('create: INACTIVE by default, no invented geometry, strict inputs, a duplicate code is refused, a replay writes once', async () => {
    const bare = await create();
    expect(bare.status).toBe(201);
    expect(adminData(bare)).toMatchObject({ status: 'INACTIVE', version: 1, coverage: null, gps_configured: false, shops_total: 0 });
    const withCircle = await create({ coverage: circle });
    expect(adminData(withCircle)).toMatchObject({ gps_configured: true, coverage: circle });

    const code = `ZA-${tag}-dup`;
    const key = randomUUID();
    const first = await write(systemLogin(), '/service-areas', { code, name: 'Một lần', reason: 'Tạo' }, { key });
    expect(first.status).toBe(201);
    areaIds.push(String(adminData(first).service_area_id));
    const replay = await write(systemLogin(), '/service-areas', { code, name: 'Một lần', reason: 'Tạo' }, { key });
    expect(replay.status).toBe(201);
    expect(adminData(replay).service_area_id).toBe(adminData(first).service_area_id);
    expect(await audits(String(adminData(first).service_area_id), 'admin.service_area.create.v1')).toBe(1);
    expect(await events(String(adminData(first).service_area_id), 'service_area.created.v1')).toBe(1);
    expect(codeOf(await write(systemLogin(), '/service-areas', { code: code.toLowerCase(), name: 'Trùng mã', reason: 'Tạo' }))).toEqual({ status: 409, code: 'SERVICE_AREA_CODE_CONFLICT' });

    const bad: Record<string, unknown>[] = [
      { coverage: { ...circle, radius_m: 0 } },
      { coverage: { ...circle, radius_m: 100001 } },
      { coverage: { ...circle, radius_m: 3.5 } },
      { coverage: { ...circle, lat: 91 } },
      { coverage: { ...circle, lng: -181 } },
      { coverage: { lat: 21, lng: 105 } },
      { coverage: { ...circle, extra: 1 } },
      { name: '   ' },
      { code: 'có dấu' },
      { reason: '' },
      { unknown_field: true },
    ];
    for (const over of bad) {
      expect([JSON.stringify(over), (await create(over)).status]).toEqual([JSON.stringify(over), 400]);
    }
    expect((await create({ coverage: { ...circle, radius_m: 100000 } })).status).toBe(201);
    expect((await create({ coverage: { ...circle, radius_m: 1 } })).status).toBe(201);
  });

  it('update: needs the version, replays once, keeps the geometry when none is sent, never clears it; two writers on one version: one wins', async () => {
    const made = await create({ coverage: circle });
    const id = String(adminData(made).service_area_id);
    const key = randomUUID();
    const renamed = await write(systemLogin(), `/service-areas/${id}`, { expected_version: 1, name: 'Tên mới', reason: 'Đổi tên' }, { key });
    expect(renamed.status).toBe(200);
    expect(adminData(renamed)).toMatchObject({ name: 'Tên mới', version: 2, coverage: circle });
    expect((await write(systemLogin(), `/service-areas/${id}`, { expected_version: 1, name: 'Tên mới', reason: 'Đổi tên' }, { key })).status).toBe(200);
    expect(await audits(id, 'admin.service_area.update.v1')).toBe(1);
    expect((await areaRow(id)).version).toBe('2');
    expect(codeOf(await write(systemLogin(), `/service-areas/${id}`, { expected_version: 1, name: 'Cũ', reason: 'Lỗi thời' }))).toEqual({ status: 409, code: 'VERSION_CONFLICT' });
    expect(codeOf(await write(systemLogin(), `/service-areas/${randomUUID()}`, { expected_version: 1, name: 'Không có', reason: 'x' }))).toEqual({ status: 404, code: 'SERVICE_AREA_NOT_FOUND' });
    expect(codeOf(await write(systemLogin(), `/service-areas/${id}`, { expected_version: 2, name: 'Xóa vòng', coverage: null, reason: 'x' }))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });

    const [one, two] = await Promise.all([
      write(systemLogin(), `/service-areas/${id}`, { expected_version: 2, name: 'Bên A', coverage: { ...circle, radius_m: 6000 }, reason: 'A' }),
      write(systemLogin(), `/service-areas/${id}`, { expected_version: 2, name: 'Bên B', coverage: { ...circle, radius_m: 7000 }, reason: 'B' }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect((await areaRow(id)).version).toBe('3');
  });

  it('impact: counts public shops, pins that fall outside, running orders and deliveries; a change that removes public shops or switches off needs the confirmation; nothing of a shop or a delivery changes', async () => {
    const made = await create({ coverage: circle, status: 'INACTIVE' });
    const id = String(adminData(made).service_area_id);
    expect((await write(systemLogin(), `/service-areas/${id}/status`, { expected_version: 1, status: 'ACTIVE', reason: 'Bật' })).status).toBe(200);
    const near = await shopIn(id, { lat: 21.001, lng: 105 });
    const far = await shopIn(id, { lat: 21.04, lng: 105 });
    const deliveryId = await insertDeliveryRow(app.pool, { shopId: near.shopId, userId: near.ownerId });
    const deliveryBefore = (await app.pool.query('SELECT pickup_lat, pickup_lng, state FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0];
    const shopsBefore = (await app.pool.query('SELECT shop_id, pickup_lat, pickup_lng, service_area_id, status, version FROM app.shops WHERE service_area_id = $1::uuid ORDER BY shop_id', [id])).rows;

    // The 4.4 km shop is inside 5 km; shrinking to 2 km takes the far one out and keeps near; 100 m takes both out.
    const detail = adminData(await read(viewer, `/service-areas/${id}`));
    expect(detail).toMatchObject({ shops_total: 2, shops_public: 2, pins_outside: 1, active_deliveries: 1 });
    const shrink = adminData(await read(viewer, `/service-areas/${id}/impact?lat=21&lng=105&radius_m=2000`));
    expect(shrink).toMatchObject({ pins_outside_current: 1, pins_outside_proposed: 1, public_shops_newly_outside: 0, active_deliveries: 1, requires_confirmation: false });
    const tiny = adminData(await read(viewer, `/service-areas/${id}/impact?lat=21&lng=105&radius_m=100`));
    expect(tiny).toMatchObject({ pins_outside_proposed: 2, public_shops_newly_outside: 1, requires_confirmation: true });
    const off = adminData(await read(viewer, `/service-areas/${id}/impact?status=INACTIVE`));
    expect(off).toMatchObject({ shops_public: 2, active_deliveries: 1, requires_confirmation: true });
    expect(codeOf(await read(viewer, `/service-areas/${id}/impact?lat=21`))).toEqual({ status: 400, code: 'ADMIN_INPUT_INVALID' });

    // The confirmation is demanded again under lock by the write itself, from the real figures.
    const unconfirmed = await write(systemLogin(), `/service-areas/${id}`, { expected_version: 2, name: 'Thu hẹp', coverage: { ...circle, radius_m: 100 }, reason: 'Thu hẹp' });
    expect(codeOf(unconfirmed)).toEqual({ status: 409, code: 'SERVICE_AREA_IMPACT_CONFIRM_REQUIRED' });
    expect(codeOf(await write(systemLogin(), `/service-areas/${id}/status`, { expected_version: 2, status: 'INACTIVE', reason: 'Tắt' }))).toEqual({ status: 409, code: 'SERVICE_AREA_IMPACT_CONFIRM_REQUIRED' });
    expect((await areaRow(id)).version).toBe('2');
    const switched = await write(systemLogin(), `/service-areas/${id}/status`, { expected_version: 2, status: 'INACTIVE', reason: 'Tắt có xác nhận', confirm_impact: true });
    expect(switched.status).toBe(200);
    expect(adminData(switched)).toMatchObject({ status: 'INACTIVE', version: 3 });
    expect(await audits(id, 'admin.service_area.status.v1')).toBe(2);
    expect(await events(id, 'service_area.status_changed.v1')).toBe(2);
    // Already in that state: nothing to do and nothing logged.
    expect((await write(systemLogin(), `/service-areas/${id}/status`, { expected_version: 3, status: 'INACTIVE', reason: 'Lại' })).status).toBe(200);
    expect(await audits(id, 'admin.service_area.status.v1')).toBe(2);

    const audit = await app.pool.query<{ metadata: Json }>(`SELECT metadata FROM app.audit_logs WHERE resource_id = $1 AND action = 'admin.service_area.status.v1' ORDER BY occurred_at DESC LIMIT 1`, [id]);
    expect(audit.rows[0]?.metadata).toMatchObject({ from_status: 'ACTIVE', to_status: 'INACTIVE', reason: 'Tắt có xác nhận' });

    // Not a single shop, pin, area link or delivery snapshot moved; the area still exists (no route deletes one).
    expect((await app.pool.query('SELECT shop_id, pickup_lat, pickup_lng, service_area_id, status, version FROM app.shops WHERE service_area_id = $1::uuid ORDER BY shop_id', [id])).rows).toEqual(shopsBefore);
    expect((await app.pool.query('SELECT pickup_lat, pickup_lng, state FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]).toEqual(deliveryBefore);
    expect(far.shopId).not.toBe(near.shopId);
    expect((await app.call('DELETE', `/service-areas/${id}`, { basePath: BASE, cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf })).status).toBe(404);
    expect(await areaRow(id)).toMatchObject({ status: 'INACTIVE' });
    // The deactivated area is no longer a choice for a shop and the public resolver, but its shops keep their link.
    expect((await app.pool.query('SELECT 1 FROM app.shops WHERE service_area_id = $1::uuid', [id])).rowCount).toBe(2);
  });

  it('the areas that already existed are not touched by any of this', async () => {
    const existing = await app.pool.query<{ service_area_id: string; version: string; name: string }>(`SELECT service_area_id, version::text AS version, name FROM app.service_areas WHERE service_area_id <> ALL($1::uuid[]) AND code NOT LIKE 'ZT-%'`, [areaIds]);
    const listed = adminData(await read(systemLogin(), '/service-areas')).items as { service_area_id: string; version: number; name: string }[];
    for (const area of existing.rows) {
      expect(listed.find((item) => item.service_area_id === area.service_area_id)).toMatchObject({ version: Number(area.version), name: area.name });
    }
  });
});
