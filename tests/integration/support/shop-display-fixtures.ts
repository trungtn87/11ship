import { assertTestDatabaseTarget } from './assert-test-target';

interface Queryable {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Test-only cleanup before removing fixture shops; production keeps these aliases. */
export async function purgeShopDisplayCodes(db: Queryable, shopIds: string[]): Promise<void> {
  if (shopIds.length === 0) return;
  await assertTestDatabaseTarget(db);
  const present = await db.query("SELECT to_regclass('app.shop_public_ids') AS name");
  // Historical migration tests also exercise schemas from before display codes.
  if (present.rows[0]?.name == null) return;
  for (const table of ['shop_display_numbers', 'shop_display_counters', 'shop_public_ids']) {
    await db.query(`DELETE FROM app.${table} WHERE shop_id = ANY($1::uuid[])`, [shopIds]);
  }
}
