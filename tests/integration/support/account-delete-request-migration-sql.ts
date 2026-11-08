import { readFileSync } from 'node:fs';
import path from 'node:path';

// Historical money-upgrade fixtures run the current backend on an older schema. The current code reads app.users.delete_requested_at (P5-6a, the
// pending-deletion gate of every entry that starts new work), so the real SQL of that migration is applied temporarily and taken off again before the
// runner applies everything pending. It is the newest migration: it goes up after the others and comes down before them.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1797724800000_account-delete-request.sql'), 'utf8');
export const ACCOUNT_DELETE_REQUEST_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const ACCOUNT_DELETE_REQUEST_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
