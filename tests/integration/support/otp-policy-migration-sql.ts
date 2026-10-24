import { readFileSync } from 'node:fs';
import path from 'node:path';

// Historical money-upgrade fixtures run the current backend on an older schema. Every OTP request reads the SYSTEM-configured limits (app.otp_policy) and counts the
// client address (app.otp_ip_requests), so the real SQL of that migration (issue #117) is applied temporarily and taken off again before the runner applies everything
// pending, without rewriting the fixtures' historical migration ledger.
const sql = readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1796428800000_create-otp-policy.sql'), 'utf8');
export const OTP_POLICY_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const OTP_POLICY_DOWN_SQL = 'DROP TABLE app.otp_ip_requests; DROP TABLE app.otp_policy_changes; DROP TABLE app.otp_policy;';
