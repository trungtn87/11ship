import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './test-helpers';

// M01.02 — the customer migration as SQL text, for the suites that take the schema down and up again inside a
// rolled-back transaction (the new tables reference app.users, so they must go down BEFORE app.users and come back up
// AFTER it), and for the suite that re-runs the idempotent backfill block on purpose.

export const CUSTOMER_MIGRATION_FILE = '1792540800000_create-customer-profiles-consents.sql';

const sql = readFileSync(path.join(REPO_ROOT, 'database', 'migrations', CUSTOMER_MIGRATION_FILE), 'utf8');

export const CUSTOMER_MIGRATION_SQL = sql;
export const CUSTOMER_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const CUSTOMER_DOWN_SQL = sql.split('-- Down Migration')[1] as string;

/**
 * The idempotent backfill: the LAST DO block of the Up section (the first one is the prerequisite check). It is
 * self-contained, so running it again must add nothing and overwrite nothing.
 */
export const CUSTOMER_BACKFILL_SQL = CUSTOMER_UP_SQL.slice(
  CUSTOMER_UP_SQL.lastIndexOf('DO $$'),
  CUSTOMER_UP_SQL.lastIndexOf('$$;') + 3,
);
