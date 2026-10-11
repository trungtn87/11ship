import { DatabaseTls, resolveDatabaseTls } from '../../database/tls-config';

// Target guard of the administration operator commands (M01-D-LOGIN). The commands write an account, a membership and
// the limiter configuration, so they refuse any target they cannot positively identify. Every problem names a variable
// and a rule, never a value.
//
//   development  DATABASE_URL on a loopback host; after connecting, the database AND role must be ship11_dev.
//   test         DATABASE_URL; after connecting, the database AND role must be ship11_test (the integration-test guard).
//   staging      MIGRATION_DATABASE_URL (the operator credential, NOT the runtime role) on the Supabase SESSION pooler
//                (port 5432, user <role>.<20-char project ref>), strict TLS from DB_SSL_CA / DB_SSL_CA_FILE, the same
//                host/port/database/project as the runtime DATABASE_URL with a different role, and the operator typing
//                the target in MIGRATION_CONFIRM_TARGET (host:port/database/project ref).
//                DB_REMOTE_TARGET=SELF_HOSTED (M00-VPS-01) selects the one self-hosted staging PostgreSQL instead:
//                localhost:5432/ship11_staging, operator role ship11_migrator, runtime role ship11_app, the same strict TLS,
//                MIGRATION_CONFIRM_TARGET=localhost:5432/ship11_staging, and after connecting the SERVER must report that
//                database, that role, port 5432, TLS in use and no elevated role attribute. Not set means SUPABASE; any
//                other value is refused. Twin of scripts/db-remote-target.js (tests/deploy/db-remote-target-parity.test.mjs
//                runs both on one case matrix).
//   production   refused in this slice.

export type CliEnvSource = Readonly<Record<string, string | undefined>>;

export interface CliTarget {
  readonly appEnv: 'development' | 'test' | 'staging';
  readonly connectionString: string;
  readonly tls: DatabaseTls | undefined;
  /** What current_database() / current_user must report once connected (development, test and self-hosted staging). */
  readonly expected: { readonly database: string; readonly user: string } | undefined;
  /** True for DB_REMOTE_TARGET=SELF_HOSTED: the connected identity is checked with the stricter server-side query. */
  readonly selfHosted: boolean;
}

export type CliTargetResult = { readonly ok: true; readonly target: CliTarget } | { readonly ok: false; readonly problem: string };

export const SELECTOR_VARIABLE = 'DB_REMOTE_TARGET';

/** The one self-hosted staging target. Mirrors SELF_HOSTED in scripts/db-remote-target.js (parity test). */
export const SELF_HOSTED_TARGET = {
  appEnv: 'staging',
  host: 'localhost',
  port: 5432,
  database: 'ship11_staging',
  migrationRole: 'ship11_migrator',
  runtimeRole: 'ship11_app',
  confirmTarget: 'localhost:5432/ship11_staging',
} as const;

/**
 * What the SERVER says about the open connection. Read-only. Identical to SELF_HOSTED_IDENTITY_SQL in
 * scripts/db-remote-target.js (the parity test compares the two texts).
 */
export const SELF_HOSTED_IDENTITY_SQL =
  'SELECT current_database() AS database_name, current_user AS user_name, session_user AS session_user_name, ' +
  'inet_server_port() AS server_port, ' +
  'COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls, ' +
  '(SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged';

export interface SelfHostedIdentityRow {
  readonly database_name?: unknown;
  readonly user_name?: unknown;
  readonly session_user_name?: unknown;
  readonly server_port?: unknown;
  readonly tls?: unknown;
  readonly privileged?: unknown;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const SESSION_POOLER_PORT = 5432;
const POOLER_USERNAME = /^([A-Za-z_][A-Za-z0-9_]*)\.([a-z0-9]{20})$/;

interface ParsedUrl {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly username: string;
  readonly role: string | undefined;
  readonly projectRef: string | undefined;
}

function parseUrl(raw: string | undefined): ParsedUrl | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === '' || database === '') {
      return undefined;
    }
    const username = decodeURIComponent(url.username);
    const pooler = POOLER_USERNAME.exec(username);
    return {
      host: url.hostname,
      port: url.port === '' ? SESSION_POOLER_PORT : Number(url.port),
      database,
      username,
      role: pooler?.[1],
      projectRef: pooler?.[2],
    };
  } catch {
    return undefined;
  }
}

