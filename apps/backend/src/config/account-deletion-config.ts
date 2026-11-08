// Configuration of the public account deletion (P5-6a, Owner decision OD-26). Pure validation: nothing here reads the environment by
// itself and only the NAMES of invalid variables are reported.
//
//   PUBLIC_WEB_ORIGIN                    unset | the public HTTPS origin of this backend (https://host[:port], no path / query / fragment /
//                                        credentials; http:// only for a loopback host). Never hard-coded: when set, a browser POST to
//                                        /v1/account-deletion/confirm must come from exactly this origin; when unset, the Origin header
//                                        (if any) must match the Host the request was sent to.
//   ACCOUNT_DELETE_IP_LIMIT              default 20, 1..1000 attempts per window and client address
//   ACCOUNT_DELETE_IP_WINDOW_SECONDS     default 600, 60..86400
//   ACCOUNT_DELETE_PHONE_LIMIT           default 5, 1..100 attempts per window and phone number (the main layer)
//   ACCOUNT_DELETE_PHONE_WINDOW_SECONDS  default 900, 60..86400
//   ACCOUNT_DELETE_SWEEP_INTERVAL_MS     default 60000, 1000..600000 (how often pending requests are looked at)

export const PUBLIC_WEB_ORIGIN_ENV = 'PUBLIC_WEB_ORIGIN';
const IP_LIMIT_ENV = 'ACCOUNT_DELETE_IP_LIMIT';
const IP_WINDOW_ENV = 'ACCOUNT_DELETE_IP_WINDOW_SECONDS';
const PHONE_LIMIT_ENV = 'ACCOUNT_DELETE_PHONE_LIMIT';
const PHONE_WINDOW_ENV = 'ACCOUNT_DELETE_PHONE_WINDOW_SECONDS';
const SWEEP_ENV = 'ACCOUNT_DELETE_SWEEP_INTERVAL_MS';

export interface AccountDeletionQuota {
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface AccountDeletionConfig {
  /** `scheme://host[:port]`, no trailing slash; undefined = not configured. */
  readonly publicOrigin: string | undefined;
  readonly ip: AccountDeletionQuota;
  readonly phone: AccountDeletionQuota;
  readonly sweepIntervalMs: number;
}

export const DEFAULT_ACCOUNT_DELETION_CONFIG: AccountDeletionConfig = Object.freeze({
  publicOrigin: undefined,
  ip: Object.freeze({ limit: 20, windowSeconds: 600 }),
  phone: Object.freeze({ limit: 5, windowSeconds: 900 }),
  sweepIntervalMs: 60_000,
});

export type AccountDeletionConfigResult =
  | { readonly ok: true; readonly config: AccountDeletionConfig }
  | { readonly ok: false; readonly invalid: readonly string[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function integerIn(raw: string | undefined, fallback: number, min: number, max: number): number | undefined {
  if (raw === undefined) {
    return fallback;
  }
  const value = /^\d{1,7}$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

export function parseAccountDeletion(input: { readonly env: Readonly<Record<string, string | undefined>> }): AccountDeletionConfigResult {
  const { env } = input;
  const invalid: string[] = [];
  const read = (name: string, fallback: number, min: number, max: number): number => {
    const value = integerIn(env[name], fallback, min, max);
    if (value === undefined) {
      invalid.push(name);
      return fallback;
    }
    return value;
  };
  const ipLimit = read(IP_LIMIT_ENV, DEFAULT_ACCOUNT_DELETION_CONFIG.ip.limit, 1, 1000);
  const ipWindow = read(IP_WINDOW_ENV, DEFAULT_ACCOUNT_DELETION_CONFIG.ip.windowSeconds, 60, 86_400);
  const phoneLimit = read(PHONE_LIMIT_ENV, DEFAULT_ACCOUNT_DELETION_CONFIG.phone.limit, 1, 100);
  const phoneWindow = read(PHONE_WINDOW_ENV, DEFAULT_ACCOUNT_DELETION_CONFIG.phone.windowSeconds, 60, 86_400);
  const sweepIntervalMs = read(SWEEP_ENV, DEFAULT_ACCOUNT_DELETION_CONFIG.sweepIntervalMs, 1000, 600_000);

  let publicOrigin: string | undefined;
  const raw = env[PUBLIC_WEB_ORIGIN_ENV];
  if (raw !== undefined && raw !== '') {
    try {
      const url = new URL(raw);
      const local = LOOPBACK.has(url.hostname);
      const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && local);
      const bare = url.username === '' && url.password === '' && (url.pathname === '/' || url.pathname === '') && url.search === '' && url.hash === '';
      if (schemeOk && bare) {
        publicOrigin = url.origin;
      }
    } catch {
      publicOrigin = undefined;
    }
    if (publicOrigin === undefined) {
      invalid.push(PUBLIC_WEB_ORIGIN_ENV);
    }
  }
  if (invalid.length > 0) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { publicOrigin, ip: { limit: ipLimit, windowSeconds: ipWindow }, phone: { limit: phoneLimit, windowSeconds: phoneWindow }, sweepIntervalMs } };
}
