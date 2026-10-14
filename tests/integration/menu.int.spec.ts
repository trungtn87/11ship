import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AuthApp, createServiceArea, dataOf, errorCode, startAuthApp } from './support/auth-fixtures';
import {
  createCategory,
  createItem,
  getMenu,
  itemAction,
  jpegBase64,
  pngBase64,
  publicShop,
  purgeCategories,
  updateItem,
  uploadImage,
} from './support/menu-fixtures';
import { createShopOwner, insertHours, ShopOwner } from './support/shop-management-fixtures';

// M02-MON / M02-XEM — the menu and the public shop view through the REAL Nest pipeline on a REAL PostgreSQL.
describe('M02 — menu and public shop view', () => {
  let app: AuthApp;
  let active: string;
  let second: string;
  let inactive: string;

  beforeAll(async () => {
    app = await startAuthApp();
    active = await createCategory(app.pool, 'Ốc', 'ACTIVE', 1);
    second = await createCategory(app.pool, 'Hải sản', 'ACTIVE', 2);
    inactive = await createCategory(app.pool, 'Đồ uống', 'INACTIVE', 3);
  });

  afterAll(async () => {
    // app.close() purges the owners (and so their dishes and pictures); the groups are removed afterwards on a fresh connection.
    await app.close();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await purgeCategories(pool);
    } finally {
      await pool.end();
    }
  });

  const dish = (categoryId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Ốc hương hấp',
    price_vnd: 120000,
    category_id: categoryId,
    image_id: null,
    ...overrides,
  });

  const itemsOf = (response: Awaited<ReturnType<typeof getMenu>>): Record<string, unknown>[] => dataOf(response).items as Record<string, unknown>[];
  const itemOf = (response: Awaited<ReturnType<typeof getMenu>>): Record<string, unknown> => dataOf(response).item as Record<string, unknown>;

  async function owner(): Promise<ShopOwner> {
    return createShopOwner(app);
  }

  describe('the owner reads and writes dishes', () => {
    it('an empty menu lists the groups (inactive ones with their name) and the limits', async () => {
      const o = await owner();
      const response = await getMenu(app, o.token);
      expect(response.status).toBe(200);
      const data = dataOf(response);
      expect(data.items).toEqual([]);
      expect(data.shop_id).toBe(o.shopId);
      const names = (data.categories as { name: string; status: string }[]).map((c) => `${c.name}:${c.status}`);
      expect(names).toEqual(expect.arrayContaining(['Ốc:ACTIVE', 'Hải sản:ACTIVE', 'Đồ uống:INACTIVE']));
      expect(data.limits).toEqual({ name_max_length: 120, price_max_vnd: 99999999, items_max: 300, image_max_bytes: 2097152 });
    });

    it('creates a dish that is visible at version 1, and the same key replays the very same dish', async () => {
      const o = await owner();
      const key = randomUUID();
      const first = await createItem(app, o.token, dish(active), key);
      expect(first.status).toBe(201);
      const created = itemOf(first);
      expect(created).toMatchObject({ name: 'Ốc hương hấp', price_vnd: 120000, category_id: active, image_id: null, status: 'VISIBLE', version: 1 });
      const replay = await createItem(app, o.token, dish(active), key);
      expect(replay.status).toBe(201);
      expect(itemOf(replay).item_id).toBe(created.item_id);
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(1);
      // The same key with another body is refused before any effect.
      const reused = await createItem(app, o.token, dish(active, { price_vnd: 130000 }), key);
      expect([reused.status, errorCode(reused)]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(1);
    });

    it('trims the name, refuses a bad shape and any privileged extra field', async () => {
      const o = await owner();
      expect(itemOf(await createItem(app, o.token, dish(active, { name: '  Ngao hấp  ' }))).name).toBe('Ngao hấp');
      const bad: Record<string, unknown>[] = [
        dish(active, { name: '   ' }),
        dish(active, { name: 'x'.repeat(121) }),
        dish(active, { price_vnd: 0 }),
        dish(active, { price_vnd: 120000.5 }),
        dish(active, { price_vnd: 100000000 }),
        dish(active, { price_vnd: '120000' }),
        dish('not-a-uuid'),
        { ...dish(active), shop_id: o.shopId },
        { ...dish(active), status: 'HIDDEN' },
      ];
      for (const body of bad) {
        const response = await createItem(app, o.token, body);
        expect(response.status).toBe(400);
      }
      const missing = await createItem(app, o.token, { name: 'A', price_vnd: 1, category_id: active });
      expect(missing.status).toBe(400);
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(1);
    });

    it('needs the SHOP context, and a key', async () => {
      const o = await owner();
      expect((await createItem(app, undefined, dish(active))).status).toBe(401);
      const noKey = await createItem(app, o.token, dish(active), null);
      expect([noKey.status, errorCode(noKey)]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
    });

    it('an unknown or inactive group cannot be chosen for a new dish', async () => {
      const o = await owner();
      for (const categoryId of [inactive, randomUUID()]) {
        const response = await createItem(app, o.token, dish(categoryId));
        expect([response.status, errorCode(response)]).toEqual([400, 'MENU_CATEGORY_NOT_AVAILABLE']);
      }
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(0);
    });

    it('edits at the exact version; a stale version changes nothing; the group may stay inactive but cannot be switched to one', async () => {
      const o = await owner();
      const created = itemOf(await createItem(app, o.token, dish(active)));
      const id = String(created.item_id);
      const ok = await updateItem(app, o.token, id, { ...dish(second, { name: 'Ngao hấp', price_vnd: 60000 }), expected_version: 1 });
      expect(ok.status).toBe(200);
      expect(itemOf(ok)).toMatchObject({ name: 'Ngao hấp', price_vnd: 60000, category_id: second, version: 2 });

      const stale = await updateItem(app, o.token, id, { ...dish(second, { name: 'Muộn' }), expected_version: 1 });
      expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      expect(itemsOf(await getMenu(app, o.token))[0]).toMatchObject({ name: 'Ngao hấp', version: 2 });

      const toInactive = await updateItem(app, o.token, id, { ...dish(inactive), expected_version: 2 });
      expect([toInactive.status, errorCode(toInactive)]).toEqual([400, 'MENU_CATEGORY_NOT_AVAILABLE']);

      // A dish that already sits in a group that was switched off keeps the link and stays editable.
      await app.pool.query(`UPDATE app.menu_categories SET status = 'INACTIVE', updated_at = clock_timestamp() WHERE category_id = $1::uuid`, [second]);
      try {
        const keep = await updateItem(app, o.token, id, { ...dish(second, { price_vnd: 65000 }), expected_version: 2 });
        expect(keep.status).toBe(200);
        expect(itemOf(keep)).toMatchObject({ category_id: second, price_vnd: 65000, version: 3 });
      } finally {
        await app.pool.query(`UPDATE app.menu_categories SET status = 'ACTIVE', updated_at = clock_timestamp() WHERE category_id = $1::uuid`, [second]);
      }
    });

    it('hide, show and delete move the dish through its states; delete is soft and final', async () => {
      const o = await owner();
      const id = String(itemOf(await createItem(app, o.token, dish(active))).item_id);
      const hidden = await itemAction(app, o.token, id, 'hide', 1);
      expect(itemOf(hidden)).toMatchObject({ status: 'HIDDEN', version: 2 });
      expect(itemsOf(await getMenu(app, o.token))[0]).toMatchObject({ status: 'HIDDEN' });
      const shown = await itemAction(app, o.token, id, 'show', 2);
      expect(itemOf(shown)).toMatchObject({ status: 'VISIBLE', version: 3 });
      const stale = await itemAction(app, o.token, id, 'hide', 2);
      expect([stale.status, errorCode(stale)]).toEqual([409, 'VERSION_CONFLICT']);
      const gone = await itemAction(app, o.token, id, 'delete', 3);
      expect(gone.status).toBe(200);
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(0);
      // The row stays (soft delete), and nothing can revive or edit it.
      const row = await app.pool.query(`SELECT status, deleted_at FROM app.menu_items WHERE item_id = $1::uuid`, [id]);
      expect(row.rows[0]).toMatchObject({ status: 'DELETED' });
      expect(row.rows[0].deleted_at).not.toBeNull();
      for (const response of [
        await itemAction(app, o.token, id, 'show', 4),
        await itemAction(app, o.token, id, 'delete', 4),
        await updateItem(app, o.token, id, { ...dish(active), expected_version: 4 }),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([404, 'MENU_ITEM_NOT_FOUND']);
      }
    });

    it('a replayed hide returns the stored answer and does not advance the version twice', async () => {
      const o = await owner();
      const id = String(itemOf(await createItem(app, o.token, dish(active))).item_id);
      const key = randomUUID();
      const a = await itemAction(app, o.token, id, 'hide', 1, key);
      const b = await itemAction(app, o.token, id, 'hide', 1, key);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(itemOf(b)).toEqual(itemOf(a));
      expect(itemsOf(await getMenu(app, o.token))[0]).toMatchObject({ version: 2 });
    });

    it('a dish of another shop is never reachable, and a malformed id names nothing', async () => {
      const a = await owner();
      const b = await owner();
      const id = String(itemOf(await createItem(app, a.token, dish(active))).item_id);
      for (const response of [
        await itemAction(app, b.token, id, 'hide', 1),
        await itemAction(app, b.token, id, 'delete', 1),
        await updateItem(app, b.token, id, { ...dish(active), expected_version: 1 }),
        await itemAction(app, b.token, 'not-a-uuid', 'hide', 1),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([404, 'MENU_ITEM_NOT_FOUND']);
      }
      expect(itemsOf(await getMenu(app, b.token))).toEqual([]);
      expect(itemsOf(await getMenu(app, a.token))[0]).toMatchObject({ status: 'VISIBLE', version: 1 });
    });

    it('a DISABLED shop can read its menu but nothing can be written; an INCOMPLETE one cannot write either', async () => {
      const o = await owner();
      const id = String(itemOf(await createItem(app, o.token, dish(active))).item_id);
      await app.pool.query(`UPDATE app.shops SET status = 'DISABLED', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [o.shopId]);
      expect(itemsOf(await getMenu(app, o.token))).toHaveLength(1);
      for (const response of [
        await createItem(app, o.token, dish(active)),
        await updateItem(app, o.token, id, { ...dish(active), expected_version: 1 }),
        await itemAction(app, o.token, id, 'hide', 1),
        await uploadImage(app, o.token, { content_type: 'image/jpeg', data_base64: jpegBase64() }),
      ]) {
        expect([response.status, errorCode(response)]).toEqual([403, 'SHOP_DISABLED']);
      }
      await app.pool.query(`UPDATE app.shops SET status = 'INCOMPLETE', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [o.shopId]);
      const incomplete = await createItem(app, o.token, dish(active));
      expect([incomplete.status, errorCode(incomplete)]).toEqual([409, 'SHOP_PROFILE_INCOMPLETE']);
    });

    it('writes one audit row and one outbox event per committed change and none for a replay', async () => {
      const o = await owner();
      const key = randomUUID();
      const created = await createItem(app, o.token, dish(active), key);
      const id = String(itemOf(created).item_id);
      await createItem(app, o.token, dish(active), key);
      const audits = await app.pool.query(`SELECT count(*)::int AS n FROM app.audit_logs WHERE resource_type = 'menu_item' AND resource_id = $1`, [id]);
      const events = await app.pool.query(`SELECT count(*)::int AS n FROM app.outbox_events WHERE resource_type = 'menu_item' AND resource_id = $1`, [id]);
      expect([audits.rows[0].n, events.rows[0].n]).toEqual([1, 1]);
    });
  });

  describe('pictures', () => {
    it('stores a valid picture, serves it publicly by its id with its own type, and a dish may point at it', async () => {
      const o = await owner();
      const upload = await uploadImage(app, o.token, { content_type: 'image/jpeg', data_base64: jpegBase64() });
      expect(upload.status).toBe(201);
      const imageId = String(dataOf(upload).image_id);
      const response = await fetch(`${app.running.baseUrl}/v1/menu-images/${imageId}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(response.headers.get('cache-control')).toContain('immutable');
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      const created = await createItem(app, o.token, dish(active, { image_id: imageId }));
      expect(itemOf(created).image_id).toBe(imageId);
      // A picture can be dropped from a dish by saving it without one; the stored picture is untouched.
      const dropped = await updateItem(app, o.token, String(itemOf(created).item_id), { ...dish(active), expected_version: 1 });
      expect(itemOf(dropped).image_id).toBeNull();
      expect((await fetch(`${app.running.baseUrl}/v1/menu-images/${imageId}`)).status).toBe(200);
    });

    it('refuses a picture whose bytes are not the declared format, a wrong type, bad base64 and an oversized one', async () => {
      const o = await owner();
      const cases: Record<string, unknown>[] = [
        { content_type: 'image/png', data_base64: jpegBase64() },
        { content_type: 'image/gif', data_base64: jpegBase64() },
        { content_type: 'image/jpeg', data_base64: Buffer.from('<svg/>').toString('base64') },
        { content_type: 'image/jpeg', data_base64: 'not base64!' },
        { content_type: 'image/jpeg', data_base64: '' },
        { content_type: 'image/jpeg', data_base64: jpegBase64(2_097_152) },
      ];
      for (const body of cases) {
        const response = await uploadImage(app, o.token, body);
        expect([response.status, errorCode(response)]).toEqual([400, 'INVALID_MENU_IMAGE']);
      }
      const extra = await uploadImage(app, o.token, { content_type: 'image/png', data_base64: pngBase64(), shop_id: o.shopId });
      expect(extra.status).toBe(400);
      const count = await app.pool.query(`SELECT count(*)::int AS n FROM app.menu_images WHERE shop_id = $1::uuid`, [o.shopId]);
      expect(count.rows[0].n).toBe(0);
    });

    it('accepts a picture up to the limit (a body larger than the default JSON limit)', async () => {
      const o = await owner();
      const response = await uploadImage(app, o.token, { content_type: 'image/jpeg', data_base64: jpegBase64(2_097_152 - 4) });
      expect(response.status).toBe(201);
      expect(dataOf(response).byte_size).toBe(2_097_152);
    });

    it("a dish cannot point at another shop's picture or a picture that does not exist", async () => {
      const a = await owner();
      const b = await owner();
      const foreign = String(dataOf(await uploadImage(app, a.token, { content_type: 'image/png', data_base64: pngBase64() })).image_id);
      for (const imageId of [foreign, randomUUID()]) {
        const response = await createItem(app, b.token, dish(active, { image_id: imageId }));
        expect([response.status, errorCode(response)]).toEqual([400, 'INVALID_MENU_IMAGE']);
      }
    });

    it('answers 404 for an unknown or malformed picture id', async () => {
      for (const id of [randomUUID(), 'nope']) {
        const response = await fetch(`${app.running.baseUrl}/v1/menu-images/${id}`);
        expect(response.status).toBe(404);
      }
    });
  });

  describe('the public view of a shop (customers, no session)', () => {
    it('shows an ACTIVE shop that has no schedule: the chip says so, the menu is there, and no private field leaks', async () => {
      const o = await owner();
      await createItem(app, o.token, dish(active, { name: 'Ốc hương hấp' }));
      await createItem(app, o.token, dish(second, { name: 'Mực nướng', price_vnd: 150000 }));
      const response = await publicShop(app, o.shopId);
      expect(response.status).toBe(200);
      const data = dataOf(response);
      expect(Object.keys(data).sort()).toEqual(['address_text', 'availability', 'categories', 'hours', 'name', 'shop_id', 'timezone'].sort());
      expect(data).toMatchObject({ shop_id: o.shopId, name: 'Fixture shop', address_text: 'Fixture address', timezone: 'Asia/Ho_Chi_Minh' });
      expect((data.availability as Record<string, unknown>).reason).toBe('NO_BUSINESS_HOURS');
      const categories = data.categories as { name: string; items: { name: string; price_vnd: number }[] }[];
      expect(categories.map((c) => c.name)).toEqual(['Ốc', 'Hải sản']);
      expect(categories[1]?.items).toEqual([expect.objectContaining({ name: 'Mực nướng', price_vnd: 150000 })]);
      expect(response.text).not.toMatch(/contact_phone|zalo|facebook|pickup_|user_id|accepting/i);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('a hidden or deleted dish is gone for customers and a hidden-only group disappears; showing it brings it back', async () => {
      const o = await owner();
      const id = String(itemOf(await createItem(app, o.token, dish(active))).item_id);
      expect((dataOf(await publicShop(app, o.shopId)).categories as unknown[]).length).toBe(1);
      await itemAction(app, o.token, id, 'hide', 1);
      expect(dataOf(await publicShop(app, o.shopId)).categories).toEqual([]);
      await itemAction(app, o.token, id, 'show', 2);
      expect((dataOf(await publicShop(app, o.shopId)).categories as unknown[]).length).toBe(1);
      await itemAction(app, o.token, id, 'delete', 3);
      expect(dataOf(await publicShop(app, o.shopId)).categories).toEqual([]);
    });

    it('a dish whose group was switched off stays visible (the link is kept, it is not a reason to hide it)', async () => {
      const o = await owner();
      const gone = await createCategory(app.pool, 'Tạm ngưng', 'ACTIVE', 9);
      await createItem(app, o.token, dish(gone, { name: 'Món nhóm cũ' }));
      await app.pool.query(`UPDATE app.menu_categories SET status = 'INACTIVE', updated_at = clock_timestamp() WHERE category_id = $1::uuid`, [gone]);
      const categories = dataOf(await publicShop(app, o.shopId)).categories as { name: string; items: unknown[] }[];
      expect(categories.map((c) => c.name)).toEqual(['Tạm ngưng']);
      const menu = dataOf(await getMenu(app, o.token)).categories as { name: string; status: string }[];
      expect(menu).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Tạm ngưng', status: 'INACTIVE' })]));
    });

    it('reports the schedule: ONLINE inside an interval, OUTSIDE outside it, the hours as saved', async () => {
      const o = await owner();
      await insertHours(app.pool, o.shopId, [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 0, end_minute: 1440, end_day_offset: 0 })));
      const open = dataOf(await publicShop(app, o.shopId));
      expect((open.availability as Record<string, unknown>).reason).toBe('ONLINE');
      expect(open.hours as unknown[]).toHaveLength(7);
      await app.pool.query('DELETE FROM app.shop_business_hours WHERE shop_id = $1::uuid', [o.shopId]);
      // one minute that is certainly not now: every day 04:00-04:01 Vietnam time, unless that is now (then 16:00-16:01)
      const now = new Date();
      const vnMinute = (now.getUTCHours() * 60 + now.getUTCMinutes() + 7 * 60) % 1440;
      const start = vnMinute >= 230 && vnMinute <= 250 ? 960 : 240;
      await insertHours(app.pool, o.shopId, [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: start, end_minute: start + 1, end_day_offset: 0 })));
      const closed = dataOf(await publicShop(app, o.shopId));
      expect((closed.availability as Record<string, unknown>).reason).toBe('OUTSIDE_BUSINESS_HOURS');
      expect(closed.categories).toEqual([]);
    });

    it('answers NOT_FOUND for an unknown or malformed id and UNAVAILABLE (never the reason) for a shop that is not shown', async () => {
      for (const id of [randomUUID(), 'nope']) {
        const response = await publicShop(app, id);
        expect([response.status, errorCode(response)]).toEqual([404, 'SHOP_NOT_FOUND']);
      }
      const o = await owner();
      await createItem(app, o.token, dish(active));
      const closedArea = await createServiceArea(app.pool, 'INACTIVE');
      const cases: [string, string, unknown[]][] = [
        ['DISABLED', `UPDATE app.shops SET status = 'DISABLED', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [o.shopId]],
        ['INCOMPLETE', `UPDATE app.shops SET status = 'INCOMPLETE', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [o.shopId]],
        ['AREA', `UPDATE app.shops SET status = 'ACTIVE', service_area_id = $2::uuid, updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [o.shopId, closedArea]],
      ];
      for (const [, sql, values] of cases) {
        await app.pool.query(sql, values);
        const response = await publicShop(app, o.shopId);
        expect([response.status, errorCode(response)]).toEqual([403, 'SHOP_UNAVAILABLE']);
        expect(response.text).not.toMatch(/DISABLED|INCOMPLETE|INACTIVE|SERVICE_AREA/);
      }
    });
  });
});
