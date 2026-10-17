import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './test-helpers';

// M05 — the customer address migration as SQL text, for the suites that take the schema down and up again inside a rolled-back
// transaction. The new tables reference app.users, so they go down BEFORE app.users and come back up AFTER it (the newest).

export const CUSTOMER_ADDRESS_MIGRATION_NAME = '1793404800000_create-customer-addresses';

const sql = readFileSync(path.join(REPO_ROOT, 'database', 'migrations', `${CUSTOMER_ADDRESS_MIGRATION_NAME}.sql`), 'utf8');

export const CUSTOMER_ADDRESS_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const CUSTOMER_ADDRESS_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
