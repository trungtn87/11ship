import { readFileSync } from 'node:fs';
import { parseCaBundle } from '../database/tls-config';
import { isLocalWebMode } from './client-auth-config';

// Configuration of the native Android binding (M01-ANDROID; contract11 sections 7 and 9). Pure validation: only the NAMES of
// invalid variables are ever reported, never a value, a path or a file's content.
//
//   CLIENT_AUTH_ANDROID_ENABLED               true | false (default false). true only for APP_ENV development/test AND a
//                                             loopback bind in this package: staging/production/remote bind + true stops startup.
//   CLIENT_DEVICE_ENVIRONMENT                 non-secret identifier signed into every proof (same value in the native build)
//   CLIENT_DEVICE_ALLOWED_SIGNERS_FILE        JSON exact {FOOD:{package_name,signer_sha256},SHIP:{package_name,signer_sha256}}
//   CLIENT_DEVICE_ATTESTATION_ROOTS_FILE      PEM of the Android attestation roots the OPERATOR pinned (never the OS roots)
//   CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE JSON snapshot {fetched_at, entries:{<serial hex>:{status}}} of the official
//                                             Android attestation status list; older than 24 hours means 503 at verify time
//
// When the gate is off the four device variables are not read at all, and every ANDROID request stays a fail-closed 503.

export const CLIENT_AUTH_ANDROID_ENABLED_ENV = 'CLIENT_AUTH_ANDROID_ENABLED';
export const CLIENT_DEVICE_ENVIRONMENT_ENV = 'CLIENT_DEVICE_ENVIRONMENT';
export const CLIENT_DEVICE_ALLOWED_SIGNERS_FILE_ENV = 'CLIENT_DEVICE_ALLOWED_SIGNERS_FILE';
export const CLIENT_DEVICE_ATTESTATION_ROOTS_FILE_ENV = 'CLIENT_DEVICE_ATTESTATION_ROOTS_FILE';
export const CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE_ENV = 'CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE';

/** The fixed test package names (applicationId never changes between updates). */
export const NATIVE_TEST_PACKAGES = { FOOD: 'vn.eleven.food.test', SHIP: 'vn.eleven.ship.test' } as const;

const ENVIRONMENT_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_JSON_BYTES = 16 * 1024;

export interface ClientDeviceSigner {
  readonly packageName: string;
  /** Lowercase hex SHA-256 of the DER signing certificate. */
  readonly signerSha256: string;
}

export interface ClientDeviceConfig {
  readonly environment: string;
  readonly signers: { readonly FOOD: ClientDeviceSigner; readonly SHIP: ClientDeviceSigner };
  /** One PEM certificate per entry. */
  readonly attestationRoots: readonly string[];
  readonly revocationFile: string;
}

export type ClientDeviceConfigResult =
  | { readonly ok: true; readonly enabled: boolean; readonly config: ClientDeviceConfig | undefined }
  | { readonly ok: false; readonly invalid: readonly string[] };

export interface ClientDeviceConfigInput {
  /** Undefined when APP_ENV itself is invalid (that variable is reported on its own). */
  readonly appEnv: string | undefined;
  readonly host: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Injectable for tests; defaults to reading UTF-8. */
  readonly readFile?: (path: string) => string;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, { encoding: 'utf8' });
}

