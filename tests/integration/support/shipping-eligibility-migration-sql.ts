import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M06-B/C eligibility-parameter migration (one seeded row and its change log). It references app.users and is the very newest: it goes down
// BEFORE the older migrations and comes back up AFTER them (after the M06-A fee policy).
export const ELIGIBILITY_MIGRATION_NAME = '1793664000000_create-shipping-eligibility-parameters';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${ELIGIBILITY_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const ELIGIBILITY_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const ELIGIBILITY_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
