import { readFileSync } from 'node:fs';
import path from 'node:path';

// Dependent schema must go down before M04 topup sources and come up last.
// Callers run both migrations in an explicit transaction that is always rolled back.
// The real financial-history refusal stays active; this helper never clears data.
const sql=readFileSync(path.resolve(__dirname,'..','..','..','..','database','migrations','1796688000000_business-dashboard.sql'),'utf8');
export const BUSINESS_UP_SQL=(sql.split('-- Down Migration')[0] as string).replace('-- Up Migration','');
export const BUSINESS_DOWN_SQL=sql.split('-- Down Migration')[1] as string;
