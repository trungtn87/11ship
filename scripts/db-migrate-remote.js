'use strict';

// `npm run db:migrate:remote [-- --apply]` — the ONLY supported way to migrate a remote (staging/production)
// database. It is a dedicated, explicit path (M00-D1):
//   - never runs at build or start; the Render service does not even hold the credential it uses;
//   - uses MIGRATION_DATABASE_URL (the migration role), which must differ from the runtime DATABASE_URL role;
//   - applies the same strict TLS as the application (same compiled module: CA from DB_SSL_CA / DB_SSL_CA_FILE,
//     certificate chain and host name verified, no query string, no NODE_TLS_REJECT_UNAUTHORIZED=0);
//   - needs the operator to type the target (host:port/database/project ref) in MIGRATION_CONFIRM_TARGET;
//   - accepts only the Supabase SESSION pooler (port 5432) and checks that runtime and migration URLs name the same
//     host, port, database and project ref (a shared pooler host serves many projects) with different roles;
//   - DB_REMOTE_TARGET=SELF_HOSTED (M00-VPS-01) selects the one self-hosted staging PostgreSQL instead: localhost:5432/
//     ship11_staging, roles ship11_migrator / ship11_app, APP_ENV=staging only, MIGRATION_CONFIRM_TARGET=
//     localhost:5432/ship11_staging, and the connected database/role/TLS are verified from the server before anything
//     is read or changed (rules in scripts/db-remote-target.js). Not set means SUPABASE; any other value is refused;
//   - defaults to a read-only CHECK (server version, role, pending migrations); only "--apply" changes anything;
//   - keeps node-pg-migrate's own lock enabled, so two operators cannot migrate at once;
//   - keeps the migration history in app.pgmigrations and never creates anything in Supabase's public schema;
//   - does not read .env, and prints only names, counts and migration file names, never a URL, password or CA.
// Needs the compiled application (`npm run build`), because the TLS rules live in apps/backend/src and are not
// duplicated here. Local and CI databases keep using `npm run db:migrate`.

const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const {
  SELF_HOSTED,
  SELF_HOSTED_IDENTITY_SQL,
  TARGET_SELF_HOSTED,
  checkSelfHostedTargets,
  resolveRemoteTargetSelector,
  selfHostedIdentityProblem,
} = require('./db-remote-target.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');
const MIGRATIONS_TABLE = 'pgmigrations';
// The history table lives in the application schema, NOT in "public": public belongs to Supabase (its Data API
// exposes it), and this project must not create objects there. Local and CI databases keep node-pg-migrate's
// default (public.pgmigrations) because they use `npm run db:migrate`, which this command never touches.
const MIGRATIONS_SCHEMA = 'app';
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MIN_SERVER_VERSION_NUM = 170000; // PostgreSQL 17
const REMOTE_APP_ENVS = new Set(['staging', 'production']);
const PROGRAM = 'db:migrate:remote';

const SESSION_POOLER_PORT = 5432;
// Supabase pooler user names have the form <role>.<project ref>. The project ref is how a shared pooler host tells
// projects apart, so it is part of the target identity. Refs are 20 lowercase alphanumeric characters.
const POOLER_USERNAME = /^([A-Za-z_][A-Za-z0-9_]*)\.([a-z0-9]{20})$/;

function parseDatabaseUrl(raw) {
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
      role: pooler === null ? undefined : pooler[1],
      projectRef: pooler === null ? undefined : pooler[2],
    };
  } catch {
    return undefined;
  }
}

/**
 * Gate for one URL of the Supabase path: usable URL, SESSION pooler port, pooler user name <role>.<project ref>.
 * Returns { target } or { problem } where the problem names the variable and the rule, never a value.
 */
