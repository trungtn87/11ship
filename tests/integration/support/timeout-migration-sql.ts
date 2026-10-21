import { readFileSync } from 'node:fs';
import path from 'node:path';

export const TIMEOUT_MIGRATION_NAME = '1795392000000_order-stage-timeouts';
// Historical rollback tests build a fresh, guarded test schema before the
// forward-only timeout migration. They never roll back its immutable history.
export const PRE_TIMEOUT_MIGRATION_ARGS = ['1795305600000', '--timestamp'];
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${TIMEOUT_MIGRATION_NAME}.sql`), 'utf8');
export const TIMEOUT_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
