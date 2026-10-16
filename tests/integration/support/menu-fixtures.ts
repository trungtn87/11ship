import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ApiResponse, AuthApp } from './auth-fixtures';

// M02-MON fixtures: the system groups (provisioned by SQL as the operator would), the owner's menu calls and tiny valid pictures.

export async function createCategory(pool: Pool, name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE', sortOrder = 0): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4, clock_timestamp(), clock_timestamp())`,
    [id, `${name}`, status, sortOrder],
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
