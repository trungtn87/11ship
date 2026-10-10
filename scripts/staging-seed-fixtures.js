'use strict';

// `npm run staging:seed-fixtures` — creates the staging fixture accounts (M00-D2, docs/tasks/M00-D2-staging-fixtures.md
// section 5). It is a dedicated operator command, the same family as db:migrate:remote:
//   - no HTTP endpoint, never part of build or start, never run from Render; the service does not hold its credential;
//   - APP_ENV=staging only, and only with the fixture mode configured (AUTH_STAGING_FIXTURES_ENABLED=true and a valid
//     AUTH_STAGING_ALLOWED_PHONES), exactly as the application validates them;
//   - the SAME target gates as db:migrate:remote (shared code): Supabase session pooler on port 5432, runtime and
//     operator URLs name the same host/port/database/project with different roles, MIGRATION_CONFIRM_TARGET typed;
//   - the operator credential is MIGRATION_DATABASE_URL; strict TLS from the same compiled rules as the application;
//   - the account data comes from STDIN as JSON [{"phone": "+84...", "password": "..."}] (at most 20, strict keys,
//     phones inside the allowlist). There is NO argument at all, so no password can reach a process list or history;
//   - one transaction for the whole batch, one fixed advisory lock; an existing fixture is left untouched, a
//     verified account aborts the batch; no password change, no role, no profile, no session;
//   - prints only counts and safe codes: never the payload, a phone number, a password, a URL or a CA.
// Needs the compiled application (`npm run build`).

