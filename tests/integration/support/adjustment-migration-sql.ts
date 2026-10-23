import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M04 adjustment migration: it replaces the ledger source gate that M07 last defined and adds the adjustment source, so it is the very newest: down first, up last. (M11 does not depend on it:
// the port between them is bound at run time.)
export const ADJUSTMENT_MIGRATION_NAME = '1794441600000_open-adjustment-ledger-gate';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${ADJUSTMENT_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const ADJUSTMENT_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const ADJUSTMENT_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
