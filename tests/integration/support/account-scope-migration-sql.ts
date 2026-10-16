import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M01 final package migration (account scope, lock reasons, PHONE_UNVERIFIED, system settings, app.purge_app_user), split like the
// other migration helpers. It changes app.users and is the newest of all: it goes down first and comes back up last.
export const ACCOUNT_SCOPE_MIGRATION_NAME = '1793059200000_account-scope-lifecycle-settings';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${ACCOUNT_SCOPE_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const ACCOUNT_SCOPE_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const ACCOUNT_SCOPE_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
