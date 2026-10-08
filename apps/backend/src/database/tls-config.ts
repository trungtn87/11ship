import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Strict PostgreSQL TLS for the Supabase session pooler (M00-D1).
 *
 * The one rule this module enforces: when TLS is configured, the server certificate chain AND the host name
 * are verified against a CA the operator supplied, and nothing else can weaken that. In particular:
 *
 *  - staging/production FAIL CLOSED: no CA, no start (the error names only variables);
 *  - the CA comes from DB_SSL_CA (PEM in a secret env var) or DB_SSL_CA_FILE (path of a secret file), never both;
 *  - the connection URL must carry NO query parameters once TLS is active. node-postgres merges URL query
 *    parameters over the explicit pool options (`Object.assign({}, options, parse(connectionString))`), so an
 *    `?sslmode=no-verify`, `?sslmode=disable` or `?ssl=false` in DATABASE_URL would silently replace the verified
 *    `ssl` object. The same merge lets `?statement_timeout=0` or `?host=...` replace other explicit options, so
 *    the rule is "no query string at all" rather than a deny-list of ssl spellings;
 *  - NODE_TLS_REJECT_UNAUTHORIZED=0 (a process-wide switch that turns off verification for every TLS socket) is
 *    refused in staging/production.
 *
 * Development and test without a CA keep exactly the previous behaviour (no `ssl` option is produced).
 * Nothing here ever returns, logs or throws a value: failures are variable NAMES only.
 */

export type TlsEnvSource = Readonly<Record<string, string | undefined>>;

export interface DatabaseTls {
  /** PEM bundle (one or more certificates) the server chain must verify against. */
  readonly ca: string;
  /** Always true. Present so no caller can build a weaker object by accident. */
  readonly rejectUnauthorized: true;
}

export type DatabaseTlsResult =
  | { ok: true; tls: DatabaseTls | undefined }
  | { ok: false; invalid: readonly string[] };

export interface ResolveDatabaseTlsInput {
  readonly env: TlsEnvSource;
  /** True for staging/production: TLS is mandatory and the process-wide verification switch is refused. */
  readonly required: boolean;
  /** The (already syntactically valid) DATABASE_URL, or undefined when it is missing/invalid. */
  readonly databaseUrl: string | undefined;
  /** Injectable for tests; defaults to reading the file as UTF-8. */
  readonly readFile?: (path: string) => string;
}

export const DB_SSL_CA = 'DB_SSL_CA';
export const DB_SSL_CA_FILE = 'DB_SSL_CA_FILE';

const MAX_CA_BYTES = 64 * 1024;
const MAX_CA_CERTIFICATES = 10;
const MAX_PATH_LENGTH = 4096;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;

function defaultReadFile(path: string): string {
  return readFileSync(path, { encoding: 'utf8' });
}

/** A secret env var holding a PEM is often stored with literal "\n" sequences; accept that form too. */
function normalizeInlinePem(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes('\n') ? trimmed : trimmed.replace(/\\n/g, '\n');
}

/**
 * Parses a PEM bundle strictly: only certificate blocks (no private key, no other text), each one must be a
 * real X.509 certificate. Returns undefined on ANY problem; the caller reports only the variable name.
 */
export function parseCaBundle(
  pem: string,
): { ca: string; certificateCount: number } | undefined {
  if (pem.length === 0 || pem.length > MAX_CA_BYTES || pem.includes('\0')) {
    return undefined;
  }
  // Windows line endings are normalized so the bundle handed to TLS is identical on every platform.
  const text = pem.replace(/\r\n?/g, '\n');
  if (/PRIVATE KEY/.test(text)) {
    return undefined;
  }
  const blocks = text.match(CERTIFICATE_BLOCK) ?? [];
  if (blocks.length === 0 || blocks.length > MAX_CA_CERTIFICATES) {
    return undefined;
  }
  if (text.replace(CERTIFICATE_BLOCK, '').trim() !== '') {
    return undefined;
  }
  const normalized: string[] = [];
  for (const block of blocks) {
    try {
      // Throws on anything that is not a parseable certificate (truncated, corrupt base64, wrong type).
      new X509Certificate(block);
    } catch {
      return undefined;
    }
    normalized.push(block.trim());
  }
  return { ca: `${normalized.join('\n')}\n`, certificateCount: normalized.length };
}

/**
 * True when the URL carries any query parameter. A URL that cannot be parsed counts as "has a query" so the
 * caller fails closed. (isValidDatabaseUrl in app-config already rejects such URLs; this is defence in depth.)
 */
export function databaseUrlHasQuery(databaseUrl: string): boolean {
  try {
    const url = new URL(databaseUrl);
    return url.search.length > 0;
  } catch {
    return true;
  }
}

function loadCaText(
  env: TlsEnvSource,
  readFile: (path: string) => string,
): { ok: true; text: string; source: 'env' | 'file' } | { ok: false; invalid: readonly string[] } | undefined {
  const inline = env[DB_SSL_CA];
  const file = env[DB_SSL_CA_FILE];
  if (inline === undefined && file === undefined) {
    return undefined;
  }
  if (inline !== undefined && file !== undefined) {
    // Ambiguity is refused: two sources could silently disagree after a partial rotation.
    return { ok: false, invalid: [DB_SSL_CA, DB_SSL_CA_FILE] };
  }
  if (inline !== undefined) {
    return { ok: true, text: normalizeInlinePem(inline), source: 'env' };
  }
  const path = file as string;
  if (path.length === 0 || path.length > MAX_PATH_LENGTH || path.includes('\0')) {
    return { ok: false, invalid: [DB_SSL_CA_FILE] };
  }
  try {
    return { ok: true, text: readFile(path), source: 'file' };
  } catch {
    // The path and the system error are deliberately not reported.
    return { ok: false, invalid: [DB_SSL_CA_FILE] };
  }
}

/**
 * Decides the database TLS configuration from the environment. Pure apart from the optional file read.
 * Returns the NAMES of the offending variables on failure, never a value.
 */
export function resolveDatabaseTls(input: ResolveDatabaseTlsInput): DatabaseTlsResult {
  const { env, required, databaseUrl } = input;
  const readFile = input.readFile ?? defaultReadFile;
  const invalid: string[] = [];

  if (required && env.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === '0') {
    invalid.push('NODE_TLS_REJECT_UNAUTHORIZED');
  }

  const loaded = loadCaText(env, readFile);
  if (loaded === undefined) {
    if (required) {
      invalid.push(DB_SSL_CA, DB_SSL_CA_FILE);
    }
    return invalid.length > 0 ? { ok: false, invalid } : { ok: true, tls: undefined };
  }
  if (!loaded.ok) {
    return { ok: false, invalid: [...invalid, ...loaded.invalid] };
  }

  const parsed = parseCaBundle(loaded.text);
  if (parsed === undefined) {
    invalid.push(loaded.source === 'env' ? DB_SSL_CA : DB_SSL_CA_FILE);
  }
  if (databaseUrl !== undefined && databaseUrlHasQuery(databaseUrl)) {
    invalid.push('DATABASE_URL');
  }
  if (invalid.length > 0 || parsed === undefined) {
    return { ok: false, invalid };
  }
  return {
    ok: true,
    tls: { ca: parsed.ca, rejectUnauthorized: true },
  };
}