function checkSessionPoolerTarget(raw, variable) {
  const target = raw === undefined ? undefined : parseDatabaseUrl(raw);
  if (target === undefined) {
    return { problem: `missing or invalid environment variable: ${variable}` };
  }
  if (target.port !== SESSION_POOLER_PORT) {
    return {
      problem: `${variable} must use the Supabase SESSION pooler on port ${SESSION_POOLER_PORT} (the transaction pooler on 6543 and any other port are refused).`,
    };
  }
  if (target.role === undefined || target.projectRef === undefined) {
    return { problem: `${variable} must use a pooler user name of the form <role>.<project ref>.` };
  }
  return { target };
}

/**
 * The shared target gates of every remote operator command (db:migrate:remote, staging:seed-fixtures). The operator
 * picks the target with DB_REMOTE_TARGET (see ./db-remote-target.js): SELF_HOSTED goes to its own gates; SUPABASE, or the
 * variable not set at all, keeps the Supabase path below exactly as it was; any other value fails here, before anything
 * connects. Pure; names only, never a value.
 * Returns { problem } or { kind, target, runtime, rawUrl, confirmTarget }, where confirmTarget is the exact text the
 * operator must type in MIGRATION_CONFIRM_TARGET.
 */
function checkRemoteTargets(env) {
  const selected = resolveRemoteTargetSelector(env);
  if (selected.problem !== undefined) {
    return { problem: selected.problem };
  }
  if (selected.selector === TARGET_SELF_HOSTED) {
    return checkSelfHostedTargets(env);
  }
  return checkSupabaseTargets(env);
}

/**
 * The Supabase path (M00-D1): both URLs are the Supabase SESSION pooler on port 5432 with <role>.<project ref> user
 * names; the runtime DATABASE_URL is REQUIRED and must name the same host, port, database and project as
 * MIGRATION_DATABASE_URL, with a different role.
 */
function checkSupabaseTargets(env) {
  const rawUrl = env.MIGRATION_DATABASE_URL;
  const migration = checkSessionPoolerTarget(rawUrl, 'MIGRATION_DATABASE_URL');
  if (migration.target === undefined) {
    return { problem: migration.problem };
  }
  const target = migration.target;

  // The runtime URL is REQUIRED and must describe the same database as the migration URL, with a different role.
  // Without it the role split (and the project check) could not be proven, so the command stops.
  const runtimeCheck = checkSessionPoolerTarget(env.DATABASE_URL, 'DATABASE_URL');
  if (runtimeCheck.target === undefined) {
    return { problem: runtimeCheck.problem };
  }
  const runtime = runtimeCheck.target;
  const different = ['host', 'port', 'database', 'projectRef'].filter((key) => runtime[key] !== target[key]);
  if (different.length > 0) {
    return { problem: `DATABASE_URL and MIGRATION_DATABASE_URL must point at the same host, port, database and project; they differ in: ${different.join(', ')}.` };
  }
  if (runtime.role === target.role) {
    return { problem: 'MIGRATION_DATABASE_URL and DATABASE_URL use the same role. Migration and runtime credentials must differ.' };
  }
  return { kind: 'SUPABASE', target, runtime, rawUrl, confirmTarget: `${target.host}:${target.port}/${target.database}/${target.projectRef}` };
}

/**
 * SELF_HOSTED only: after connecting (over verified TLS) the SERVER's own answer must be the operator target — database,
 * role, port, TLS in use, no elevated role attribute. Read-only. Returns a fixed problem sentence or undefined.
 */
async function checkConnectedIdentity(client) {
  const result = await client.query(SELF_HOSTED_IDENTITY_SQL);
  return selfHostedIdentityProblem(result.rows[0]);
}

/** SELF_HOSTED only: schema app must be owned by the connected migration role (read-only). */
async function schemaOwnedByCurrentUser(client, schema = MIGRATIONS_SCHEMA) {
  assertIdentifier(schema);
  const result = await client.query('SELECT pg_get_userbyid(nspowner) = current_user AS owned FROM pg_namespace WHERE nspname = $1', [schema]);
  return result.rows[0]?.owned === true;
}

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