function sessionPooler(raw: string | undefined, variable: string): { parsed: ParsedUrl } | { problem: string } {
  const parsed = parseUrl(raw);
  if (parsed === undefined) {
    return { problem: `missing or invalid environment variable: ${variable}` };
  }
  if (parsed.port !== SESSION_POOLER_PORT) {
    return { problem: `${variable} must use the Supabase SESSION pooler on port ${SESSION_POOLER_PORT}` };
  }
  if (parsed.role === undefined || parsed.projectRef === undefined) {
    return { problem: `${variable} must use a pooler user name of the form <role>.<project ref>` };
  }
  return { parsed };
}

export function resolveCliTarget(env: CliEnvSource): CliTargetResult {
  const appEnv = env.APP_ENV;
  if (appEnv === 'production') {
    return { ok: false, problem: 'APP_ENV=production is refused: this command is not enabled for production' };
  }
  if (appEnv !== 'development' && appEnv !== 'test' && appEnv !== 'staging') {
    return { ok: false, problem: 'APP_ENV must be development, test or staging' };
  }

  if (appEnv === 'development' || appEnv === 'test') {
    const parsed = parseUrl(env.DATABASE_URL);
    if (parsed === undefined) {
      return { ok: false, problem: 'missing or invalid environment variable: DATABASE_URL' };
    }
    if (appEnv === 'development' && !LOOPBACK_HOSTS.has(parsed.host)) {
      return { ok: false, problem: 'DATABASE_URL must name a loopback host for APP_ENV=development' };
    }
    const name = appEnv === 'development' ? 'ship11_dev' : 'ship11_test';
    return {
      ok: true,
      target: {
        appEnv,
        connectionString: env.DATABASE_URL as string,
        tls: undefined,
        expected: { database: name, user: name },
        selfHosted: false,
      },
    };
  }

  // staging: the operator picks the target. Not set means SUPABASE; anything else but SELF_HOSTED is refused here.
  const selector = env[SELECTOR_VARIABLE];
  if (selector !== undefined && selector !== 'SUPABASE' && selector !== 'SELF_HOSTED') {
    return { ok: false, problem: `${SELECTOR_VARIABLE} must be SUPABASE or SELF_HOSTED (or not set, which means SUPABASE)` };
  }
  if (selector === 'SELF_HOSTED') {
    return resolveSelfHostedTarget(env);
  }

  const migration = sessionPooler(env.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
  if ('problem' in migration) {
    return { ok: false, problem: migration.problem };
  }
  const runtime = sessionPooler(env.DATABASE_URL, 'DATABASE_URL');
  if ('problem' in runtime) {
    return { ok: false, problem: runtime.problem };
  }
  const target = migration.parsed;
  const differing = (['host', 'port', 'database', 'projectRef'] as const).filter((key) => runtime.parsed[key] !== target[key]);
  if (differing.length > 0) {
    return { ok: false, problem: `DATABASE_URL and MIGRATION_DATABASE_URL must name the same ${differing.join(', ')}` };
  }
  if (runtime.parsed.role === target.role) {
    return { ok: false, problem: 'MIGRATION_DATABASE_URL and DATABASE_URL must use different roles' };
  }
  const tls = resolveDatabaseTls({ env, required: true, databaseUrl: env.MIGRATION_DATABASE_URL });
  if (!tls.ok || tls.tls === undefined) {
    const names = (tls.ok ? ['DB_SSL_CA', 'DB_SSL_CA_FILE'] : tls.invalid).map((name) =>
      name === 'DATABASE_URL' ? 'MIGRATION_DATABASE_URL' : name,
    );
    return { ok: false, problem: `invalid or missing configuration. Check environment variable(s): ${names.join(', ')}` };
  }
  const expectedTarget = `${target.host}:${target.port}/${target.database}/${target.projectRef}`;
  if (env.MIGRATION_CONFIRM_TARGET !== expectedTarget) {
    return { ok: false, problem: 'confirm the target by setting MIGRATION_CONFIRM_TARGET to host:port/database/project-ref' };
  }
  return {
    ok: true,
    target: {
      appEnv: 'staging',
      connectionString: env.MIGRATION_DATABASE_URL as string,
      tls: tls.tls,
      expected: undefined,
      selfHosted: false,
    },
  };
}

interface SelfHostedUrl {
  readonly username: string;
}

/** One URL of the self-hosted path: usable postgres URL, no query/fragment, host localhost, port 5432, database ship11_staging. */
function selfHostedUrl(raw: string | undefined, variable: string): { parsed: SelfHostedUrl } | { problem: string } {
  const invalid = { problem: `missing or invalid environment variable: ${variable}` };
  if (raw === undefined) {
    return invalid;
  }
  let url: URL;
  let database: string;
  let username: string;
  try {
    url = new URL(raw);
    database = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
  } catch {
    return invalid;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === '' || database === '' || username === '') {
    return invalid;
  }
  if (raw.includes('?') || raw.includes('#') || url.search !== '' || url.hash !== '') {
    return { problem: `${variable} must not carry a query string or a fragment` };
  }
  const port = url.port === '' ? SELF_HOSTED_TARGET.port : Number(url.port);
  if (url.hostname !== SELF_HOSTED_TARGET.host) {
    return { problem: `${variable} must use the host name ${SELF_HOSTED_TARGET.host}` };
  }
  if (port !== SELF_HOSTED_TARGET.port) {
    return { problem: `${variable} must use port ${SELF_HOSTED_TARGET.port}` };
  }
  if (database !== SELF_HOSTED_TARGET.database) {
    return { problem: `${variable} must use the database ${SELF_HOSTED_TARGET.database}` };
  }
  return { parsed: { username } };
}

function resolveSelfHostedTarget(env: CliEnvSource): CliTargetResult {
  const migration = selfHostedUrl(env.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
  if ('problem' in migration) {
    return { ok: false, problem: migration.problem };
  }
  const runtime = selfHostedUrl(env.DATABASE_URL, 'DATABASE_URL');
  if ('problem' in runtime) {
    return { ok: false, problem: runtime.problem };
  }
  if (migration.parsed.username === runtime.parsed.username) {
    return { ok: false, problem: 'MIGRATION_DATABASE_URL and DATABASE_URL must use different roles' };
  }
  if (migration.parsed.username !== SELF_HOSTED_TARGET.migrationRole) {
    return { ok: false, problem: `MIGRATION_DATABASE_URL must use the role ${SELF_HOSTED_TARGET.migrationRole}` };
  }
  if (runtime.parsed.username !== SELF_HOSTED_TARGET.runtimeRole) {
    return { ok: false, problem: `DATABASE_URL must use the role ${SELF_HOSTED_TARGET.runtimeRole}` };
  }
  const tls = resolveDatabaseTls({ env, required: true, databaseUrl: env.MIGRATION_DATABASE_URL });
  if (!tls.ok || tls.tls === undefined) {
    const names = (tls.ok ? ['DB_SSL_CA', 'DB_SSL_CA_FILE'] : tls.invalid).map((name) =>
      name === 'DATABASE_URL' ? 'MIGRATION_DATABASE_URL' : name,
    );
    return { ok: false, problem: `invalid or missing configuration. Check environment variable(s): ${names.join(', ')}` };
  }
  if (env.MIGRATION_CONFIRM_TARGET !== SELF_HOSTED_TARGET.confirmTarget) {
    return { ok: false, problem: `confirm the target by setting MIGRATION_CONFIRM_TARGET=${SELF_HOSTED_TARGET.confirmTarget}` };
  }
  return {
    ok: true,
    target: {
      appEnv: 'staging',
      connectionString: env.MIGRATION_DATABASE_URL as string,
      tls: tls.tls,
      expected: { database: SELF_HOSTED_TARGET.database, user: SELF_HOSTED_TARGET.migrationRole },
      selfHosted: true,
    },
  };
}

/**
 * SELF_HOSTED only: a fixed problem sentence (never a value) when the server's own report of the open connection is not
 * the operator target, or undefined when it is. Twin of selfHostedIdentityProblem in scripts/db-remote-target.js.
 */
export function selfHostedIdentityProblem(row: SelfHostedIdentityRow | null | undefined): string | undefined {
  if (row === undefined || row === null) {
    return 'refused: the server did not report the connected identity.';
  }
  if (row.database_name !== SELF_HOSTED_TARGET.database) {
    return `refused: the connected database is not ${SELF_HOSTED_TARGET.database}.`;
  }
  if (row.user_name !== SELF_HOSTED_TARGET.migrationRole || row.session_user_name !== SELF_HOSTED_TARGET.migrationRole) {
    return `refused: the connected role is not ${SELF_HOSTED_TARGET.migrationRole}.`;
  }
  if (row.privileged !== false) {
    return 'refused: the connected role has an elevated attribute (superuser, createrole, createdb, replication or bypassrls).';
  }
  if (Number(row.server_port) !== SELF_HOSTED_TARGET.port) {
    return `refused: the server did not answer on port ${SELF_HOSTED_TARGET.port}.`;
  }
  if (row.tls !== true) {
    return 'refused: the connection is not encrypted with TLS.';
  }
  return undefined;
}

/** After connecting (development and test): the server's own answer must match, whatever the URL said. */
export function connectedIdentityMatches(
  target: CliTarget,
  reported: { database: unknown; user: unknown },
): boolean {
  if (target.expected === undefined) {
    return true;
  }
  return reported.database === target.expected.database && reported.user === target.expected.user;
}
