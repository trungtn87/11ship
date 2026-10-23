import { AuthApp } from './auth-fixtures';

/** A shop owner hiding (or deleting) a dish — written straight to the dish row as the owner's menu routes would (the routes are covered by menu.int.spec). */
export async function hideDish(app: AuthApp, itemId: string, status: 'HIDDEN' | 'DELETED' = 'HIDDEN'): Promise<void> {
  await app.pool.query(
    `UPDATE app.menu_items SET status = $2, deleted_at = CASE WHEN $2 = 'DELETED' THEN clock_timestamp() ELSE NULL END, version = version + 1, updated_at = clock_timestamp() WHERE item_id = $1::uuid`,
    [itemId, status],
  );
}