export function parseClientDevice(input: ClientDeviceConfigInput): ClientDeviceConfigResult {
  const raw = input.env[CLIENT_AUTH_ANDROID_ENABLED_ENV];
  if (raw === undefined || raw === 'false') {
    return { ok: true, enabled: false, config: undefined };
  }
  if (raw !== 'true') {
    return { ok: false, invalid: [CLIENT_AUTH_ANDROID_ENABLED_ENV] };
  }
  // An invalid APP_ENV is reported by its own name; the gate is only judged against a known environment.
  if (input.appEnv === undefined) {
    return { ok: true, enabled: false, config: undefined };
  }
  if (!isLocalWebMode(input.appEnv, input.host)) {
    return { ok: false, invalid: [CLIENT_AUTH_ANDROID_ENABLED_ENV] };
  }

  const readFile = input.readFile ?? defaultReadFile;
  const invalid: string[] = [];

  const environment = input.env[CLIENT_DEVICE_ENVIRONMENT_ENV];
  if (environment === undefined || !ENVIRONMENT_TOKEN.test(environment)) {
    invalid.push(CLIENT_DEVICE_ENVIRONMENT_ENV);
  }

  const signers = readJsonFile(input.env[CLIENT_DEVICE_ALLOWED_SIGNERS_FILE_ENV], readFile, parseSigners);
  if (signers === undefined) {
    invalid.push(CLIENT_DEVICE_ALLOWED_SIGNERS_FILE_ENV);
  }

  const roots = readText(input.env[CLIENT_DEVICE_ATTESTATION_ROOTS_FILE_ENV], readFile);
  const bundle = roots === undefined ? undefined : parseCaBundle(roots);
  if (bundle === undefined) {
    invalid.push(CLIENT_DEVICE_ATTESTATION_ROOTS_FILE_ENV);
  }

  const revocationPath = input.env[CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE_ENV];
  if (readJsonFile(revocationPath, readFile, parseRevocationShape) === undefined) {
    invalid.push(CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE_ENV);
  }

  if (invalid.length > 0 || environment === undefined || signers === undefined || bundle === undefined || revocationPath === undefined) {
    return { ok: false, invalid };
  }
  return {
    ok: true,
    enabled: true,
    config: {
      environment,
      signers,
      attestationRoots: splitPem(bundle.ca),
      revocationFile: revocationPath,
    },
  };
}

function splitPem(pem: string): string[] {
  return pem.match(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g) ?? [];
}

function readText(path: string | undefined, readFile: (path: string) => string): string | undefined {
  if (path === undefined || path.length === 0 || path.length > 4096) {
    return undefined;
  }
  try {
    return readFile(path);
  } catch {
    return undefined;
  }
}

function readJsonFile<T>(
  path: string | undefined,
  readFile: (path: string) => string,
  parse: (value: unknown) => T | undefined,
): T | undefined {
  const text = readText(path, readFile);
  if (text === undefined || text.length > MAX_JSON_BYTES) {
    return undefined;
  }
  try {
    return parse(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function parseSigner(value: unknown, packageName: string): ClientDeviceSigner | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ['package_name', 'signer_sha256'])) {
    return undefined;
  }
  const signer = value['signer_sha256'];
  if (value['package_name'] !== packageName || typeof signer !== 'string') {
    return undefined;
  }
  const normalized = signer.replace(/:/g, '').toLowerCase();
  return SHA256_HEX.test(normalized) ? { packageName, signerSha256: normalized } : undefined;
}

function parseSigners(value: unknown): ClientDeviceConfig['signers'] | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ['FOOD', 'SHIP'])) {
    return undefined;
  }
  const food = parseSigner(value['FOOD'], NATIVE_TEST_PACKAGES.FOOD);
  const ship = parseSigner(value['SHIP'], NATIVE_TEST_PACKAGES.SHIP);
  // Two apps, one persistent signer (the Binder join needs it): both entries name the same certificate.
  if (food === undefined || ship === undefined || food.signerSha256 !== ship.signerSha256) {
    return undefined;
  }
  return { FOOD: food, SHIP: ship };
}

function parseRevocationShape(value: unknown): true | undefined {
  return parseRevocationSnapshot(value) === undefined ? undefined : true;
}

export interface RevocationSnapshot {
  readonly fetchedAtMs: number;
  /** Lowercase hex certificate serials (no leading zeros) whose status is not a plain "good". */
  readonly revokedSerials: ReadonlySet<string>;
}

/** The snapshot file: {fetched_at: ISO, entries: {<serial hex>: {status: "REVOKED"|"SUSPENDED"|...}}}. */
export function parseRevocationSnapshot(value: unknown): RevocationSnapshot | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ['fetched_at', 'entries'])) {
    return undefined;
  }
  const fetchedAt = value['fetched_at'];
  const entries = value['entries'];
  if (typeof fetchedAt !== 'string' || !isPlainObject(entries)) {
    return undefined;
  }
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return undefined;
  }
  const revoked = new Set<string>();
  for (const [serial, entry] of Object.entries(entries)) {
    if (!/^[0-9a-f]{1,64}$/.test(serial) || !isPlainObject(entry) || typeof entry['status'] !== 'string') {
      return undefined;
    }
    revoked.add(serial);
  }
  return { fetchedAtMs, revokedSerials: revoked };
}
