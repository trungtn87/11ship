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
//   production   refused in this slice.

export type CliEnvSource = Readonly<Record<string, string | undefined>>;

export interface CliTarget {
  readonly appEnv: 'development' | 'test' | 'staging';
  readonly connectionString: string;
  readonly tls: DatabaseTls | undefined;
  /** What current_database() / current_user must report once connected (development and test). */
  readonly expected: { readonly database: string; readonly user: string } | undefined;
}

export type CliTargetResult = { readonly ok: true; readonly target: CliTarget } | { readonly ok: false; readonly problem: string };

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
      },
    };
  }

  // staging
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
    },
  };
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

/**
 * Extra guard of the local SYSTEM recovery command only (M01-RESET): development or test, AND a loopback database host
 * in both. Checked before any connection or any read of a secret; the old commands keep their own scope.
 */
export function resolveLocalRecoveryTarget(env: CliEnvSource): CliTargetResult {
  if (env.APP_ENV !== 'development' && env.APP_ENV !== 'test') {
    return { ok: false, problem: 'refused: local SYSTEM recovery runs only with APP_ENV=development or test' };
  }
  const parsed = parseUrl(env.DATABASE_URL);
  if (parsed === undefined || !LOOPBACK_HOSTS.has(parsed.host)) {
    return { ok: false, problem: 'refused: DATABASE_URL must name a loopback host' };
  }
  if (env.HOST === undefined || !(LOOPBACK_HOSTS.has(env.HOST) || env.HOST === '::1')) {
    return { ok: false, problem: 'refused: HOST must be a loopback address' };
  }
  return resolveCliTarget(env);
}
