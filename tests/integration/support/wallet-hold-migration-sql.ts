import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04-A2.1 hold migration (app.wallet_holds), split like the other migration helpers. It references app.driver_wallets (M04-A1), so
// it is the very newest: it goes down BEFORE the wallet core migration and comes back up AFTER it.
export const WALLET_HOLD_MIGRATION_NAME = '1793491200000_create-wallet-holds';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${WALLET_HOLD_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const WALLET_HOLD_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const WALLET_HOLD_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
