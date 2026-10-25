import { readFileSync } from 'node:fs';
import path from 'node:path';

// The shop payment / payment chat migration (#198, #199): the very newest. It references the Shipper top-up request, the bank transactions, the shops and the
// notifications, so it goes down BEFORE the M04 withdrawals and everything older, and comes back up AFTER them.
export const PAYMENT_CHAT_MIGRATION_NAME = '1796688000000_create-payment-requests-chat';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${PAYMENT_CHAT_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const PAYMENT_CHAT_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const PAYMENT_CHAT_DOWN_SQL = sql.split('-- Down Migration')[1] as string;

// The same migration WITHOUT its two statements on app.notifications (the widened target CHECK and its restore), for the upgrade test that takes M08 (and with it the
// notifications table) off to reproduce the schema of main while the new backend still posts top-ups. It is applied without a history row and dropped again before
// `db:migrate` brings the real migration in.
const withoutNotifications = (text: string): string => text.replace(/DELETE FROM app\.notification\w* [^;]*;\n/g, '').replace(/ALTER TABLE app\.notifications [^;]*;\n/g, '');
export const PAYMENT_CHAT_TABLES_UP_SQL = withoutNotifications(PAYMENT_CHAT_UP_SQL);
export const PAYMENT_CHAT_TABLES_DOWN_SQL = withoutNotifications(PAYMENT_CHAT_DOWN_SQL);
