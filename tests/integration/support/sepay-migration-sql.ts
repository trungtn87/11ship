import { readFileSync } from 'node:fs';
import path from 'node:path';

// M04 SePay automatic top-up, step 1: the webhook inbox and the SePay settler columns. The newest migration of the repository: a test that
// rebuilds the topup tables from older SQL uses these as an overlay (up before, down before the runner applies the migration for real).
// The Down refuses while any inbox row or automatic settlement exists, so it never drops history.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1798070400000_sepay-auto-topup-inbox.sql'), 'utf8');
export const SEPAY_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const SEPAY_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
