import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './test-helpers';

// M01-D-ADMIN-1C migrations A, B, C as SQL text, for the older migration suites that take the whole schema down and up
// again inside a rolled-back transaction: the 1C objects are the newest, so they go down first (newest first) and come back
// up last.

const DIR = path.join(REPO_ROOT, 'database', 'migrations');
const FILES = [
  '1792281600000_create-admin-activation.sql',
  '1792368000000_extend-admin-auth-limits-activation.sql',
  '1792454400000_create-admin-membership-origin-guard.sql',
  // Issue #49: the staging-fixture origin replaces the two account-origin CHECKs; newest, so down first and up last. It touches
  // only those two CHECKs of app.users, so it is independent of the M01.02 customer migration that sits before it.
  '1792627200000_allow-staging-fixture-account-origin.sql',
] as const;

const parts = FILES.map((file) => {
  const sql = readFileSync(path.join(DIR, file), 'utf8');
  return { up: (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', ''), down: sql.split('-- Down Migration')[1] as string };
});

export const ACTIVATION_DOWN_SQL: readonly string[] = [...parts].reverse().map((part) => part.down);
export const ACTIVATION_UP_SQL: readonly string[] = parts.map((part) => part.up);
