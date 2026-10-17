import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04-A1 wallet core migration (app.driver_wallets and the append-only ledger), split like the other migration helpers. It references
// app.drivers and is the very newest: it goes down BEFORE the M03 Shipper management migration and comes back up AFTER it.
export const WALLET_MIGRATION_NAME = '1793404800000_create-driver-wallet-core';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${WALLET_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const WALLET_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const WALLET_DOWN_SQL = sql.split('-- Down Migration')[1] as string;

// M04-A2.1: the wallet holds migration. It references app.driver_wallets, so it goes down BEFORE the wallet core and up AFTER it.
export const HOLD_MIGRATION_NAME = '1793491200000_create-wallet-holds';
const holdFile = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${HOLD_MIGRATION_NAME}.sql`);
const holdSql = readFileSync(holdFile, 'utf8');
export const HOLD_UP_SQL = (holdSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const HOLD_DOWN_SQL = holdSql.split('-- Down Migration')[1] as string;
