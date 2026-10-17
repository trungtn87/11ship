import { readFileSync } from 'node:fs';
import path from 'node:path';

// The M03 Shipper management migration (review/bank/history columns and tables on app.drivers, wallet parameters), split like the other
// migration helpers. It references app.drivers: it goes down BEFORE the Driver onboarding migration and comes back up AFTER it.
export const SHIPPER_MIGRATION_NAME = '1793318400000_create-shipper-management';
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', `${SHIPPER_MIGRATION_NAME}.sql`);
const sql = readFileSync(file, 'utf8');
export const SHIPPER_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const SHIPPER_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
