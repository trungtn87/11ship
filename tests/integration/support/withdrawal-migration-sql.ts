import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04 withdrawal migration: the very newest. It references the wallet, hold, ledger and bank tables and the driver bank accounts, so it goes down
// BEFORE the M07 delivery migration and everything older, and comes back up AFTER them.
export const WITHDRAWAL_MIGRATION_NAME = '1794182400000_create-wallet-withdrawals';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${WITHDRAWAL_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const WITHDRAWAL_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const WITHDRAWAL_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
