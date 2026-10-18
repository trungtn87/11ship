import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M06 v1.1 migration (three bands, fee agreements). Additive over the v1.0 fee-policy migration, references app.users and app.drivers and is the
// very newest: it goes down BEFORE the older migrations and comes back up AFTER them.
export const V11_MIGRATION_NAME = '1793836800000_m06-v1-1-three-tiers-agreement';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${V11_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const V11_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const V11_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
