import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M10 orders migration: it references users, shops, menu items, addresses and deliveries, so it goes down FIRST and comes back up LAST.
export const M10_MIGRATION_NAME = '1794268800000_create-m10-orders';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${M10_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const M10_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const M10_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
