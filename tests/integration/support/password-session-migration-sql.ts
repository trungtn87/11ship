import { readFileSync } from 'node:fs';
import path from 'node:path';

// Historical money-upgrade fixtures predate this migration but run the current auth code.
// Apply its real SQL temporarily without rewriting their historical migration ledger.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1795651200000_password-client-sessions.sql'), 'utf8');
export const PASSWORD_SESSION_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const PASSWORD_SESSION_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
