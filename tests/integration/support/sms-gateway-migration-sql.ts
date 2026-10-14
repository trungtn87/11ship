import { readFileSync } from 'node:fs';
import path from 'node:path';

// The SMS gateway migration (issue #102), split like the other migration helpers. It references app.phone_verifications, so it is
// the newest: it goes down first and comes back up last.
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1792972800000_create-sms-gateway.sql');
const sql = readFileSync(file, 'utf8');
export const SMS_GATEWAY_MIGRATION_NAME = '1792972800000_create-sms-gateway';
export const SMS_GATEWAY_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const SMS_GATEWAY_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
