import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M13 operations migration: it references users, admin memberships, SMS gateway devices and more, so it goes down FIRST and comes back up LAST.
export const M13_MIGRATION_NAME = '1795737600000_create-m13-ops';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${M13_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const M13_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const M13_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
