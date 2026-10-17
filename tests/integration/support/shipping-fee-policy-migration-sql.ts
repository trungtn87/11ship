import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M06-A shipping-fee policy migration (immutable versions and the one draft row), split like the other migration helpers. It references
// app.users and is the very newest: it goes down BEFORE the older migrations and comes back up AFTER them.
export const FEE_POLICY_MIGRATION_NAME = '1793750400000_create-shipping-fee-policy';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${FEE_POLICY_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const FEE_POLICY_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const FEE_POLICY_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
