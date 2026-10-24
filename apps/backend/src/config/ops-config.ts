// Configuration of M13 (operations, alerts and updates). Pure validation: nothing here reads the environment by itself, touches a file or reports a value;
// only the NAMES of invalid variables are reported. Every variable is optional: with none of them the collector still samples the process, the database and
// the machine (it needs no outside input), and the things that need an outside input (a public URL to check HTTPS, an artifact directory, a Discord webhook)
// simply report "not configured" instead of a made-up status.
//
//   OPS_PUBLIC_BASE_URL   https URL the apps use (for example https://103.9.78.67.sslip.io): the HTTPS certificate expiry is read from it
//   OPS_ADMIN_BASE_URL    https URL of the Administration web: the incident link of a Discord message (default: the first allowed Admin origin, else no link)
//   OPS_ARTIFACT_DIR      absolute directory that holds the release files (APK) SYSTEM registers; nothing outside it is ever served
//   OPS_DISK_PATHS        `label=/path` pairs separated by `;` (default `root=/`): the file systems whose usage is checked
//   OPS_M14_HEALTH_URL    URL of the M14 service health endpoint (optional; absent = "Chưa có dữ liệu" for M14)
//   OPS_BACKEND_VERSION   the version this process reports as itself (default: the package version, else "unknown")
//   OPS_COLLECTOR         `on` | `off` (default on; always off when APP_ENV=test: tests call the same methods directly)

export interface OpsConfig {
  readonly publicBaseUrl?: string;
  readonly adminBaseUrl?: string;
  readonly artifactDir?: string;
  readonly diskPaths: readonly { readonly label: string; readonly path: string }[];
  readonly m14HealthUrl?: string;
  readonly backendVersion: string;
  readonly collectorEnabled: boolean;
}

export type OpsConfigResult = { readonly ok: true; readonly config: OpsConfig } | { readonly ok: false; readonly invalid: readonly string[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function origin(raw: string, allowLoopbackHttp: boolean): string | undefined {
  try {
    const url = new URL(raw);
    const loopback = LOOPBACK.has(url.hostname);
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && loopback && allowLoopbackHttp);
    const clean = url.username === '' && url.password === '' && url.hash === '';
    return schemeOk && clean ? raw.replace(/\/+$/, '') : undefined;
  } catch {
    return undefined;
  }
}

export function parseOpsConfig(input: { readonly env: Readonly<Record<string, string | undefined>>; readonly appEnv: string }): OpsConfigResult {
  const env = input.env;
  const invalid: string[] = [];
  const nonProduction = input.appEnv === 'development' || input.appEnv === 'test';
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === '' ? undefined : v;
  };

  const urlVar = (name: string): string | undefined => {
    const raw = get(name);
    if (raw === undefined) return undefined;
    const ok = origin(raw, nonProduction);
    if (ok === undefined) invalid.push(name);
    return ok;
  };
  const publicBaseUrl = urlVar('OPS_PUBLIC_BASE_URL');
  const adminBaseUrl = urlVar('OPS_ADMIN_BASE_URL');
  const m14HealthUrl = urlVar('OPS_M14_HEALTH_URL');

  let artifactDir: string | undefined;
  const dir = get('OPS_ARTIFACT_DIR');
  if (dir !== undefined) {
    if (/^\/[^\0\r\n]{1,500}$/.test(dir) && !dir.split('/').includes('..')) {
      artifactDir = dir.replace(/\/+$/, '') || '/';
    } else {
      invalid.push('OPS_ARTIFACT_DIR');
    }
  }

  const disks: { label: string; path: string }[] = [];
  const rawDisks = get('OPS_DISK_PATHS');
  if (rawDisks === undefined) {
    disks.push({ label: 'root', path: '/' });
  } else {
    const seen = new Set<string>();
    for (const part of rawDisks.split(';').map((p) => p.trim()).filter((p) => p !== '')) {
      const m = /^([a-z][a-z0-9_]{0,15})=(\/[^\0\r\n]{0,500})$/.exec(part);
      if (m === null || seen.has(m[1] as string) || (m[2] as string).split('/').includes('..') || disks.length >= 8) {
        invalid.push('OPS_DISK_PATHS');
        break;
      }
      seen.add(m[1] as string);
      disks.push({ label: m[1] as string, path: m[2] as string });
    }
  }

  const version = get('OPS_BACKEND_VERSION');
  if (version !== undefined && !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/.test(version)) {
    invalid.push('OPS_BACKEND_VERSION');
  }

  const collector = get('OPS_COLLECTOR');
  if (collector !== undefined && collector !== 'on' && collector !== 'off') {
    invalid.push('OPS_COLLECTOR');
  }

  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  return {
    ok: true,
    config: {
      ...(publicBaseUrl === undefined ? {} : { publicBaseUrl }),
      ...(adminBaseUrl === undefined ? {} : { adminBaseUrl }),
      ...(artifactDir === undefined ? {} : { artifactDir }),
      diskPaths: disks,
      ...(m14HealthUrl === undefined ? {} : { m14HealthUrl }),
      backendVersion: version ?? 'unknown',
      collectorEnabled: input.appEnv !== 'test' && collector !== 'off',
    },
  };
}

/** What the M13 code uses when the AppConfig carries no `ops` (a unit harness): the same as an empty environment outside tests. */
export const DEFAULT_OPS_CONFIG: OpsConfig = { diskPaths: [{ label: 'root', path: '/' }], backendVersion: 'unknown', collectorEnabled: false };
