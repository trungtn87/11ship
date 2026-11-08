import { readFileSync } from 'node:fs';
import path from 'node:path';

// Historical money-upgrade fixtures run the current admin code on an older schema. The administration code names the order-cancel right
// (can_cancel_orders, OD-12) in its permission INSERTs, so the real SQL of that migration is applied temporarily and taken off again before the runner
// applies everything pending. It is newer than the shop-management right: it goes up after it and comes down before it.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1797638400000_admin-order-cancel-right.sql'), 'utf8');
export const ORDER_CANCEL_RIGHT_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const ORDER_CANCEL_RIGHT_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