const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { checkRemoteTargets } = require('./db-migrate-remote.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROGRAM = 'staging:seed-fixtures';
const MIN_SERVER_VERSION_NUM = 170000; // PostgreSQL 17
const MAX_STDIN_BYTES = 64 * 1024;

const PAYLOAD_PROBLEMS = {
  SHAPE: 'the input must be a JSON array of objects with exactly the keys "phone" and "password"',
  EMPTY: 'the input contains no account',
  TOO_MANY: 'the input contains more than 20 accounts',
  PHONE_INVALID: 'a phone number is not in the normalized +84 form',
  PHONE_NOT_ALLOWED: 'a phone number is not in AUTH_STAGING_ALLOWED_PHONES',
  PHONE_DUPLICATE: 'a phone number appears twice',
  PASSWORD_INVALID: 'a password does not satisfy the registration password rules',
};

function loadDefaultDeps() {
  const dist = path.join(REPO_ROOT, 'apps', 'backend', 'dist');
  const files = {
    seeder: path.join(dist, 'auth', 'staging-fixture-seeder.js'),
    users: path.join(dist, 'auth', 'user-repository.js'),
    hasher: path.join(dist, 'auth', 'password-hasher.js'),
    audit: path.join(dist, 'audit', 'audit-writer.js'),
    fixturesConfig: path.join(dist, 'config', 'staging-fixtures-config.js'),
    tls: path.join(dist, 'database', 'tls-config.js'),
    safeError: path.join(dist, 'common', 'safe-error.js'),
  };
  if (!Object.values(files).every((file) => existsSync(file))) {
    return undefined;
  }
  // The compiled application's decorators (Nest) need the metadata polyfill, exactly as main.ts imports it.
  require('reflect-metadata');
  const { Client } = require('pg');
  const seederModule = require(files.seeder);
  return {
    parseStagingFixtures: require(files.fixturesConfig).parseStagingFixtures,
    resolveDatabaseTls: require(files.tls).resolveDatabaseTls,
    safeErrorCode: require(files.safeError).safeErrorCode,
    parseSeedPayload: seederModule.parseSeedPayload,
    StagingSeedConflictError: seederModule.StagingSeedConflictError,
    createSeeder: () =>
      new seederModule.StagingFixtureSeeder(
        new (require(files.users).UserRepository)(),
        new (require(files.audit).AuditWriter)(),
        new (require(files.hasher).Argon2idPasswordHasher)(),
      ),
    createClient: (config) => new Client(config),
    readStdin: readAllStdin,
    newRequestId: randomUUID,
  };
}

/** Reads STDIN to the end, bounded. Refuses an interactive terminal: the data is piped in, never typed or passed in argv. */
async function readAllStdin() {
  if (process.stdin.isTTY) {
    throw Object.assign(new Error('stdin is a terminal'), { code: 'STDIN_IS_TTY' });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_STDIN_BYTES) {
      throw Object.assign(new Error('stdin too large'), { code: 'STDIN_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Returns the process exit code. All I/O goes through `out`/`err` and `deps`, so it can be tested without a database. */
async function main({ argv, env, deps = loadDefaultDeps(), out = console.log, err = console.error }) {
  const fail = (message) => {
    err(`${PROGRAM}: ${message}`);
    return 1;
  };

  if (argv.length > 0) {
    // No option exists, and in particular nothing that could carry a phone number or a password.
    return fail('this command takes no argument. The accounts are read from standard input.');
  }
  if (env.APP_ENV !== 'staging') {
    return fail('APP_ENV must be staging.');
  }
  if (deps === undefined) {
    return fail('the compiled application is missing. Run "npm run build" first.');
  }

  const targets = checkRemoteTargets(env);
  if (targets.problem !== undefined) {
    return fail(targets.problem);
  }
  const { target, rawUrl } = targets;

  // The fixture mode must be configured exactly as the application validates it: the seed refuses to create
  // accounts that the running service would then refuse to log in.
  const fixtures = deps.parseStagingFixtures({
    appEnv: env.APP_ENV,
    enabledRaw: env.AUTH_STAGING_FIXTURES_ENABLED,
    phonesRaw: env.AUTH_STAGING_ALLOWED_PHONES,
  });
  if (!fixtures.ok || fixtures.config === undefined) {
    const names = fixtures.ok ? ['AUTH_STAGING_FIXTURES_ENABLED'] : fixtures.invalid;
    return fail(`invalid or missing configuration. Check environment variable(s): ${names.join(', ')}`);
  }

  const tls = deps.resolveDatabaseTls({ env, required: true, databaseUrl: rawUrl });
  if (!tls.ok || tls.tls === undefined) {
    const names = (tls.ok ? ['DB_SSL_CA', 'DB_SSL_CA_FILE'] : tls.invalid).map((name) =>
      name === 'DATABASE_URL' ? 'MIGRATION_DATABASE_URL' : name,
    );
    return fail(`invalid or missing configuration. Check environment variable(s): ${names.join(', ')}`);
  }

  const expectedTarget = `${target.host}:${target.port}/${target.database}/${target.projectRef}`;
  if (env.MIGRATION_CONFIRM_TARGET !== expectedTarget) {
    return fail(`confirm the target by setting MIGRATION_CONFIRM_TARGET=${expectedTarget}`);
  }

  // Input: read, parse, validate EVERYTHING, hash — all before any connection exists.
  let rawInput;
  try {
    rawInput = await deps.readStdin();
  } catch (error) {
    return fail(`could not read standard input (code ${error?.code === 'STDIN_IS_TTY' || error?.code === 'STDIN_TOO_LARGE' ? error.code : 'READ_FAILED'}). Pipe the JSON into the command.`);
  }
  let json;
  try {
    json = JSON.parse(rawInput);
  } catch {
    return fail('the input is not valid JSON.');
  }
  const parsed = deps.parseSeedPayload(json, fixtures.config.allowedPhones);
  if (!parsed.ok) {
    return fail(`invalid input: ${PAYLOAD_PROBLEMS[parsed.problem] ?? 'rejected'}.`);
  }
  const seeder = deps.createSeeder();
  let prepared;
  try {
    prepared = await seeder.prepare(parsed.entries);
  } catch (error) {
    return fail(`hashing failed (code ${deps.safeErrorCode(error)}).`);
  }

  const client = deps.createClient({
    connectionString: rawUrl,
    ssl: { ca: tls.tls.ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  client.on('error', () => undefined);

  let stage = 'connect';
  let transactionOpen = false;
  try {
    await client.connect();

    stage = 'preflight';
    const info = await client.query(
      "SELECT current_setting('server_version_num')::int AS version_num, current_user AS role, " +
        "to_regclass('app.users') IS NOT NULL AS users_present, " +
        "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'users' AND column_name = 'account_origin') AS origin_present",
    );
    const row = info.rows[0];
    out(`${PROGRAM}: connected over verified TLS to ${expectedTarget} as role ${row.role}`);
    if (row.version_num < MIN_SERVER_VERSION_NUM) {
      return fail(`PostgreSQL 17 or newer is required (server_version_num ${row.version_num}).`);
    }
    if (row.users_present !== true || row.origin_present !== true) {
      return fail('app.users.account_origin is missing. Apply the pending migrations first (npm run db:migrate:remote).');
    }

    stage = 'seed';
    const context = {
      isActive: true,
      query: (text, values) => client.query(text, values),
    };
    await client.query('BEGIN');
    transactionOpen = true;
    // A seed run that cannot get the lock or a row lock quickly stops instead of waiting for ever.
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const result = await seeder.seed(context, prepared, deps.newRequestId());

    stage = 'commit';
    await client.query('COMMIT');
    transactionOpen = false;
    out(`${PROGRAM}: created ${result.created}, skipped ${result.skipped} (existing fixtures are left unchanged).`);
    return 0;
  } catch (error) {
    if (transactionOpen && stage !== 'commit') {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    if (deps.StagingSeedConflictError !== undefined && error instanceof deps.StagingSeedConflictError) {
      return fail('a phone number in the batch belongs to a verified account. The whole batch was rolled back; nothing was written.');
    }
    if (stage === 'commit') {
      return fail(`commit failed (code ${deps.safeErrorCode(error)}). The outcome is unknown; running the command again is safe.`);
    }
    return fail(`${stage} failed (code ${deps.safeErrorCode(error)}).`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

module.exports = { main, PAYLOAD_PROBLEMS };

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
