import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M11 migration (ratings and complaints): it references app.users, app.shops, app.drivers, app.deliveries and app.delivery_assignments and widens one CHECK of
// M08's notifications, so it goes down BEFORE M08 and M07 and comes back up AFTER them.
export const M11_MIGRATION_NAME = '1794268800000_create-m11-reviews-complaints';
const file = path.resolve(__dirname, '..', '..', '..', 'database', 'migrations', `${M11_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const M11_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const M11_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
