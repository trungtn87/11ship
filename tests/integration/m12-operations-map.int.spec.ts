import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, startAdminApp } from './support/admin-fixtures';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, getAs, permission, purgeGrants, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';

// Issue #262 (IV) on a REAL PostgreSQL: GET /v1/admin/overview/map, the data behind "Bản đồ vận hành". Real coordinates only, as much as the actor's rights allow: shops
// need the SHOP app VIEW, Shippers the DRIVER app VIEW (their NAMES also need the review right), the zones either. A position is LIVE up to 120 s, STALE up to 600 s and is not
// given after that; an Online Shipper without a usable position is counted, never placed.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('issue #262 — operations map (Admin API)', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let both: ActivatedAdmin;
  let shopOnly: ActivatedAdmin;
  let driverOnly: ActivatedAdmin;
  let reviewer: ActivatedAdmin;
  let none: ActivatedAdmin;
  const shopIds: string[] = [];
  const phones: string[] = [];
  const zoneIds: string[] = [];
  const drivers: Record<'live' | 'stale' | 'lost' | 'nopos' | 'off', string> = { live: '', stale: '', lost: '', nopos: '', off: '' };

  const read = (who: ActivatedAdmin | undefined) => getAs(admin, who?.login, '/overview/map');

  async function shipper(label: keyof typeof drivers, online: boolean, ageSeconds: number | null, lat = 22.66, lng = 106.25): Promise<void> {
    const hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    const phone = randomPhone();
    phones.push(phone.normalized);
    admin.track(phone.normalized);
    const userId = randomUUID();
    await admin.pool.query(`INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at) VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`, [userId, phone.normalized, hash]);
    const driverId = await createDriverFor(admin.pool, userId, { status: 'ACTIVE' });
    await admin.pool.query('UPDATE app.drivers SET accepting_deliveries = $2 WHERE driver_id = $1::uuid', [driverId, online]);
    if (ageSeconds !== null) {
      await admin.pool.query(`INSERT INTO app.shipper_latest_locations (driver_id, lat, lng, accuracy_m, recorded_at) VALUES ($1::uuid, $2, $3, 20, clock_timestamp() - $4::int * interval '1 second')`, [driverId, lat, lng, ageSeconds]);
    }
    drivers[label] = driverId;
  }

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    both = await activatedAdmin(admin, system, [permission('SHOP'), permission('DRIVER')], `Bản đồ cả hai ${tag}`);
    shopOnly = await activatedAdmin(admin, system, [permission('SHOP')], `Bản đồ quán ${tag}`);
    driverOnly = await activatedAdmin(admin, system, [permission('DRIVER')], `Bản đồ shipper ${tag}`);
    reviewer = await activatedAdmin(admin, system, [permission('DRIVER', { view: true, review: true })], `Bản đồ duyệt shipper ${tag}`);
    none = await activatedAdmin(admin, system, [permission('CUSTOMER')], `Bản đồ không app ${tag}`);
    const shopId = await createActiveShopFor(admin.pool, system.account.userId);
    shopIds.push(shopId);
    const zone = randomUUID();
    zoneIds.push(zone);
    await admin.pool.query(`INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at, coverage_lat, coverage_lng, coverage_radius_m) VALUES ($1::uuid, $2, 'Vùng bản đồ', 'ACTIVE', 1, now(), now(), 22.665, 106.258, 8000)`, [zone, `ZT-MAP-${tag}`]);
    await shipper('live', true, 30);
    await shipper('stale', true, 300, 22.67, 106.26);
    await shipper('lost', true, 900);
    await shipper('nopos', true, null);
    await shipper('off', false, 30);
  });

  afterAll(async () => {
    try {
      await admin.pool.query('DELETE FROM app.shipper_latest_locations WHERE driver_id = ANY($1::uuid[])', [Object.values(drivers)]);
      await purgeGrants(admin.pool);
      await admin.pool.query('DELETE FROM app.service_areas WHERE service_area_id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM app.shops s WHERE s.service_area_id = service_areas.service_area_id)', [zoneIds]);
      for (const phone of phones) await purgePhone(admin.pool, phone);
      await admin.pool.query('DELETE FROM app.shop_members WHERE shop_id = ANY($1::uuid[])', [shopIds]);
      await purgeShopDisplayCodes(admin.pool, shopIds);
      await admin.pool.query('DELETE FROM app.shops WHERE shop_id = ANY($1::uuid[])', [shopIds]);
    } finally {
      await admin.close();
    }
  });

  it('no session is 401; an ADMIN without a SHOP or DRIVER view is forbidden; a query string is refused', async () => {
    expect([(await read(undefined)).status, adminErrorCode(await read(undefined))]).toEqual([401, 'ADMIN_SESSION_INVALID']);
    expect([(await read(none)).status, adminErrorCode(await read(none))]).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect((await getAs(admin, both.login, '/overview/map?x=1')).status).toBe(400);
  });

  it('SHOP+DRIVER sees the zone, the shop pin and the Shippers by freshness: LIVE and STALE are drawn, LOST and "no position" only counted, Offline absent', async () => {
    const data = adminData(await read(both)) as Json;
    expect((data.zones as Json[]).some((z) => z.name === 'Vùng bản đồ' && z.coverage.radius_m === 8000)).toBe(true);
    expect((data.shops as Json[]).some((s) => shopIds.includes(s.shop_id))).toBe(true);
    const byId = new Map((data.shippers as Json[]).map((s) => [s.driver_id as string, s]));
    expect(byId.get(drivers.live)).toMatchObject({ freshness: 'LIVE' });
    expect(byId.get(drivers.stale)).toMatchObject({ freshness: 'STALE' });
    for (const hidden of [drivers.lost, drivers.nopos, drivers.off]) expect(byId.has(hidden)).toBe(false);
    expect(data.shippers_without_position).toBeGreaterThanOrEqual(2);
    expect(data.shippers_online).toBeGreaterThanOrEqual(4);
    // No name without the review right of the DRIVER app.
    expect([...byId.values()].every((s) => s.name === null)).toBe(true);
    expect(data.truncated).toBe(false);
  });

  it('a SHOP-only administrator gets no Shipper data at all (null, not an empty list); a DRIVER-only one gets no shop data; only the review right shows a Shipper name', async () => {
    const shopData = adminData(await read(shopOnly)) as Json;
    expect(shopData.shippers).toBeNull();
    expect(shopData.shippers_online).toBeNull();
    expect(shopData.shippers_without_position).toBeNull();
    expect(Array.isArray(shopData.shops)).toBe(true);
    const driverData = adminData(await read(driverOnly)) as Json;
    expect(driverData.shops).toBeNull();
    expect(driverData.shops_without_pin).toBeNull();
    expect(Array.isArray(driverData.shippers)).toBe(true);
    expect((driverData.shippers as Json[]).every((s) => s.name === null)).toBe(true);
    const named = (adminData(await read(reviewer)) as Json).shippers as Json[];
    expect(named.find((s) => s.driver_id === drivers.live)?.name).toBe('Fixture driver');
  });

  it('a permission taken away while the session is open closes the map at the very next request', async () => {
    const watcher = await activatedAdmin(admin, system, [permission('SHOP')], `Bản đồ thu hồi ${tag}`);
    expect((await read(watcher)).status).toBe(200);
    await admin.pool.query("UPDATE app.admin_app_permissions SET can_view = false WHERE user_id = $1::uuid AND app = 'SHOP'", [watcher.userId]);
    expect([(await read(watcher)).status, adminErrorCode(await read(watcher))]).toEqual([403, 'ADMIN_FORBIDDEN']);
  });

  it('SYSTEM sees every part and the read writes nothing (no audit row)', async () => {
    const before = (await admin.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n;
    const response = await getAs(admin, systemLoginOf(system), '/overview/map');
    expect(response.status).toBe(200);
    const data = adminData(response) as Json;
    expect(Array.isArray(data.shops)).toBe(true);
    expect(Array.isArray(data.shippers)).toBe(true);
    expect((await admin.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs')).rows[0]?.n).toBe(before);
  });
});
