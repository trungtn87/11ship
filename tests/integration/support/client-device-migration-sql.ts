import { readFileSync } from 'node:fs';
import path from 'node:path';

// The native device binding migration (M01-ANDROID), split like the other migration helpers. It references app.users and app.sessions, so it
// is the newest: it goes down first and comes back up last.
const file = path.resolve(__dirname, '..', '..', '..', '..', 'database', 'migrations', '1792886400000_create-client-device-binding.sql');
const sql = readFileSync(file, 'utf8');
export const CLIENT_DEVICE_MIGRATION_NAME = '1792886400000_create-client-device-binding';
export const CLIENT_DEVICE_UP_SQL = (sql.split('-- Down Migration')[0] as string).replace('-- Up Migration', '');
export const CLIENT_DEVICE_DOWN_SQL = sql.split('-- Down Migration')[1] as string;
/** The triggers this migration owns; the older inventory tests exclude them by name. */
export const CLIENT_DEVICE_TRIGGER_NAMES = [
  'sessions_release_binding_trg',
  'client_device_key_links_guard_trg',
  'client_session_bindings_guard_trg',
  'client_device_bindings_guard_trg',
  'client_device_keys_guard_trg',
];
