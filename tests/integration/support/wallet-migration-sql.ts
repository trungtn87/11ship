import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04-A1 wallet core migration (app.driver_wallets and the append-only ledger), split like the other migration helpers. It references
// app.drivers and is the very newest: it goes down BEFORE the M03 Shipper management migration and comes back up AFTER it.
export const WALLET_MIGRATION_NAME = '1793404800000_create-driver-wallet-core';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${WALLET_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const WALLET_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const WALLET_DOWN_SQL = sql.split('-- Down Migration')[1] as string;

// M04-B1: the topup source migration. It adds a column to the ledger and references the wallet core: newest, so it goes down FIRST and up LAST.
export const TOPUP_MIGRATION_NAME = '1793577600000_create-wallet-topup-sources';
const topupFile = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${TOPUP_MIGRATION_NAME}.sql`);
const topupSql = readFileSync(topupFile, 'utf8');
export const TOPUP_UP_SQL = (topupSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const TOPUP_DOWN_SQL = topupSql.split('-- Down Migration')[1] as string;

// M04-B2.2a: the finance access (grants) migration. It references only admin_memberships and users, and is the newest: down FIRST, up LAST.
export const FINANCE_MIGRATION_NAME = '1793923200000_create-admin-finance-grants';
const financeFile = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${FINANCE_MIGRATION_NAME}.sql`);
const financeSql = readFileSync(financeFile, 'utf8');
export const FINANCE_UP_SQL = (financeSql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const FINANCE_DOWN_SQL = financeSql.split('-- Down Migration')[1] as string;