function assertIdentifier(schema) {
  if (!IDENTIFIER.test(schema)) {
    throw new Error('invalid schema identifier');
  }
}

async function schemaExists(client, schema = MIGRATIONS_SCHEMA) {
  assertIdentifier(schema);
  const result = await client.query('SELECT to_regnamespace($1) IS NOT NULL AS present', [schema]);
  return result.rows[0].present === true;
}

/** Applied vs pending migrations. Read-only. Schema and table are constants (the schema is validated), never user input. */
async function readMigrationState(client, dir = MIGRATIONS_DIR, schema = MIGRATIONS_SCHEMA) {
  assertIdentifier(schema);
  const files = listMigrationFiles(dir);
  const present = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`${schema}.${MIGRATIONS_TABLE}`]);
  let applied = [];
  if (present.rows[0].present === true) {
    const rows = await client.query(`SELECT name FROM ${schema}.${MIGRATIONS_TABLE} ORDER BY id`);
    applied = rows.rows.map((row) => row.name);
  }
  const appliedSet = new Set(applied);
  return {
    files,
    applied,
    pending: files.filter((name) => !appliedSet.has(name)),
    unknownApplied: applied.filter((name) => !files.includes(name)),
  };
}

/** node-pg-migrate runs on OUR already-connected, TLS-verified client, so it cannot use any other TLS setting. */
async function defaultRunMigrations({ client, dir, log, schema = MIGRATIONS_SCHEMA }) {
  assertIdentifier(schema);
  const { runner } = await import('node-pg-migrate');
  return runner({
    dbClient: client,
    dir,
    direction: 'up',
    migrationsTable: MIGRATIONS_TABLE,
    // The schema must already exist (created by the operator, owned by the migration role); the tool never creates it.
    migrationsSchema: schema,
    createMigrationsSchema: false,
    checkOrder: true,
    // The tool's advisory lock stays on: there is deliberately no noLock here.
    log,
    logger: { debug: () => undefined, info: log, warn: log, error: log },
  });
}

function loadDefaultDeps() {
  const dist = path.join(REPO_ROOT, 'apps', 'backend', 'dist');
  const tlsModule = path.join(dist, 'database', 'tls-config.js');
  const safeErrorModule = path.join(dist, 'common', 'safe-error.js');
  if (!existsSync(tlsModule) || !existsSync(safeErrorModule)) {
    return undefined;
  }
  const { Client } = require('pg');
  return {
    resolveDatabaseTls: require(tlsModule).resolveDatabaseTls,
    safeErrorCode: require(safeErrorModule).safeErrorCode,
    createClient: (config) => new Client(config),
    runMigrations: defaultRunMigrations,
    migrationsDir: MIGRATIONS_DIR,
  };
}

