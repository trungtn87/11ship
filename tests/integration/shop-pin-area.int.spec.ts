import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, countRows, dataOf, errorCode, startAuthApp } from './support/auth-fixtures';
import { insertDeliveryRow } from './support/delivery-fixtures';
import { createCategory, createItemWithPicture, discoveryShops, itemAction, publicShop, purgeCategories } from './support/menu-fixtures';
import { completeSetup, createShopOwner, getShop, profileBody, putProfile, ShopOwner } from './support/shop-management-fixtures';

// Issue #252 — the pickup pin against the circle the server configured for the chosen service area, the administrator's request after a shop was
// activated, and the public rules built on the same pin test. REAL Nest pipeline on a REAL PostgreSQL; fixtures are fake areas and shops.
//
// Geometry used: centre (21.0000, 105.0000), radius 5000 m. One degree of latitude is 111194.9 m on the sphere the server uses, so
// a pin `d` metres north of the centre is lat = 21 + d / 111194.9.
const CENTRE = { lat: 21, lng: 105 };
const RADIUS_M = 5000;
const northOf = (metres: number): { lat: number; lng: number } => ({ lat: CENTRE.lat + metres / 111194.9266, lng: CENTRE.lng });

describe('issue #252 — pickup pin, configured service area and public consistency', () => {
  let app: AuthApp;
  let group: string;
  const areas: string[] = [];

  beforeAll(async () => {
    app = await startAuthApp();
    group = await createCategory(app.pool, 'Nhóm ghim vùng 252', 'ACTIVE', 1);
  });

  afterAll(async () => {
    await app.close();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await purgeCategories(pool);
    } finally {
      await pool.end();
    }
  });

  async function area(coverage: { lat: number; lng: number; radius: number } | null, status = 'ACTIVE'): Promise<string> {
    const id = randomUUID();
    await app.pool.query(
      `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at, coverage_lat, coverage_lng, coverage_radius_m)
       VALUES ($1::uuid, $2, 'Vùng thử 252', $3, 1, clock_timestamp(), clock_timestamp(), $4, $5, $6)`,
      [id, `ZT-${id}`, status, coverage?.lat ?? null, coverage?.lng ?? null, coverage?.radius ?? null],
    );
    areas.push(id);
    return id;
  }
  const circleArea = (): Promise<string> => area({ ...CENTRE, radius: RADIUS_M });
  const shopRow = async (shopId: string) => (await app.pool.query<{ pickup_lat: number; pickup_lng: number; service_area_id: string; version: string }>('SELECT pickup_lat, pickup_lng, service_area_id, version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [shopId])).rows[0]!;
  const versionOf = async (shopId: string): Promise<number> => Number((await shopRow(shopId)).version);
  const save = (owner: ShopOwner, version: number, over: Record<string, unknown>) => putProfile(app, owner.token, profileBody(owner, { expected_version: version, ...over }));
  const setupOf = async (owner: ShopOwner): Promise<Record<string, unknown>> => {
    const response = await app.call('GET', '/onboarding/shop/setup', { bearer: owner.token });
    expect(response.status).toBe(200);
    return response.body.data as unknown as Record<string, unknown>;
  };
  const listed = async (areaId: string): Promise<string[]> => (dataOf(await discoveryShops(app, { area_id: areaId })).shops as { shop_id: string }[]).map((shop) => shop.shop_id);

  it('(a) a pin inside the configured circle is stored with GPS never involved, and read back', async () => {
    const owner = await createShopOwner(app, { areaId: await circleArea() });
    const pin = northOf(1200);
    const saved = await save(owner, await versionOf(owner.shopId), { pickup_lat: pin.lat, pickup_lng: pin.lng });
    expect(saved.status).toBe(200);
    const row = await shopRow(owner.shopId);
    expect([row.pickup_lat, row.pickup_lng]).toEqual([pin.lat, pin.lng]);
    expect(dataOf(await getShop(app, owner.token))).toMatchObject({ pickup_lat: pin.lat, pickup_lng: pin.lng });
  });

  it('(b) a pin outside every area is refused with a clear code, nothing is stored, the version does not move and the area is not changed', async () => {
    const owner = await createShopOwner(app, { areaId: await circleArea() });
    const before = await shopRow(owner.shopId);
    const refused = await save(owner, Number(before.version), { pickup_lat: 10.5, pickup_lng: 106.5 });
    expect(refused.status).toBe(422);
    expect(errorCode(refused)).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    expect(await shopRow(owner.shopId)).toEqual(before);
  });

  it('(c) a pin that belongs to area B while the profile says area A is refused; the shop is not moved to B', async () => {
    const a = await circleArea();
    const b = await area({ lat: 16, lng: 108, radius: 8000 });
    const owner = await createShopOwner(app, { areaId: a });
    const before = await shopRow(owner.shopId);
    const refused = await save(owner, Number(before.version), { pickup_lat: 16.0005, pickup_lng: 108.0005, service_area_id: a });
    expect(errorCode(refused)).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    expect((await shopRow(owner.shopId)).service_area_id).toBe(a);
    // The same pin is fine once the owner CHOOSES B: the server never picks it.
    const chosen = await save(owner, Number(before.version), { pickup_lat: 16.0005, pickup_lng: 108.0005, service_area_id: b });
    expect(chosen.status).toBe(200);
    expect((await shopRow(owner.shopId)).service_area_id).toBe(b);
  });

  it('(d) the edge: 4990 m is inside, 5010 m is outside', async () => {
    const owner = await createShopOwner(app, { areaId: await circleArea() });
    const inside = northOf(RADIUS_M - 10);
    const outside = northOf(RADIUS_M + 10);
    const first = await save(owner, await versionOf(owner.shopId), { pickup_lat: inside.lat, pickup_lng: inside.lng });
    expect(first.status).toBe(200);
    const second = await save(owner, await versionOf(owner.shopId), { pickup_lat: outside.lat, pickup_lng: outside.lng });
    expect(errorCode(second)).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
  });

  it('(e) an ACTIVE area without geometry keeps the legacy behaviour: the pin is accepted (not provable), the shop stays public, and it is never called verified', async () => {
    const owner = await createShopOwner(app, { areaId: await area(null) });
    await completeSetup(app, owner, { categoryId: group });
    const saved = await save(owner, await versionOf(owner.shopId), { pickup_lat: 10.5, pickup_lng: 106.5 });
    expect(saved.status).toBe(200);
    expect(await setupOf(owner)).toMatchObject({ state: 'ACTIVATED', public: true });
    expect(await listed(owner.areaId)).toContain(owner.shopId);
  });

  it('(f) editing the pin never touches a delivery that already exists: its pickup snapshot keeps the coordinates it was created with', async () => {
    const owner = await createShopOwner(app, { areaId: await circleArea() });
    const deliveryId = await insertDeliveryRow(app.pool, { shopId: owner.shopId, userId: owner.userId });
    const frozen = (await app.pool.query<{ pickup_lat: number; pickup_lng: number }>('SELECT pickup_lat, pickup_lng FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]!;
    const pin = northOf(800);
    expect((await save(owner, await versionOf(owner.shopId), { pickup_lat: pin.lat, pickup_lng: pin.lng })).status).toBe(200);
    const after = (await app.pool.query<{ pickup_lat: number; pickup_lng: number }>('SELECT pickup_lat, pickup_lng FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId])).rows[0]!;
    expect(after).toEqual(frozen);
    expect(after.pickup_lat).not.toBe(pin.lat);
    // The delivery has served its purpose; the invariant triggers guard updates only, so remove it with them off and leave the shop purgeable.
    const client = await app.pool.connect();
    try {
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
      await client.query('DELETE FROM app.deliveries WHERE delivery_id = $1::uuid', [deliveryId]);
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
    } finally {
      client.release();
    }
  });

  it('(g) a replay of the same key is answered once; a refused pin is not stored by a retry either; read-back after the replay is the same', async () => {
    const owner = await createShopOwner(app, { areaId: await circleArea() });
    const key = randomUUID();
    const pin = northOf(300);
    const body = profileBody(owner, { expected_version: await versionOf(owner.shopId), pickup_lat: pin.lat, pickup_lng: pin.lng });
    const first = await putProfile(app, owner.token, body, key);
    const replay = await putProfile(app, owner.token, body, key);
    expect([first.status, replay.status]).toEqual([200, 200]);
    expect(dataOf(replay).version).toBe(dataOf(first).version);
    const bad = profileBody(owner, { expected_version: await versionOf(owner.shopId), pickup_lat: 10.5, pickup_lng: 106.5 });
    const badKey = randomUUID();
    expect(errorCode(await putProfile(app, owner.token, bad, badKey))).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    expect(errorCode(await putProfile(app, owner.token, bad, badKey))).toBe('PICKUP_OUTSIDE_SERVICE_AREA');
    expect((await shopRow(owner.shopId)).pickup_lat).toBe(pin.lat);
  });

  it('public consistency: a stored pin that falls outside the (moved) circle is neither listed, public nor orderable, says why, and returns with ONE activation', async () => {
    const areaId = await circleArea();
    const owner = await createShopOwner(app, { areaId });
    const pin = northOf(1000);
    expect((await save(owner, await versionOf(owner.shopId), { pickup_lat: pin.lat, pickup_lng: pin.lng })).status).toBe(200);
    await completeSetup(app, owner, { categoryId: group });
    expect(await setupOf(owner)).toMatchObject({ state: 'ACTIVATED', public: true });
    expect(await listed(areaId)).toContain(owner.shopId);
    expect((await publicShop(app, owner.shopId)).status).toBe(200);

    // SYSTEM moves the circle away (what the Admin screen does): the stored pin is now outside it.
    await app.pool.query('UPDATE app.service_areas SET coverage_lat = 16, coverage_lng = 108, version = version + 1 WHERE service_area_id = $1::uuid', [areaId]);
    expect(await setupOf(owner)).toMatchObject({ state: 'NEEDS_REVIEW', public: false, missing: ['PICKUP_OUTSIDE_AREA'] });
    expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ online: false, reason: 'NO_PICKUP_POINT' });
    expect(await listed(areaId)).not.toContain(owner.shopId);
    expect((await publicShop(app, owner.shopId)).status).not.toBe(200);
    expect((await fetch(`${app.running.baseUrl}/v1/shops/${owner.shopId}/logo`)).status).toBe(404);

    await app.pool.query('UPDATE app.service_areas SET coverage_lat = $2, coverage_lng = $3, version = version + 1 WHERE service_area_id = $1::uuid', [areaId, CENTRE.lat, CENTRE.lng]);
    expect(await setupOf(owner)).toMatchObject({ state: 'ACTIVATED', public: true });
    expect(await listed(areaId)).toContain(owner.shopId);
    expect(await countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'shop.auto_activated.v1'`, [owner.shopId])).toBe(1);
  });
});

describe('issue #252 — M02-ADMIN-REQUEST-01: an activated shop that lost a step, got an administrator request and fixed everything', () => {
  let app: AuthApp;
  let group: string;

  beforeAll(async () => {
    app = await startAuthApp();
    group = await createCategory(app.pool, 'Nhóm yêu cầu 252', 'ACTIVE', 1);
  });

  afterAll(async () => {
    await app.close();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await purgeCategories(pool);
    } finally {
      await pool.end();
    }
  });

  const count = (shopId: string, action: string): Promise<number> => countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = $2`, [shopId, action]);
  const events = (shopId: string, type: string): Promise<number> => countRows(app.pool, `SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = $2`, [shopId, type]);
  const setup = async (owner: ShopOwner): Promise<Record<string, unknown>> => (await app.call('GET', '/onboarding/shop/setup', { bearer: owner.token })).body.data as unknown as Record<string, unknown>;

  it('clears the request once when 4/4 holds again, keeps activated_at, emits no second shop.activated and no duplicate history', async () => {
    const owner = await createShopOwner(app);
    await completeSetup(app, owner, { hours: true, dish: false });
    const created = await createItemWithPicture(app, owner.token, { name: 'Bún chả', price_vnd: 40000, category_id: group });
    const item = dataOf(created).item as { item_id: string; version: number };
    expect(await setup(owner)).toMatchObject({ state: 'ACTIVATED' });
    const activatedAt = (await app.pool.query<{ a: string }>('SELECT activated_at::text AS a FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId])).rows[0]!.a;

    // The condition is lost, the administrator asks for completion.
    expect((await itemAction(app, owner.token, item.item_id, 'hide', item.version)).status).toBe(200);
    await app.pool.query(`UPDATE app.shops SET setup_request_note = 'Bổ sung món bán', setup_request_at = clock_timestamp() WHERE shop_id = $1::uuid`, [owner.shopId]);
    expect(await setup(owner)).toMatchObject({ state: 'NEEDS_REVIEW', request: { note: 'Bổ sung món bán' } });

    // The owner fixes it: the very change withdraws the request.
    expect((await itemAction(app, owner.token, item.item_id, 'show', item.version + 1)).status).toBe(200);
    expect(await setup(owner)).toMatchObject({ state: 'ACTIVATED', request: null, public: true });
    expect((await app.pool.query<{ note: string | null; a: string }>('SELECT setup_request_note AS note, activated_at::text AS a FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId])).rows[0]).toEqual({ note: null, a: activatedAt });
    expect(await count(owner.shopId, 'shop.setup_request_auto_cleared.v1')).toBe(1);
    expect(await count(owner.shopId, 'shop.auto_activated.v1')).toBe(1);
    expect(await events(owner.shopId, 'shop.activated.v1')).toBe(1);
    expect(await events(owner.shopId, 'shop.setup_request_cleared.v1')).toBe(1);

    // Reads and a second round of reconcile add nothing.
    await setup(owner);
    await setup(owner);
    expect(await count(owner.shopId, 'shop.setup_request_auto_cleared.v1')).toBe(1);
    expect(await events(owner.shopId, 'shop.activated.v1')).toBe(1);
  });

  it('a condition that is still missing keeps the request; a locked shop is never reopened by it', async () => {
    const owner = await createShopOwner(app);
    await completeSetup(app, owner, { categoryId: group });
    await app.pool.query(`UPDATE app.shop_business_hours SET start_minute = start_minute WHERE shop_id = $1::uuid`, [owner.shopId]);
    await app.pool.query(`DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid`, [owner.shopId]);
    await app.pool.query(`UPDATE app.shops SET setup_request_note = 'Cài giờ', setup_request_at = clock_timestamp() WHERE shop_id = $1::uuid`, [owner.shopId]);
    expect(await setup(owner)).toMatchObject({ state: 'NEEDS_REVIEW', request: { note: 'Cài giờ' } });
    expect(await count(owner.shopId, 'shop.setup_request_auto_cleared.v1')).toBe(0);
    await app.pool.query(`UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid`, [owner.shopId]);
    expect(await app.pool.query('SELECT setup_request_note FROM app.shops WHERE shop_id = $1::uuid', [owner.shopId]).then((r) => r.rows[0]?.setup_request_note)).toBe('Cài giờ');
  });
});
