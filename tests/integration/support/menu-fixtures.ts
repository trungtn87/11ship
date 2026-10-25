import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ApiResponse, AuthApp } from './auth-fixtures';

// M02-MON fixtures: the system groups (provisioned by SQL as the operator would), the owner's menu calls and tiny valid pictures.

export async function createCategory(pool: Pool, name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE', sortOrder = 0): Promise<string> {
  // Group names are unique ignoring case and marks, and a run may leave a group behind: reuse it, set to what the test wants.
  const existing = await pool.query<{ category_id: string }>(`SELECT category_id FROM app.menu_categories WHERE app.fold_vi(name) = app.fold_vi($1)`, [name]);
  const found = existing.rows[0];
  if (found !== undefined) {
    await pool.query(`UPDATE app.menu_categories SET status = $2, sort_order = $3, updated_at = clock_timestamp() WHERE category_id = $1::uuid`, [found.category_id, status, sortOrder]);
    return found.category_id;
  }
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, clock_timestamp(), clock_timestamp())`,
    [id, name, status, sortOrder],
  );
  return id;
}

/** Removes every group and dish of the test run's shops is done by purgePhone; groups are removed here once nothing references them. */
export async function purgeCategories(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM app.menu_categories c WHERE NOT EXISTS (SELECT 1 FROM app.menu_items i WHERE i.category_id = c.category_id)`,
  );
}

export function jpegBase64(extra = 8): string {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 1)]).toString('base64');
}

export function pngBase64(): string {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8, 2)]).toString('base64');
}

const call = (app: AuthApp, method: 'GET' | 'POST' | 'PUT', path: string, token: string | undefined, body?: unknown, key: string | null = null): Promise<ApiResponse> =>
  app.call(method, path, {
    ...(body === undefined ? {} : { body }),
    ...(token === undefined ? {} : { bearer: token }),
    ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
  });

export const getMenu = (app: AuthApp, token: string | undefined): Promise<ApiResponse> => call(app, 'GET', '/shop/me/menu', token);

export const uploadImage = (app: AuthApp, token: string | undefined, body: unknown): Promise<ApiResponse> =>
  call(app, 'POST', '/shop/me/menu/images', token, body);

export const createItem = (app: AuthApp, token: string | undefined, body: unknown, key: string | null = randomUUID()): Promise<ApiResponse> =>
  call(app, 'POST', '/shop/me/menu/items', token, body, key);

/**
 * A dish that is ON SALE the way the shop setup needs it (issue #190): a picture is uploaded first and the dish points at it, so the shop with this
 * first dish can be public. `createItem` with `image_id: null` stays for the tests of a dish without a picture.
 */
export async function createItemWithPicture(app: AuthApp, token: string | undefined, body: Record<string, unknown>, key: string | null = randomUUID()): Promise<ApiResponse> {
  const upload = await uploadImage(app, token, { content_type: 'image/jpeg', data_base64: jpegBase64() });
  const imageId = (upload.body.data as { image_id?: unknown } | undefined)?.image_id;
  if (typeof imageId !== 'string') {
    throw new Error(`fixture picture upload failed: ${upload.status} ${upload.text}`);
  }
  return createItem(app, token, { ...body, image_id: imageId }, key);
}

export const updateItem = (app: AuthApp, token: string | undefined, id: string, body: unknown, key: string | null = randomUUID()): Promise<ApiResponse> =>
  call(app, 'PUT', `/shop/me/menu/items/${id}`, token, body, key);

export const itemAction = (
  app: AuthApp,
  token: string | undefined,
  id: string,
  action: 'hide' | 'show' | 'delete',
  version: number,
  key: string | null = randomUUID(),
): Promise<ApiResponse> => call(app, 'POST', `/shop/me/menu/items/${id}/${action}`, token, { expected_version: version }, key);

export const publicShop = (app: AuthApp, shopId: string): Promise<ApiResponse> => call(app, 'GET', `/shops/${shopId}`, undefined);

export const discoveryShops = (app: AuthApp, query: Record<string, string>): Promise<ApiResponse> =>
  app.call('GET', `/discovery/shops?${new URLSearchParams(query).toString()}`, {});

export const discoveryDishes = (app: AuthApp, query: Record<string, string>): Promise<ApiResponse> =>
  app.call('GET', `/discovery/dishes?${new URLSearchParams(query).toString()}`, {});
