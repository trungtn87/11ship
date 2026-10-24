import { readFileSync } from 'node:fs';
import path from 'node:path';

// Historical money-upgrade fixtures run the current admin code on an older schema. The administration code names the shop-management right
// (can_manage_shops) in its permission INSERTs, so the real SQL of that migration is applied temporarily and taken off again before the runner applies
// everything pending, without rewriting the fixtures' historical migration ledger.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1796256000000_admin-shop-manage-right.sql'), 'utf8');
export const SHOP_RIGHT_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const SHOP_RIGHT_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
