import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, countRows, dataOf, registerUser, startAuthApp } from './support/auth-fixtures';
import { createCategory, createItem, createItemWithPicture, discoveryShops, itemAction, publicShop, purgeCategories, uploadImage, jpegBase64 } from './support/menu-fixtures';
import { createShopOwner, getShop, hoursBody, interval, putHours } from './support/shop-management-fixtures';

// Issue #190 — the shop setup checklist (x/4) and the automatic activation, through the REAL Nest pipeline on a REAL PostgreSQL.
// The server decides from real rows: account, shop info + schedule, a pickup point, a first sellable dish (VISIBLE, price > 0). Pictures are optional.
describe('issue #190 — shop setup checklist and automatic activation', () => {
  let app: AuthApp;
  let group: string;

  beforeAll(async () => {
    app = await startAuthApp();
    group = await createCategory(app.pool, 'Nhóm thiết lập 190', 'ACTIVE', 1);
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

  type Json = Record<string, unknown>;
  const setupOf = async (token: string | undefined): Promise<Json | null> => {
    const response = await app.call('GET', '/onboarding/shop/setup', token === undefined ? {} : { bearer: token });
    expect(response.status).toBe(200);
    return response.body.data as unknown as Json | null;
  };
  const activations = (shopId: string): Promise<number> => countRows(app.pool, `SELECT 1 FROM app.audit_logs WHERE resource_id = $1 AND action = 'shop.auto_activated.v1'`, [shopId]);
  const activationEvents = (shopId: string): Promise<number> => countRows(app.pool, `SELECT 1 FROM app.outbox_events WHERE resource_id = $1 AND event_type = 'shop.activated.v1'`, [shopId]);
  const versionOf = async (shopId: string): Promise<number> => Number((await app.pool.query<{ version: string }>('SELECT version::text AS version FROM app.shops WHERE shop_id = $1::uuid', [shopId])).rows[0]?.version);
  const everyDay = (): ReturnType<typeof interval>[] => [1, 2, 3, 4, 5, 6, 7].map((weekday) => interval(weekday, 0, 1440));
  const isPublic = async (shopId: string): Promise<boolean> => (await publicShop(app, shopId)).status === 200;
  const dish = (over: Json = {}): Json => ({ name: 'Bún riêu', price_vnd: 40000, category_id: group, ...over });

  it('a new owner sees 2/4 (account, point) and a clear list of what is missing; the shop is not public and takes no order', async () => {
    const owner = await createShopOwner(app);
    const view = (await setupOf(owner.token)) as Json;
    expect(view).toMatchObject({
      shop_id: owner.shopId,
      status: 'ACTIVE',
      state: 'INCOMPLETE',
      completed_steps: 2,
      total_steps: 4,
      missing: ['BUSINESS_HOURS', 'SELLABLE_ITEM'],
      public: false,
      activated: false,
      request: null,
      lock: null,
    });
    expect(view.steps).toEqual([
      { key: 'ACCOUNT', done: true, missing: [] },
      { key: 'SHOP_INFO', done: false, missing: ['BUSINESS_HOURS'] },
      { key: 'LOCATION', done: true, missing: [] },
      { key: 'FIRST_ITEM', done: false, missing: ['SELLABLE_ITEM'] },
    ]);
    expect(view.availability).toMatchObject({ online: false, reason: 'NO_BUSINESS_HOURS' });
    expect(await isPublic(owner.shopId)).toBe(false);
    expect(await activations(owner.shopId)).toBe(0);
  });

  it('the answer needs a session and only ever describes the caller\'s own shop (none: null)', async () => {
    expect((await app.call('GET', '/onboarding/shop/setup', {})).status).toBe(401);
    const stranger = await registerUser(app);
    expect(await setupOf(stranger.accessToken)).toBeNull();
    const owner = await createShopOwner(app);
    const other = await createShopOwner(app);
    expect((await setupOf(owner.token) as Json).shop_id).toBe(owner.shopId);
    expect((await setupOf(other.token) as Json).shop_id).toBe(other.shopId);
  });

  it('completes setup with a dish WITHOUT a picture; a photo added later does not trigger a second activation', async () => {
    const owner = await createShopOwner(app);
    const version = await versionOf(owner.shopId);
    // Step "schedule": the owner can set the schedule although the setup is not complete (the conditions never block editing).
    expect((await putHours(app, owner.token, hoursBody(everyDay(), version))).status).toBe(200);
    expect(await setupOf(owner.token)).toMatchObject({ completed_steps: 3, missing: ['SELLABLE_ITEM'], public: false });
    // The first VISIBLE dish with a positive price is sufficient, even when image_id is NULL.
    const bare = await createItem(app, owner.token, dish({ image_id: null }));
    expect(bare.status).toBe(201);
    expect(await activations(owner.shopId)).toBe(1);
    expect(await activationEvents(owner.shopId)).toBe(1);
    const done = (await setupOf(owner.token)) as Json;
    expect(done).toMatchObject({ state: 'ACTIVATED', completed_steps: 4, missing: [], public: true, activated: true, request: null });
    expect(String(done.activated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await activations(owner.shopId)).toBe(1);
    expect(await activationEvents(owner.shopId)).toBe(1);
    expect(await app.pool.query(`SELECT actor_type, actor_id, outcome FROM app.audit_logs WHERE resource_id = $1 AND action = 'shop.auto_activated.v1'`, [owner.shopId]).then((r) => r.rows[0])).toEqual({ actor_type: 'SYSTEM', actor_id: null, outcome: 'SUCCESS' });
    // The activation does not advance the profile version (an open edit form stays valid) and nothing asked an administrator.
    expect(await versionOf(owner.shopId)).toBe(version + 1);
    // Customers see it at once: the direct link, the shop list and the contact.
    expect((await publicShop(app, owner.shopId)).status).toBe(200);
    expect(dataOf(await publicShop(app, owner.shopId)).contact).toMatchObject({ phone: '+84900000001' });
    const listed = dataOf(await discoveryShops(app, { area_id: owner.areaId })).shops as { shop_id: string }[];
    expect(listed.map((shop) => shop.shop_id)).toContain(owner.shopId);
    // Reading it again, from anywhere, changes and logs nothing.
    for (let index = 0; index < 3; index += 1) {
      expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED' });
    }
    expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ reason: 'ONLINE', online: true });
    expect(await activations(owner.shopId)).toBe(1);
    // Adding an optional picture afterwards changes only the dish, not the activation record.
    const upload = await uploadImage(app, owner.token, { content_type: 'image/jpeg', data_base64: jpegBase64() });
    const imageId = String(dataOf(upload).image_id);
    const item = dataOf(bare).item as Json;
    const updated = await app.call('PUT', `/shop/me/menu/items/${String(item.item_id)}`, {
      bearer: owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: { expected_version: item.version, ...dish({ image_id: imageId }) },
    });
    expect(updated.status).toBe(200);
    // Removing it through the owner API also leaves readiness and activation unchanged.
    const removed = await app.call('PUT', `/shop/me/menu/items/${String(item.item_id)}`, {
      bearer: owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: { expected_version: (dataOf(updated).item as Json).version, ...dish({ image_id: null }) },
    });
    expect(removed.status).toBe(200);
    expect(await isPublic(owner.shopId)).toBe(true);
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED', completed_steps: 4 });
    expect(await activations(owner.shopId)).toBe(1);
    expect(await activationEvents(owner.shopId)).toBe(1);
  });

  it('two changes that complete the setup at the same moment activate it exactly once', async () => {
    const owner = await createShopOwner(app);
    const version = await versionOf(owner.shopId);
    const [hours, created] = await Promise.all([
      putHours(app, owner.token, hoursBody(everyDay(), version)),
      createItemWithPicture(app, owner.token, dish({ name: 'Bánh cuốn' })),
    ]);
    expect([hours.status, created.status]).toEqual([200, 201]);
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED', completed_steps: 4 });
    expect(await activations(owner.shopId)).toBe(1);
    expect(await activationEvents(owner.shopId)).toBe(1);
  });

  it('losing a condition later hides the shop and blocks new orders at once ("Cần kiểm tra"), keeps the activation record, and returns when the dish is shown again', async () => {
    const owner = await createShopOwner(app);
    const version = await versionOf(owner.shopId);
    await putHours(app, owner.token, hoursBody(everyDay(), version));
    const created = await createItemWithPicture(app, owner.token, dish());
    const item = dataOf(created).item as Json;
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED' });
    expect(await isPublic(owner.shopId)).toBe(true);
    // No dish on sale any more.
    expect((await itemAction(app, owner.token, String(item.item_id), 'hide', Number(item.version))).status).toBe(200);
    expect(await setupOf(owner.token)).toMatchObject({ state: 'NEEDS_REVIEW', completed_steps: 3, missing: ['SELLABLE_ITEM'], public: false, activated: true });
    expect(await isPublic(owner.shopId)).toBe(false);
    expect(dataOf(await getShop(app, owner.token)).availability).toMatchObject({ online: false, reason: 'NO_SELLABLE_ITEM' });
    expect((await app.call('GET', `/shops/${owner.shopId}/reviews`, {})).status).toBe(403);
    expect((await fetch(`${app.running.baseUrl}/v1/shops/${owner.shopId}/logo`)).status).toBe(404);
    const listed = dataOf(await discoveryShops(app, { area_id: owner.areaId })).shops as { shop_id: string }[];
    expect(listed.map((shop) => shop.shop_id)).not.toContain(owner.shopId);
    // Showing it again restores it with NO second activation row.
    expect((await itemAction(app, owner.token, String(item.item_id), 'show', Number(item.version) + 1)).status).toBe(200);
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED' });
    expect(await isPublic(owner.shopId)).toBe(true);
    expect(await activations(owner.shopId)).toBe(1);
  });

  it('legacy data with an image-less sellable dish (no activation ever recorded) is activated by the first read, once; the migration backfill is not needed for it to be public', async () => {
    const owner = await createShopOwner(app);
    await app.pool.query(`INSERT INTO app.shop_business_hours (shop_id, weekday, start_minute, end_minute, end_day_offset) SELECT $1::uuid, d, 0, 1440, 0 FROM generate_series(1, 7) d`, [owner.shopId]);
    await app.pool.query(
      `INSERT INTO app.menu_items (item_id, shop_id, category_id, name, price_vnd, status, image_id, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'Món cũ', 25000, 'VISIBLE', NULL, 1, clock_timestamp(), clock_timestamp())`,
      [randomUUID(), owner.shopId, group],
    );
    expect(await isPublic(owner.shopId)).toBe(true); // public by the real data, whatever the record says
    expect(await activations(owner.shopId)).toBe(0);
    const reads = await Promise.all([setupOf(owner.token), setupOf(owner.token), setupOf(owner.token)]);
    for (const view of reads) {
      expect(view).toMatchObject({ state: 'ACTIVATED', completed_steps: 4 });
    }
    expect(await activations(owner.shopId)).toBe(1);
    expect(await setupOf(owner.token)).toMatchObject({ activated: true });
  });

  it('a locked shop or owner account reads LOCKED and is neither public nor activated', async () => {
    const owner = await createShopOwner(app);
    const version = await versionOf(owner.shopId);
    await putHours(app, owner.token, hoursBody(everyDay(), version));
    await createItemWithPicture(app, owner.token, dish());
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED', lock: null });
    await app.pool.query(`UPDATE app.shops SET status = 'DISABLED' WHERE shop_id = $1::uuid`, [owner.shopId]);
    expect(await setupOf(owner.token)).toMatchObject({ state: 'LOCKED', lock: 'ADMIN', public: false });
    expect(await isPublic(owner.shopId)).toBe(false);
    await app.pool.query(`UPDATE app.shops SET status = 'ACTIVE' WHERE shop_id = $1::uuid`, [owner.shopId]);
    await app.pool.query(`UPDATE app.users SET status = 'DISABLED' WHERE user_id = $1::uuid`, [owner.userId]);
    // The owner's own session is refused with a locked account; what customers see is the same "not available".
    expect((await app.call('GET', '/onboarding/shop/setup', { bearer: owner.token })).status).toBeGreaterThanOrEqual(400);
    expect(await isPublic(owner.shopId)).toBe(false);
  });

  it('an administrator request is shown to the owner in the checklist and is cleared by the activation', async () => {
    const owner = await createShopOwner(app);
    await app.pool.query(`UPDATE app.shops SET setup_request_note = 'Bổ sung giờ và món', setup_request_at = clock_timestamp() WHERE shop_id = $1::uuid`, [owner.shopId]);
    const asked = (await setupOf(owner.token)) as Json;
    expect(asked).toMatchObject({ state: 'NEEDS_REVIEW', request: { note: 'Bổ sung giờ và món' } });
    const version = await versionOf(owner.shopId);
    await putHours(app, owner.token, hoursBody(everyDay(), version));
    await createItemWithPicture(app, owner.token, dish());
    expect(await setupOf(owner.token)).toMatchObject({ state: 'ACTIVATED', request: null });
    expect(await activations(owner.shopId)).toBe(1);
  });
});
