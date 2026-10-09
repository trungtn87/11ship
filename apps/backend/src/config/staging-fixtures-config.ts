// Staging fixture mode configuration (M00-D2, docs/tasks/M00-D2-staging-fixtures.md section 3). Pure parsing: no
// environment access, no I/O. It lives in the config folder, like auth-config.ts, so that nothing that loads
// AppConfig depends on auth code.
//
//   AUTH_STAGING_FIXTURES_ENABLED   exactly "true" or "false"; unset means false. "true" is valid ONLY for
//                                   APP_ENV=staging.
//   AUTH_STAGING_ALLOWED_PHONES     JSON array of normalized +84 numbers (secret setting). REQUIRED, non-empty,
//                                   without duplicates and at most 20 entries when the mode is on; setting it
//                                   while the mode is off is an error too.
//
// Only variable NAMES are ever reported; neither the flag value nor a phone number is echoed anywhere.
import { inspect } from 'node:util';

export const STAGING_FIXTURES_ENABLED_VARIABLE = 'AUTH_STAGING_FIXTURES_ENABLED';
export const STAGING_ALLOWED_PHONES_VARIABLE = 'AUTH_STAGING_ALLOWED_PHONES';

/** Hard cap on the allowlist (spec section 3) and on one seed batch (section 5). */
export const MAX_STAGING_ALLOWED_PHONES = 20;

// The same normalized shape the phone contract produces (+84 and nine digits). Kept here instead of importing
// auth/phone so the config layer stays independent of Auth.
const NORMALIZED_VIETNAM_MOBILE = /^\+84[0-9]{9}$/;

// A bound so an enormous secret never reaches JSON.parse (20 numbers of 12 characters plus punctuation).
const MAX_RAW_LENGTH = 2048;

/**
 * The normalized phone numbers fixtures may use. They are test accounts' phones and are treated as secret
 * configuration, so the object never serializes or inspects as its contents.
 */
export class PhoneAllowlist {
  readonly #phones: ReadonlySet<string>;

  constructor(phones: readonly string[]) {
    this.#phones = new Set(phones);
    Object.freeze(this);
  }

  has(phoneNormalized: string): boolean {
    return this.#phones.has(phoneNormalized);
  }

  get size(): number {
    return this.#phones.size;
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  toString(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return 'PhoneAllowlist { [REDACTED] }';
  }
}

export interface StagingFixturesConfig {
  readonly enabled: true;
  readonly allowedPhones: PhoneAllowlist;
}

export type StagingFixturesParse =
  | { readonly ok: true; readonly config: StagingFixturesConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

/** Parses the JSON allowlist. Returns undefined for anything that is not a valid, non-empty, unique, bounded list. */
export function parseAllowedPhones(raw: string): PhoneAllowlist | undefined {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW_LENGTH) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_STAGING_ALLOWED_PHONES) {
    return undefined;
  }
  const seen = new Set<string>();
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== 'string' || !NORMALIZED_VIETNAM_MOBILE.test(entry) || seen.has(entry)) {
      return undefined;
    }
    seen.add(entry);
  }
  return new PhoneAllowlist([...seen]);
}

export function parseStagingFixtures(input: {
  readonly appEnv: string | undefined;
  readonly enabledRaw: string | undefined;
  readonly phonesRaw: string | undefined;
}): StagingFixturesParse {
  const { appEnv, enabledRaw, phonesRaw } = input;

  if (enabledRaw !== undefined && enabledRaw !== 'true' && enabledRaw !== 'false') {
    return { ok: false, invalid: [STAGING_FIXTURES_ENABLED_VARIABLE] };
  }
  const enabled = enabledRaw === 'true';

  if (!enabled) {
    // Off: the allowlist must not exist. A leftover secret from a previous run would otherwise be a quiet,
    // half-configured state; the operator removes it on purpose.
    return phonesRaw === undefined
      ? { ok: true, config: undefined }
      : { ok: false, invalid: [STAGING_ALLOWED_PHONES_VARIABLE] };
  }

  const invalid: string[] = [];
  if (appEnv !== 'staging') {
    // production, development and test (and an unusable APP_ENV) can never switch the mode on.
    invalid.push(STAGING_FIXTURES_ENABLED_VARIABLE);
  }
  const allowedPhones = phonesRaw === undefined ? undefined : parseAllowedPhones(phonesRaw);
  if (allowedPhones === undefined) {
    invalid.push(STAGING_ALLOWED_PHONES_VARIABLE);
  }
  if (invalid.length > 0 || allowedPhones === undefined) {
    return { ok: false, invalid };
  }
  return { ok: true, config: { enabled: true, allowedPhones } };
}
