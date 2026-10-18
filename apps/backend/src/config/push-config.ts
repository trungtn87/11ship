// Configuration of the Android push provider (M08, Firebase Cloud Messaging HTTP v1). Pure validation: nothing here reads the environment by itself,
// reads the credential file, or reports a value; only the NAMES of invalid variables are reported. The credential (a service-account JSON) is never in
// source, in a log or in an APK: the server reads it from a file the operator mounts.
//
//   PUSH_FCM_PROJECT_ID              Firebase project id (lower-case letters, digits, hyphens)
//   PUSH_FCM_SERVICE_ACCOUNT_FILE    absolute path of the service-account JSON (needs the firebase.messaging role)
//   PUSH_FCM_API_ORIGIN              optional; default https://fcm.googleapis.com. http:// only for a loopback host in development / test (a local stand-in server)
//
// Both of the first two unset (default): push is NOT configured. The inbox and the live sync still work; every push is recorded as skipped with the reason
// PROVIDER_NOT_CONFIGURED, never as sent. Exactly one of the two set is a configuration error.

export const PUSH_FCM_PROJECT_ID_ENV = 'PUSH_FCM_PROJECT_ID';
export const PUSH_FCM_SERVICE_ACCOUNT_FILE_ENV = 'PUSH_FCM_SERVICE_ACCOUNT_FILE';
export const PUSH_FCM_API_ORIGIN_ENV = 'PUSH_FCM_API_ORIGIN';

export interface PushConfig {
  readonly projectId: string;
  readonly serviceAccountFile: string;
  /** `scheme://host[:port]`, no trailing slash. */
  readonly apiOrigin: string;
}

export type PushConfigResult = { readonly ok: true; readonly config: PushConfig | undefined } | { readonly ok: false; readonly invalid: readonly string[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DEFAULT_ORIGIN = 'https://fcm.googleapis.com';

export function parsePushConfig(input: { readonly env: Readonly<Record<string, string | undefined>>; readonly appEnv: string }): PushConfigResult {
  const project = input.env[PUSH_FCM_PROJECT_ID_ENV];
  const file = input.env[PUSH_FCM_SERVICE_ACCOUNT_FILE_ENV];
  const originRaw = input.env[PUSH_FCM_API_ORIGIN_ENV];
  const projectSet = project !== undefined && project !== '';
  const fileSet = file !== undefined && file !== '';
  const invalid: string[] = [];

  let origin = DEFAULT_ORIGIN;
  if (originRaw !== undefined && originRaw !== '') {
    let parsed: string | undefined;
    try {
      const url = new URL(originRaw);
      const local = LOOPBACK.has(url.hostname);
      const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && local && (input.appEnv === 'development' || input.appEnv === 'test'));
      const bare = url.username === '' && url.password === '' && (url.pathname === '/' || url.pathname === '') && url.search === '' && url.hash === '';
      parsed = schemeOk && bare ? url.origin : undefined;
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined) {
      invalid.push(PUSH_FCM_API_ORIGIN_ENV);
    } else {
      origin = parsed;
    }
  }

  if (!projectSet && !fileSet) {
    return invalid.length === 0 ? { ok: true, config: undefined } : { ok: false, invalid };
  }
  if (!projectSet || !/^[a-z][a-z0-9-]{3,62}$/.test(project)) {
    invalid.push(PUSH_FCM_PROJECT_ID_ENV);
  }
  if (!fileSet || !/^\/[^\0\r\n]{1,500}$/.test(file) || file.includes('..')) {
    invalid.push(PUSH_FCM_SERVICE_ACCOUNT_FILE_ENV);
  }
  if (invalid.length > 0 || project === undefined || file === undefined) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { projectId: project, serviceAccountFile: file, apiOrigin: origin } };
}