/** Returns the process exit code. All I/O goes through `out`/`err` and `deps`, so it can be tested without a database. */
async function main({ argv, env, deps = loadDefaultDeps(), out = console.log, err = console.error }) {
  const fail = (message) => {
    err(`${PROGRAM}: ${message}`);
    return 1;
  };

  const args = new Set(argv);
  const unknown = argv.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    return fail('unknown argument. The only option is --apply (without it the command only checks).');
  }
  const apply = args.has('--apply');

  if (!REMOTE_APP_ENVS.has(env.APP_ENV)) {
    return fail('APP_ENV must be staging or production. Local and CI databases use "npm run db:migrate".');
  }
  if (deps === undefined) {
    return fail('the compiled application is missing. Run "npm run build" first (the TLS rules are compiled from apps/backend/src).');
  }

  const targets = checkRemoteTargets(env);
  if (targets.problem !== undefined) {
    return fail(targets.problem);
  }
  const { kind, rawUrl, confirmTarget: expectedTarget } = targets;
  const selfHosted = kind === TARGET_SELF_HOSTED;

  const tls = deps.resolveDatabaseTls({ env, required: true, databaseUrl: rawUrl });
  if (!tls.ok || tls.tls === undefined) {
    const names = (tls.ok ? ['DB_SSL_CA', 'DB_SSL_CA_FILE'] : tls.invalid).map((name) =>
      name === 'DATABASE_URL' ? 'MIGRATION_DATABASE_URL' : name,
    );
    return fail(`invalid or missing configuration. Check environment variable(s): ${names.join(', ')}`);
  }

  if (env.MIGRATION_CONFIRM_TARGET !== expectedTarget) {
    return fail(`confirm the target by setting MIGRATION_CONFIRM_TARGET=${expectedTarget}`);
  }

  const client = deps.createClient({
    connectionString: rawUrl,
    ssl: { ca: tls.tls.ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  client.on('error', () => undefined);

  let stage = 'connect';
  try {
    await client.connect();

    if (selfHosted) {
      // The URL is only a claim. Before the version check, the history read or any migration, the server itself must
      // say it is ship11_staging, as ship11_migrator, on port 5432, over TLS, with no elevated role attribute.
      stage = 'identity';
      const identityProblem = await checkConnectedIdentity(client);
      if (identityProblem !== undefined) {
        return fail(identityProblem);
      }
    }

    stage = 'preflight';
    const info = await client.query(
      "SELECT current_setting('server_version_num')::int AS version_num, current_setting('server_version') AS version, current_user AS role, current_database() AS db",
    );
    const { version_num: versionNum, version, role, db } = info.rows[0];
    out(`${PROGRAM}: connected over verified TLS to ${expectedTarget} as role ${role} (database ${db}), PostgreSQL ${version}`);
    if (versionNum < MIN_SERVER_VERSION_NUM) {
      return fail(`PostgreSQL 17 or newer is required (server_version_num ${versionNum}).`);
    }

    stage = 'state';
    if (!(await schemaExists(client))) {
      return fail(`schema ${MIGRATIONS_SCHEMA} does not exist. Create it first, owned by the migration role (see the runbook, "Database roles"); this command never creates it.`);
    }
    if (selfHosted && !(await schemaOwnedByCurrentUser(client))) {
      return fail(`schema ${MIGRATIONS_SCHEMA} is not owned by the migration role ${SELF_HOSTED.migrationRole}. Fix the preparation first (see the runbook, "Database roles"); this command never changes ownership.`);
    }
    const state = await readMigrationState(client, deps.migrationsDir);
    out(`${PROGRAM}: ${state.applied.length} applied, ${state.pending.length} pending of ${state.files.length} migration file(s)`);
    for (const name of state.pending) {
      out(`${PROGRAM}:   pending ${name}`);
    }
    if (state.unknownApplied.length > 0) {
      return fail(`the database has applied migrations this checkout does not know: ${state.unknownApplied.join(', ')}. Use the commit that matches the database.`);
    }

    if (!apply) {
      out(`${PROGRAM}: check only; nothing was changed. Re-run with "-- --apply" to apply the pending migrations.`);
      return 0;
    }
    if (state.pending.length === 0) {
      out(`${PROGRAM}: nothing to apply.`);
      return 0;
    }

    stage = 'migrate';
    const ran = await deps.runMigrations({ client, dir: deps.migrationsDir, log: (message) => out(`${PROGRAM}: ${String(message)}`) });
    out(`${PROGRAM}: applied ${ran.length} migration(s)`);
    return 0;
  } catch (error) {
    return fail(`${stage} failed (code ${deps.safeErrorCode(error)}).`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

module.exports = { main, parseDatabaseUrl, checkSessionPoolerTarget, checkRemoteTargets, checkConnectedIdentity, schemaOwnedByCurrentUser, listMigrationFiles, readMigrationState, schemaExists, defaultRunMigrations, MIGRATIONS_TABLE, MIGRATIONS_SCHEMA };

if (require.main === module) {
  main({ argv: process.argv.slice(2), env: process.env }).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error(`${PROGRAM}: unexpected failure.`);
      process.exitCode = 1;
    },
  );
}
