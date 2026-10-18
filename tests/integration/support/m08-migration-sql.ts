import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M08 notification migration: it references app.users, app.sessions and app.deliveries (M07), so it goes down BEFORE all of them and comes back up AFTER them.
export const M08_MIGRATION_NAME = '1794182400000_create-m08-notifications';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${M08_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const M08_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const M08_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
