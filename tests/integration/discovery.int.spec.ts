import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { foldVietnamese } from '../../apps/backend/src/shared/fold-vietnamese';
import { AuthApp, createServiceArea, dataOf, errorCode, startAuthApp } from './support/auth-fixtures';
import { createCategory, createItem, discoveryDishes, discoveryShops, itemAction, purgeCategories } from './support/menu-fixtures';
import { createShopOwner, insertHours, ShopOwner } from './support/shop-management-fixtures';

// M02 discovery (docs/current/M02-discovery-UI-LOCKED-20261016.md) through the REAL Nest pipeline on a REAL PostgreSQL.
describe('M02 — public discovery: areas, groups, shops, dishes, search and filters', () => {
  let app: AuthApp;
  let area: string;
  let otherArea: string;
  let snail: string;
  let seafood: string;
  let drinks: string;
  const reviewIds: string[] = [];

  beforeAll(async () => {
    app = await startAuthApp();
    area = await createServiceArea(app.pool);
    otherArea = await createServiceArea(app.pool);
    snail = await createCategory(app.pool, 'Ốc', 'ACTIVE', 1);
    seafood = await createCategory(app.pool, 'Hải sản', 'ACTIVE', 2);
    drinks = await createCategory(app.pool, 'Đồ uống', 'INACTIVE', 3);
  });

  afterAll(async () => {
    try {
      if (reviewIds.length > 0) {
        const client = await app.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('ALTER TABLE app.reviews DISABLE TRIGGER USER');
          await client.query('DELETE FROM app.reviews WHERE review_id = ANY($1::uuid[])', [reviewIds]);
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');
          await client.query('ALTER TABLE app.reviews ENABLE TRIGGER USER');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      }
    } finally { await app.close(); }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await purgeCategories(pool);
    } finally {
      await pool.end();
    }
  });

  const every = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start_minute: 0, end_minute: 1440, end_day_offset: 0 }));

  /** An ACTIVE shop in `areaId` named `name` with the given dishes (all VISIBLE) and, optionally, open all day. */
  async function shop(name: string, dishes: [string, number, string][], options: { open?: boolean; areaId?: string } = {}): Promise<ShopOwner> {
    const owner = await createShopOwner(app, { areaId: options.areaId ?? area });
    await app.pool.query(`UPDATE app.shops SET name = $2, updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [owner.shopId, name]);
    if (options.open === true) {
      await insertHours(app.pool, owner.shopId, every);
    }
    for (const [dish, price, category] of dishes) {
      const response = await createItem(app, owner.token, { name: dish, price_vnd: price, category_id: category, image_id: null });
      expect(response.status).toBe(201);
    }
    return owner;
  }

  const names = (response: Awaited<ReturnType<typeof discoveryShops>>): string[] => (dataOf(response).shops as { name: string }[]).map((s) => s.name);

  it('returns pickup coordinates and public M11 ratings on Home and dish-search cards, excluding hidden ratings', async () => {
    const ownArea = await createServiceArea(app.pool);
    const owner = await shop('Quán Điểm Sao', [['Món Điểm Sao', 10000, snail]], { areaId: ownArea });
    for (const [stars, visibility] of [[5, 'VISIBLE'], [3, 'VISIBLE'], [1, 'HIDDEN']] as const) {
      const reviewId = randomUUID();
      reviewIds.push(reviewId);
      await app.pool.query(`INSERT INTO app.reviews
        (review_id, kind, reviewer_user_id, shop_id, order_id, stars, reviewer_name, shop_name, related_code, visibility, created_at)
        VALUES ($1, 'SHOP_BY_CUSTOMER', $2, $3, $4, $5, 'Khách', 'Quán Điểm Sao', 'TEST147', $6, clock_timestamp())`,
        [reviewId, owner.userId, owner.shopId, randomUUID(), stars, visibility]);
    }
    const home = dataOf(await discoveryShops(app, { area_id: ownArea })).shops as Record<string, unknown>[];
    expect(home[0]).toMatchObject({ shop_id: owner.shopId, rating: { count: 2, average: 4 } });
    expect(typeof home[0]?.pickup_lat).toBe('number');
    expect(typeof home[0]?.pickup_lng).toBe('number');
    const found = dataOf(await discoveryDishes(app, { area_id: ownArea, q: 'mon diem sao' })).dishes as { shop: unknown }[];
    expect(found[0]?.shop).toMatchObject({ shop_id: owner.shopId, rating: { count: 2, average: 4 } });
    const unrated = await shop('Chưa Đánh Giá', [['Món Chưa Sao', 10000, snail]], { areaId: ownArea });
    const all = dataOf(await discoveryShops(app, { area_id: ownArea })).shops as { shop_id: string; rating: unknown }[];
    expect(all.find((s) => s.shop_id === unrated.shopId)?.rating).toEqual({ count: 0, average: null });
  });

  it('resolves only ACTIVE configured circles and rejects incomplete or invalid geometry', async () => {
    const first = await createServiceArea(app.pool);
    const second = await createServiceArea(app.pool);
    const inactive = await createServiceArea(app.pool, 'INACTIVE');
    await app.pool.query(`UPDATE app.service_areas SET coverage_lat = 0, coverage_lng = 0, coverage_radius_m = 1000 WHERE service_area_id = $1`, [first]);
    await app.pool.query(`UPDATE app.service_areas SET coverage_lat = 1, coverage_lng = 1, coverage_radius_m = 1000 WHERE service_area_id = $1`, [second]);
    await app.pool.query(`UPDATE app.service_areas SET coverage_lat = 2, coverage_lng = 2, coverage_radius_m = 1000 WHERE service_area_id = $1`, [inactive]);
    const resolve = (lat: number, lng: number) => app.call('GET', `/service-areas/resolve?latitude=${lat}&longitude=${lng}`);
    const located = await resolve(0, 0);
    expect(located.status).toBe(200);
    expect(located.headers.get('cache-control')).toBe('no-store');
    expect(located.body.data).toMatchObject({ service_area_id: first });
    expect((await resolve(1, 1)).body.data).toMatchObject({ service_area_id: second });
    expect((await resolve(2, 2)).body.data).toBeNull();
    expect((await resolve(80, 80)).body.data).toBeNull();
    for (const query of ['latitude=91&longitude=0', 'latitude=0', 'latitude=0&latitude=1&longitude=0', 'latitude=NaN&longitude=0']) {
      expect((await app.call('GET', `/service-areas/resolve?${query}`)).status).toBe(400);
    }
    await expect(app.pool.query('UPDATE app.service_areas SET coverage_lat = 91 WHERE service_area_id = $1', [first])).rejects.toThrow();
    await expect(app.pool.query('UPDATE app.service_areas SET coverage_lng = NULL WHERE service_area_id = $1', [first])).rejects.toThrow();
    await expect(app.pool.query('UPDATE app.service_areas SET coverage_radius_m = 0 WHERE service_area_id = $1', [first])).rejects.toThrow();
  });

  it('lists only the ACTIVE service areas and ACTIVE groups, never cached', async () => {
    const closed = await createServiceArea(app.pool, 'INACTIVE');
    const areas = await app.call('GET', '/service-areas', {});
    expect(areas.status).toBe(200);
    expect(areas.headers.get('cache-control')).toBe('no-store');
    const ids = (areas.body.data as unknown as { service_area_id: string }[]).map((a) => a.service_area_id);
    expect(ids).toEqual(expect.arrayContaining([area, otherArea]));
    expect(ids).not.toContain(closed);
    const groups = (await app.call('GET', '/menu-categories', {})).body.data as unknown as { category_id: string; name: string }[];
    const idsG = groups.map((g) => g.category_id);
    expect(idsG).toEqual(expect.arrayContaining([snail, seafood]));
    expect(idsG).not.toContain(drinks);
    expect(idsG.indexOf(snail)).toBeLessThan(idsG.indexOf(seafood));
  });

  it('shows the shops of the chosen area with a public dish: open ones first, then by name; never other areas or empty shops', async () => {
    const open = await shop('Zeta Quán Mở', [['Ốc len', 90000, snail]], { open: true });
    const closedA = await shop('Alpha Quán Đóng', [['Ngao hấp', 60000, seafood]]);
    await shop('Quán Không Món', []);
    await shop('Quán Khu Khác', [['Mực', 150000, seafood]], { areaId: otherArea });
    const list = await discoveryShops(app, { area_id: area });
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('no-store');
    const data = dataOf(list);
    expect(names(list)).toEqual(['Zeta Quán Mở', 'Alpha Quán Đóng']);
    const first = (data.shops as { availability: { online: boolean; reason: string }; shop_id: string }[])[0]!;
    expect(first.shop_id).toBe(open.shopId);
    expect(first.availability).toEqual({ online: true, reason: 'ONLINE' });
    expect((data.shops as { availability: { reason: string }; shop_id: string }[])[1]!.availability.reason).toBe('NO_BUSINESS_HOURS');
    expect(data.has_more).toBe(false);
    expect(closedA.shopId).toBeTruthy();
    expect(list.text).not.toMatch(/contact_phone|zalo|facebook|accepting|user_id/i);
    expect(names(await discoveryShops(app, { area_id: otherArea }))).toEqual(['Quán Khu Khác']);
  });

  it('an unavailable shop (disabled, incomplete, area stopped) leaves discovery; a hidden or deleted dish leaves with it', async () => {
    const own = await shop('Quán Rút Gọn', [['Sò điệp', 180000, seafood]]);
    expect(names(await discoveryShops(app, { area_id: area, q: 'rut gon' }))).toEqual(['Quán Rút Gọn']);
    const item = (dataOf(await app.call('GET', '/shop/me/menu', { bearer: own.token })).items as { item_id: string; version: number }[])[0]!;
    await itemAction(app, own.token, item.item_id, 'hide', item.version);
    expect(names(await discoveryShops(app, { area_id: area, q: 'rut gon' }))).toEqual([]);
    expect(dataOf(await discoveryDishes(app, { area_id: area, q: 'so diep' })).dishes).toEqual([]);
    await itemAction(app, own.token, item.item_id, 'show', item.version + 1);
    expect(names(await discoveryShops(app, { area_id: area, q: 'rut gon' }))).toEqual(['Quán Rút Gọn']);
    for (const status of ['DISABLED', 'INCOMPLETE']) {
      await app.pool.query(`UPDATE app.shops SET status = $2, updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [own.shopId, status]);
      expect(names(await discoveryShops(app, { area_id: area, q: 'rut gon' }))).toEqual([]);
      expect(dataOf(await discoveryDishes(app, { area_id: area, q: 'so diep' })).dishes).toEqual([]);
    }
    await app.pool.query(`UPDATE app.shops SET status = 'ACTIVE', updated_at = clock_timestamp() WHERE shop_id = $1::uuid`, [own.shopId]);
    const stopped = await createServiceArea(app.pool);
    await app.pool.query(`UPDATE app.shops SET service_area_id = $2::uuid WHERE shop_id = $1::uuid`, [own.shopId, stopped]);
    await app.pool.query(`UPDATE app.service_areas SET status = 'INACTIVE' WHERE service_area_id = $1::uuid`, [stopped]);
    expect(names(await discoveryShops(app, { area_id: stopped }))).toEqual([]);
  });

  it('searches names without caring for case, marks or extra spaces, across the whole data set', async () => {
    await shop('Ốc Hương Đặc Biệt', [['Ốc hương hấp', 120000, snail], ['Đậu phụ', 30000, seafood]]);
    for (const q of ['oc huong', 'ỐC HƯƠNG', '  oc   huong  ', 'dac biet', 'Đặc Biệt']) {
      expect(names(await discoveryShops(app, { area_id: area, q }))).toContain('Ốc Hương Đặc Biệt');
    }
    expect(names(await discoveryShops(app, { area_id: area, q: 'khong co quan nay' }))).toEqual([]);
    const dishes = dataOf(await discoveryDishes(app, { area_id: area, q: 'DAU PHU' })).dishes as { name: string; shop: { name: string; availability: { reason: string } }; price_vnd: number }[];
    expect(dishes).toHaveLength(1);
    expect(dishes[0]).toMatchObject({ name: 'Đậu phụ', price_vnd: 30000, shop: { name: 'Ốc Hương Đặc Biệt', availability: { reason: 'NO_BUSINESS_HOURS' } } });
    // A wildcard typed by the person is a plain character.
    expect(names(await discoveryShops(app, { area_id: area, q: '%' }))).toEqual([]);
    expect(names(await discoveryShops(app, { area_id: area, q: '_' }))).toEqual([]);
  });

  it('a group filter keeps only shops (and dishes) of that group; the open-only filter drops closed shops', async () => {
    const mixed = await shop('Quán Hỗn Hợp Nhóm', [['Ốc xào', 70000, snail]], { open: true });
    await shop('Quán Hải Sản Thuần', [['Cua rang', 250000, seafood]]);
    const bySnail = names(await discoveryShops(app, { area_id: area, category_id: snail }));
    expect(bySnail).toContain('Quán Hỗn Hợp Nhóm');
    expect(bySnail).not.toContain('Quán Hải Sản Thuần');
    const dishesSea = (dataOf(await discoveryDishes(app, { area_id: area, category_id: seafood })).dishes as { name: string }[]).map((d) => d.name);
    expect(dishesSea).toContain('Cua rang');
    expect(dishesSea).not.toContain('Ốc xào');
    const openOnly = await discoveryShops(app, { area_id: area, open_only: 'true' });
    expect(names(openOnly)).toContain('Quán Hỗn Hợp Nhóm');
    expect(names(openOnly)).not.toContain('Quán Hải Sản Thuần');
    expect((dataOf(openOnly).shops as { availability: { online: boolean } }[]).every((s) => s.availability.online)).toBe(true);
    expect(mixed.shopId).toBeTruthy();
  });

  it('a group that was switched off no longer filters, but its dishes stay public in the shop', async () => {
    const owner = await shop('Quán Nhóm Ngừng', [['Trà đá', 5000, seafood]]);
    const dead = await createCategory(app.pool, 'Nhóm sắp ngừng', 'ACTIVE', 8);
    await createItem(app, owner.token, { name: 'Món nhóm cũ', price_vnd: 10000, category_id: dead, image_id: null });
    await app.pool.query(`UPDATE app.menu_categories SET status = 'INACTIVE', updated_at = clock_timestamp() WHERE category_id = $1::uuid`, [dead]);
    expect(((await app.call('GET', '/menu-categories', {})).body.data as unknown as { category_id: string }[]).map((g) => g.category_id)).not.toContain(dead);
    expect(names(await discoveryShops(app, { area_id: area, q: 'nhom ngung' }))).toEqual(['Quán Nhóm Ngừng']);
    const shopView = await app.call('GET', `/shops/${owner.shopId}`, {});
    expect(JSON.stringify(dataOf(shopView).categories)).toContain('Món nhóm cũ');
  });

  it('pages a stable order and says whether there is more', async () => {
    const big = await createServiceArea(app.pool);
    for (const n of ['A1', 'A2', 'A3']) {
      await shop(`Quán Trang ${n}`, [['Món', 1000, snail]], { areaId: big });
    }
    const first = dataOf(await discoveryShops(app, { area_id: big, limit: '2' }));
    expect((first.shops as unknown[]).length).toBe(2);
    expect(first.has_more).toBe(true);
    const second = await discoveryShops(app, { area_id: big, limit: '2', offset: '2' });
    expect(names(second)).toEqual(['Quán Trang A3']);
    expect(dataOf(second).has_more).toBe(false);
  });

  it('pages the dishes exactly in the order of the shops as shown (open first, then name), then dish name: no page repeats or skips a dish', async () => {
    const big = await createServiceArea(app.pool);
    await shop('Mmm Quán Đóng', [['Ốc c', 3000, snail], ['Ốc a', 1000, snail]], { areaId: big });
    await shop('Zzz Quán Mở', [['Ốc b', 2000, snail], ['Ốc d', 4000, snail]], { areaId: big, open: true });
    await shop('Aaa Quán Đóng', [['Ốc e', 5000, snail]], { areaId: big });
    const seen: string[] = [];
    for (const offset of ['0', '2', '4']) {
      const page = await discoveryDishes(app, { area_id: big, q: 'oc', limit: '2', offset });
      expect(page.status).toBe(200);
      const data = dataOf(page);
      seen.push(...(data.dishes as { name: string }[]).map((d) => d.name));
      expect(data.has_more).toBe(offset !== '4');
    }
    // The open shop first (its dishes by name), then the closed shops by name (their dishes by name).
    expect(seen).toEqual(['Ốc b', 'Ốc d', 'Ốc e', 'Ốc a', 'Ốc c']);
    expect(dataOf(await discoveryDishes(app, { area_id: big, q: 'oc', limit: '2', offset: '5' })).dishes).toEqual([]);
    // A group that does not match leaves nothing, and the term still ignores marks and spacing.
    expect(dataOf(await discoveryDishes(app, { area_id: big, q: '  OC   a ', category_id: seafood })).dishes).toEqual([]);
    expect((dataOf(await discoveryDishes(app, { area_id: big, q: '  OC   a ' })).dishes as { name: string }[]).map((d) => d.name)).toEqual(['Ốc a']);
  });

  it('refuses a missing area, a malformed id or number, an unknown or repeated parameter and an over-long term', async () => {
    for (const query of [
      '',
      'area_id=nope',
      `area_id=${area}&category_id=zzz`,
      `area_id=${area}&open_only=yes`,
      `area_id=${area}&limit=0`,
      `area_id=${area}&limit=51`,
      `area_id=${area}&offset=-1`,
      `area_id=${area}&sort=name`,
      `area_id=${area}&area_id=${area}`,
      `area_id=${area}&q=${'x'.repeat(101)}`,
    ]) {
      for (const route of ['shops', 'dishes']) {
        const response = await app.call('GET', `/discovery/${route}?${query}`, {});
        expect([response.status, route, query]).toEqual([400, route, query]);
      }
    }
    expect(errorCode(await discoveryShops(app, { area_id: area }))).toBeUndefined();
  });

  it('the application fold equals the database fold (so a typed term matches what is stored)', async () => {
    const samples = ['Ốc Hương', 'đậu phụ', 'ƯỚC MƠ', 'Phở  bò   tái', '  Bún chả Hà Nội ', 'Cà phê sữa đá', 'Mì Quảng', 'ABC xyz 123', 'Thạch rau câu'];
    for (const sample of samples) {
      const result = await app.pool.query<{ folded: string }>(`SELECT app.fold_vi($1) AS folded`, [sample]);
      expect(result.rows[0]?.folded).toBe(foldVietnamese(sample));
    }
    const decomposed = 'Ôc Hương'.normalize('NFD');
    expect((await app.pool.query<{ folded: string }>(`SELECT app.fold_vi($1) AS folded`, [decomposed])).rows[0]?.folded).toBe('oc huong');
    expect(foldVietnamese(decomposed)).toBe('oc huong');
  });
});
