import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M07 delivery migration: the very newest. It references app.users, app.shops, app.drivers, the wallet tables and the M06 fee agreements, so it goes
// down BEFORE all of them and comes back up AFTER them.
export const M07_MIGRATION_NAME = '1793923200000_create-m07-delivery';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${M07_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const M07_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const M07_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
