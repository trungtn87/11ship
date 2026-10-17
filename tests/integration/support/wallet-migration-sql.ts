import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04-A1 wallet core migration (app.driver_wallets and the append-only ledger), split like the other migration helpers. It references
// app.drivers and is the very newest: it goes down BEFORE the M03 Shipper management migration and comes back up AFTER it.
export const WALLET_MIGRATION_NAME = '1793404800000_create-driver-wallet-core';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${WALLET_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const WALLET_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const WALLET_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
