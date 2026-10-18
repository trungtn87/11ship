// M00-VPS-01 package A — the self-hosted staging path end to end, on a DISPOSABLE PostgreSQL 17 with TLS (CI only).
//
// It runs the REAL operator commands (db:migrate:remote, admin-auth:init-limit-config, admin-auth:bootstrap-system,
// staging:seed-fixtures) as child processes against a throwaway PostgreSQL 17 container that the CI job "Self-hosted
// PostgreSQL 17 over TLS" prepared exactly as ops/runbooks/selfhosted-postgres-staging.md says: a private CA, a server
// certificate that names only `localhost`, pg_hba with hostssl + SCRAM only, roles and schema from
// ops/selfhosted/01-roles-database.sql. Nothing here touches Supabase, and nothing may touch the real VPS database:
//
//   * the suite refuses to start unless GITHUB_ACTIONS=true AND SELFHOSTED_E2E_CONFIRM=disposable-ci-database;
//   * it refuses to continue if database ship11_staging already holds anything (a fresh container has an empty schema app);
//   * it creates no database and no role itself; it only changes what the commands under test change.
//
// What it proves (see the package A handoff): the default migration is read-only; every refusal happens before any
// mutation; strict TLS (wrong CA, wrong host name, expired certificate, plaintext, process-wide TLS switch-off) fails;
// --apply applies exactly the pending migrations once; the runtime grants equal the matrix; limiter init, SYSTEM bootstrap
// and fixture seeding keep their one-time / unchanged / no-membership properties; no command prints a secret.
// Run with: npm run selfhosted:test (after npm run build).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.SELFHOSTED_E2E_CONFIRM !== 'disposable-ci-database') {
  throw new Error(
    'refused: this suite only runs in the CI job that prepared a disposable PostgreSQL (GITHUB_ACTIONS=true and SELFHOSTED_E2E_CONFIRM=disposable-ci-database).',
  );
}
for (const name of ['SELFHOSTED_PKI_DIR', 'SELFHOSTED_ADMIN_PASSWORD', 'SELFHOSTED_MIGRATOR_PASSWORD', 'SELFHOSTED_APP_PASSWORD']) {
  if (!process.env[name]) {
    throw new Error(`refused: ${name} is not set`);
  }
}

const { Client } = require('pg');

const PKI = process.env.SELFHOSTED_PKI_DIR;
const CA_FILE = path.join(PKI, 'ca.crt');
const CA = readFileSync(CA_FILE, 'utf8');
const ADMIN_PW = process.env.SELFHOSTED_ADMIN_PASSWORD;
const MIGRATOR_PW = process.env.SELFHOSTED_MIGRATOR_PASSWORD;
const APP_PW = process.env.SELFHOSTED_APP_PASSWORD;

const TARGET = 'localhost:5432/ship11_staging';
const dbUrl = (user, password, host = 'localhost') => `postgres://${user}:${encodeURIComponent(password)}@${host}:5432/ship11_staging`;
const MIGRATION_URL = dbUrl('ship11_migrator', MIGRATOR_PW);
const RUNTIME_URL = dbUrl('ship11_app', APP_PW);

// Data the commands under test receive. None of it is real; every value is checked never to be printed.
const LIMITER_KEY = randomBytes(32).toString('base64');
const OTHER_LIMITER_KEY = randomBytes(32).toString('base64');
const SYSTEM_PHONE = '+84900000211';
const OTHER_PHONE = '+84900000213';
const FIXTURE_PHONE = '+84900000212';
const SYSTEM_PASSWORD = `Sys-${randomBytes(9).toString('hex')}`;
const FIXTURE_PASSWORD = `Fix-${randomBytes(9).toString('hex')}`;
const SECRETS = [MIGRATOR_PW, APP_PW, ADMIN_PW, LIMITER_KEY, OTHER_LIMITER_KEY, SYSTEM_PASSWORD, FIXTURE_PASSWORD, SYSTEM_PHONE, FIXTURE_PHONE, OTHER_PHONE];

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ship11-selfhosted-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// ---- helpers ---------------------------------------------------------------------------------------------------------

const verified = (ca = CA) => ({ ca, rejectUnauthorized: true });

async function connect({ user, password, database = 'ship11_staging', host = 'localhost', port = 5432, ssl = verified() }) {
  const client = new Client({ host, port, user, password, database, ssl, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  return client;
}
const asMigrator = () => connect({ user: 'ship11_migrator', password: MIGRATOR_PW });
const asRuntime = () => connect({ user: 'ship11_app', password: APP_PW });
const asAdmin = () => connect({ user: 'postgres', password: ADMIN_PW, database: 'postgres' });

async function withClient(open, fn) {
  const client = await open();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** What the commands under test may change, as counts. Read as the migrator (it owns everything in schema app). */
async function snapshot() {
  return withClient(asMigrator, async (client) => {
    const one = async (sql) => (await client.query(sql)).rows[0].n;
    const exists = async (table) => (await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`app.${table}`])).rows[0].present;
    const count = async (table) => ((await exists(table)) ? Number(await one(`SELECT count(*)::int AS n FROM app.${table}`)) : null);
    return {
      relations: Number(await one("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'app'")),
      history: await count('pgmigrations'),
      users: await count('users'),
      memberships: await count('admin_memberships'),
      limitConfig: await count('admin_auth_limit_config'),
      audit: await count('audit_logs'),
    };
  });
}

const operatorEnv = (extra = {}) => ({
  PATH: process.env.PATH,
  APP_ENV: 'staging',
  DB_REMOTE_TARGET: 'SELF_HOSTED',
  MIGRATION_DATABASE_URL: MIGRATION_URL,
  DATABASE_URL: RUNTIME_URL,
  MIGRATION_CONFIRM_TARGET: TARGET,
  DB_SSL_CA_FILE: CA_FILE,
  ...extra,
});

/** Runs one operator command as a child process with ONLY the given environment (nothing is inherited). */
function run(script, { env = operatorEnv(), args = [], input } = {}) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], {
    cwd: ROOT,
    env: Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
    input,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', text: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function assertNoSecrets(result, label) {
  for (const secret of SECRETS) {
    assert.ok(!result.text.includes(secret), `${label}: a secret value was printed`);
  }
  assert.ok(!/postgres:\/\//.test(result.text), `${label}: a connection URL was printed`);
  assert.ok(!/BEGIN CERTIFICATE/.test(result.text), `${label}: a certificate was printed`);
  assert.ok(!/\$argon2/.test(result.text), `${label}: a password hash was printed`);
}

const migrationFiles = () =>
  readdirSync(path.join(ROOT, 'database', 'migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -4))
    .sort();

const openssl = (...args) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });

// ---- 0. the fixture is what the contract says ------------------------------------------------------------------------

describe('the disposable fixture is the self-hosted contract (and is fresh)', () => {
  test('PostgreSQL 17 on port 5432, database ship11_staging, non-superuser roles, TLS in use, schema app owned by the migrator and empty', async () => {
    await withClient(asMigrator, async (client) => {
      const row = (
        await client.query(
          `SELECT current_database() AS db, current_user AS usr, current_setting('server_version_num')::int AS version,
                  inet_server_port() AS port, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
                  (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged,
                  (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'app') AS schema_owner`,
        )
      ).rows[0];
      assert.deepEqual(
        { db: row.db, usr: row.usr, port: row.port, tls: row.tls, privileged: row.privileged, schema_owner: row.schema_owner },
        { db: 'ship11_staging', usr: 'ship11_migrator', port: 5432, tls: true, privileged: false, schema_owner: 'ship11_migrator' },
      );
      assert.ok(row.version >= 170000 && row.version < 180000, `PostgreSQL 17 expected, got ${row.version}`);
    });
    await withClient(asRuntime, async (client) => {
      const row = (await client.query("SELECT current_user AS usr, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super")).rows[0];
      assert.deepEqual(row, { usr: 'ship11_app', super: false });
    });
    const before = await snapshot();
    assert.deepEqual(before, { relations: 0, history: null, users: null, memberships: null, limitConfig: null, audit: null }, 'refusing to run on a database that is not fresh');
  });
});

// ---- 1. strict TLS and the network gates against the real server ------------------------------------------------------

/** A PostgreSQL look-alike that only answers the SSL request and presents the given certificate. */
function startFakeServer({ certFile, keyFile }) {
  const secureContext = tls.createSecureContext({ cert: readFileSync(certFile), key: readFileSync(keyFile) });
  const server = net.createServer((socket) => {
    socket.on('error', () => undefined);
    socket.once('data', () => {
      socket.write('S');
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
      secure.on('error', () => undefined);
      secure.on('data', () => undefined);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) }));
  });
}

async function connectionErrorCode(options) {
  try {
    const client = await connect(options);
    await client.end();
    return 'CONNECTED';
  } catch (error) {
    return error?.code ?? `NO_CODE:${String(error?.message).slice(0, 80)}`;
  }
}

describe('strict TLS and the network gates against the real server', () => {
  let otherCaFile;
  let expired;
  let wrongHost;

  before(() => {
    // A second, unrelated CA; a server certificate signed by the real CA that expired in 2024; one that names another host.
    openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', path.join(tmp, 'other-ca.key'));
    openssl('req', '-x509', '-new', '-key', path.join(tmp, 'other-ca.key'), '-sha256', '-days', '2', '-subj', '/CN=unrelated CA', '-out', path.join(tmp, 'other-ca.crt'));
    otherCaFile = path.join(tmp, 'other-ca.crt');

    const makeServerCert = (name, extension) => {
      const key = path.join(tmp, `${name}.key`);
      const csr = path.join(tmp, `${name}.csr`);
      openssl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', key);
      openssl('req', '-new', '-key', key, '-subj', '/CN=localhost', '-out', csr);
      writeFileSync(path.join(tmp, `${name}.ext`), extension);
      return { key, csr, ext: path.join(tmp, `${name}.ext`), crt: path.join(tmp, `${name}.crt`) };
    };

    wrongHost = makeServerCert('wrong-host', 'basicConstraints = CA:FALSE\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:db.example.test\n');
    openssl('x509', '-req', '-in', wrongHost.csr, '-CA', CA_FILE, '-CAkey', path.join(PKI, 'ca.key'), '-CAcreateserial', '-CAserial', path.join(tmp, 'wrong-host.srl'), '-sha256', '-days', '2', '-extfile', wrongHost.ext, '-out', wrongHost.crt);

    expired = makeServerCert('expired', 'basicConstraints = CA:FALSE\nextendedKeyUsage = serverAuth\nsubjectAltName = DNS:localhost\n');
    writeFileSync(path.join(tmp, 'ca.cnf'), [
      '[ca]', 'default_ca = CA_default',
      '[CA_default]', `dir = ${tmp}`, `database = ${tmp}/index.txt`, `new_certs_dir = ${tmp}`, `serial = ${tmp}/serial`,
      'default_md = sha256', 'policy = policy_any', 'unique_subject = no', 'copy_extensions = none',
      '[policy_any]', 'commonName = supplied',
    ].join('\n'));
    writeFileSync(path.join(tmp, 'index.txt'), '');
    writeFileSync(path.join(tmp, 'serial'), '0A\n');
    openssl('ca', '-batch', '-config', path.join(tmp, 'ca.cnf'), '-cert', CA_FILE, '-keyfile', path.join(PKI, 'ca.key'), '-startdate', '20240101000000Z', '-enddate', '20240102000000Z', '-extfile', expired.ext, '-notext', '-in', expired.csr, '-out', expired.crt);
  });

  test('the server certificate verifies for localhost, and for nothing else (an IP address is refused)', async () => {
    assert.equal(await connectionErrorCode({ user: 'ship11_app', password: APP_PW }), 'CONNECTED');
    assert.equal(await connectionErrorCode({ user: 'ship11_app', password: APP_PW, host: '127.0.0.1' }), 'ERR_TLS_CERT_ALTNAME_INVALID');
  });

  test('a certificate that names another host, and an expired one, are refused by the same rules the commands use', async () => {
    for (const [name, files, expectedCodes] of [
      ['another host name', wrongHost, ['ERR_TLS_CERT_ALTNAME_INVALID']],
      ['expired', expired, ['CERT_HAS_EXPIRED']],
    ]) {
      const server = await startFakeServer({ certFile: files.crt, keyFile: files.key });
      try {
        const code = await connectionErrorCode({ user: 'ship11_app', password: APP_PW, port: server.port });
        assert.ok(expectedCodes.includes(code), `${name}: got ${code}`);
      } finally {
        await server.close();
      }
    }
  });

  test('plaintext is refused by the server (pg_hba has hostssl only), and so is a login outside the one database', async () => {
    const plain = await connectionErrorCode({ user: 'ship11_migrator', password: MIGRATOR_PW, ssl: false });
    assert.notEqual(plain, 'CONNECTED');
    const otherDatabase = await connectionErrorCode({ user: 'ship11_app', password: APP_PW, database: 'postgres' });
    assert.notEqual(otherDatabase, 'CONNECTED');
  });

  test('the db:migrate:remote command with the wrong CA fails at the connection, changes nothing and prints no secret', async () => {
    const before = await snapshot();
    const result = run('db-migrate-remote.js', { env: operatorEnv({ DB_SSL_CA_FILE: otherCaFile }), args: ['--apply'] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /connect failed \(code (SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT)\)/);
    assert.doesNotMatch(result.stdout, /connected over verified TLS/);
    assertNoSecrets(result, 'wrong CA');
    assert.deepEqual(await snapshot(), before);
  });

  test('switching TLS verification off process-wide is refused before connecting', async () => {
    const result = run('db-migrate-remote.js', { env: operatorEnv({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), args: ['--apply'] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NODE_TLS_REJECT_UNAUTHORIZED/);
    assert.doesNotMatch(result.stdout, /connected/);
  });

  test('a migration role that gained an elevated attribute is refused by the identity check, before anything is read or changed', async () => {
    const before = await snapshot();
    await withClient(asAdmin, (admin) => admin.query('ALTER ROLE ship11_migrator CREATEDB'));
    try {
      for (const [script, args] of [['db-migrate-remote.js', []], ['db-migrate-remote.js', ['--apply']], ['admin-auth-init-limit-config.js', []]]) {
        const result = run(script, {
          env: operatorEnv({ ADMIN_RATE_LIMIT_HMAC_KEY: LIMITER_KEY, ADMIN_RATE_LIMIT_KEY_ID: 'ci-key-1' }),
          args,
        });
        assert.equal(result.status, 1, script);
        assert.match(result.stderr, /refused: the connected role has an elevated attribute/, script);
        assertNoSecrets(result, script);
      }
    } finally {
      await withClient(asAdmin, (admin) => admin.query('ALTER ROLE ship11_migrator NOCREATEDB'));
    }
    assert.deepEqual(await snapshot(), before);
  });
});

// ---- 2. the migration ------------------------------------------------------------------------------------------------

describe('db:migrate:remote on the self-hosted target', () => {
  const files = migrationFiles();

  test('the default run only checks: lists every migration as pending and changes nothing', async () => {
    const before = await snapshot();
    const result = run('db-migrate-remote.js');
    assert.equal(result.status, 0, result.text);
    assert.match(result.stdout, /connected over verified TLS to localhost:5432\/ship11_staging as role ship11_migrator/);
    assert.match(result.stdout, new RegExp(`0 applied, ${files.length} pending of ${files.length} migration file\\(s\\)`));
    assert.match(result.stdout, /check only; nothing was changed/);
    assertNoSecrets(result, 'check');
    // Production uses this same pinned SELF_HOSTED identity. A valid check must remain read-only.
    const production = run('db-migrate-remote.js', { env: operatorEnv({ APP_ENV: 'production' }) });
    assert.equal(production.status, 0, production.text);
    assert.match(production.stdout, /check only; nothing was changed/);
    assertNoSecrets(production, 'production check');
    assert.deepEqual(await snapshot(), before);
  });

  test('every refusal happens before any mutation: selector, environment, host, role, database, typed target', async () => {
    const before = await snapshot();
    const cases = [
      ['unknown selector', { DB_REMOTE_TARGET: 'self_hosted' }],
      ['empty selector', { DB_REMOTE_TARGET: '' }],
      ['production without typed target', { APP_ENV: 'production', MIGRATION_CONFIRM_TARGET: undefined }],
      ['development', { APP_ENV: 'development' }],
      ['IP address host', { MIGRATION_DATABASE_URL: dbUrl('ship11_migrator', MIGRATOR_PW, '127.0.0.1') }],
      ['runtime URL on another host', { DATABASE_URL: dbUrl('ship11_app', APP_PW, '127.0.0.1') }],
      ['the same role for both URLs', { DATABASE_URL: MIGRATION_URL }],
      ['runtime role as the operator role', { MIGRATION_DATABASE_URL: RUNTIME_URL, DATABASE_URL: MIGRATION_URL }],
      ['another database', { MIGRATION_DATABASE_URL: MIGRATION_URL.replace('/ship11_staging', '/postgres') }],
      ['a query string', { MIGRATION_DATABASE_URL: `${MIGRATION_URL}?sslmode=disable` }],
      ['wrong typed target', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_test' }],
      ['missing typed target', { MIGRATION_CONFIRM_TARGET: undefined }],
      ['no CA', { DB_SSL_CA_FILE: undefined }],
    ];
    for (const [name, extra] of cases) {
      for (const args of [[], ['--apply']]) {
        const result = run('db-migrate-remote.js', { env: operatorEnv(extra), args });
        assert.equal(result.status, 1, `${name} ${args.join(' ')}: ${result.text}`);
        assert.doesNotMatch(result.stdout, /connected over verified TLS/, name);
        assertNoSecrets(result, name);
      }
    }
    assert.deepEqual(await snapshot(), before);
  });

  test('--apply applies exactly the migrations, history only in app.pgmigrations, nothing in schema public', async () => {
    const result = run('db-migrate-remote.js', { args: ['--apply'] });
    assert.equal(result.status, 0, result.text);
    assert.match(result.stdout, new RegExp(`applied ${files.length} migration\\(s\\)`));
    assertNoSecrets(result, 'apply');
    await withClient(asMigrator, async (client) => {
      const applied = (await client.query('SELECT name FROM app.pgmigrations ORDER BY id')).rows.map((row) => row.name);
      assert.deepEqual(applied, files);
      const publicObjects = await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public'");
      assert.equal(publicObjects.rows[0].n, 0);
      const history = await client.query("SELECT s.nspname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE c.relname = 'pgmigrations' AND c.relkind = 'r'");
      assert.deepEqual(history.rows.map((row) => row.nspname), ['app']);
      const owners = await client.query("SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'app' AND c.relkind = 'r'");
      assert.deepEqual(owners.rows.map((row) => row.owner), ['ship11_migrator']);
    });
  });

  test('running it again applies nothing and adds no history row', async () => {
    const before = await withClient(asMigrator, async (client) => (await client.query('SELECT count(*)::int AS n, max(run_on) AS last FROM app.pgmigrations')).rows[0]);
    for (const args of [['--apply'], []]) {
      const result = run('db-migrate-remote.js', { args });
      assert.equal(result.status, 0, result.text);
      assert.match(result.stdout, args.length > 0 ? /nothing to apply/ : new RegExp(`${files.length} applied, 0 pending`));
      assertNoSecrets(result, `rerun ${args.join(' ')}`);
    }
    const after = await withClient(asMigrator, async (client) => (await client.query('SELECT count(*)::int AS n, max(run_on) AS last FROM app.pgmigrations')).rows[0]);
    assert.deepEqual(after, before);
  });
});

// ---- 3. the runtime grants -------------------------------------------------------------------------------------------

function grantRows(sql) {
  const rows = new Map();
  for (const match of sql.replace(/^--.*$/gm, '').matchAll(/GRANT ([A-Z, ]+) ON app\.([a-z_]+) TO ship11_app;/g)) {
    rows.set(match[2], match[1].split(',').map((kind) => kind.trim()).sort());
  }
  return rows;
}

describe('runtime grants (ops/selfhosted/02-runtime-grants.sql) with the real restricted runtime role', () => {
  const grantsSql = readFileSync(path.join(ROOT, 'ops', 'selfhosted', '02-runtime-grants.sql'), 'utf8');
  const matrix = grantRows(grantsSql);
  const kinds = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

  test('the runtime role has nothing before the grants', async () => {
    await withClient(asRuntime, async (client) => {
      await assert.rejects(client.query('SELECT 1 FROM app.users LIMIT 1'), { code: '42501' });
    });
  });

  test('the file covers exactly the tables the migrations created, and applying it twice changes nothing', async () => {
    await withClient(asMigrator, async (client) => {
      const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE' AND table_name <> 'pgmigrations' ORDER BY table_name")).rows.map((row) => row.table_name);
      assert.deepEqual([...matrix.keys()].sort(), tables);
      await client.query(grantsSql);
      await client.query(grantsSql);
    });
  });

  test('the effective privileges of ship11_app on EVERY table equal the matrix, and nothing else', async () => {
    await withClient(asMigrator, async (client) => {
      for (const [table, privileges] of matrix) {
        const effective = await client.query(
          "SELECT k AS kind, has_table_privilege($1, 'app.' || $2, k) AS granted FROM unnest($3::text[]) AS k ORDER BY k",
          ['ship11_app', table, kinds],
        );
        const granted = effective.rows.filter((row) => row.granted).map((row) => row.kind);
        assert.deepEqual([table, granted], [table, privileges], table);
      }
      const history = await client.query("SELECT has_table_privilege('ship11_app', 'app.pgmigrations', 'SELECT') AS can_read");
      assert.equal(history.rows[0].can_read, false);
      const schema = await client.query("SELECT has_schema_privilege('ship11_app', 'app', 'USAGE') AS usage, has_schema_privilege('ship11_app', 'app', 'CREATE') AS can_create, has_schema_privilege('ship11_app', 'public', 'CREATE') AS public_create");
      assert.deepEqual(schema.rows[0], { usage: true, can_create: false, public_create: false });
    });
  });

  test('as the runtime role itself: reads and writes what the matrix allows, and every forbidden step stops with 42501', async () => {
    await withClient(asRuntime, async (client) => {
      await client.query('SELECT 1 FROM app.users LIMIT 1');
      await client.query('SELECT 1 FROM app.admin_auth_limit_config LIMIT 1');
      await assert.rejects(client.query('SELECT 1 FROM app.pgmigrations LIMIT 1'), { code: '42501' });
      await assert.rejects(client.query('SELECT 1 FROM app.audit_logs LIMIT 1'), { code: '42501' });
      await assert.rejects(client.query('DELETE FROM app.users'), { code: '42501' });
      await assert.rejects(client.query('TRUNCATE app.user_consents'), { code: '42501' });
      await assert.rejects(client.query('UPDATE app.admin_auth_limit_config SET limiter_key_id = limiter_key_id'), { code: '42501' });
      await assert.rejects(client.query('CREATE TABLE app.runtime_must_not_create (id int)'), { code: '42501' });
      await assert.rejects(client.query('DROP TABLE app.users'), { code: '42501' });
      await assert.rejects(client.query('ALTER TABLE app.users ADD COLUMN must_not_exist int'), { code: '42501' });
      await assert.rejects(client.query('CREATE TABLE public.runtime_must_not_create (id int)'), { code: '42501' });
      // M07: the runtime role may write the commission hold, the wallet balance and the ledger, but only through the database gates: a hold or a ledger row
      // without its delivery assignment is refused (restrict_violation), and nothing is ever deleted or truncated.
      await client.query('SELECT 1 FROM app.wallet_holds LIMIT 1');
      await assert.rejects(client.query('INSERT INTO app.wallet_holds (hold_id) VALUES (gen_random_uuid())'), { code: '23001', message: /WALLET_HOLD_SOURCE_NOT_AVAILABLE/ });
      await client.query("UPDATE app.wallet_holds SET status = status WHERE false");
      await assert.rejects(client.query('DELETE FROM app.wallet_holds'), { code: '42501' });
      await assert.rejects(client.query('TRUNCATE app.wallet_holds'), { code: '42501' });
      await client.query('UPDATE app.driver_wallets SET version = version WHERE false');
      await assert.rejects(client.query('INSERT INTO app.wallet_ledger_entries (entry_id) VALUES (gen_random_uuid())'), { code: '23001', message: /WALLET_LEDGER_SOURCE_NOT_AVAILABLE/ });
      await assert.rejects(client.query('UPDATE app.wallet_ledger_entries SET delta_vnd = delta_vnd'), { code: '42501' });
      await assert.rejects(client.query('DELETE FROM app.wallet_ledger_entries'), { code: '42501' });
      // M07 tables: no DELETE or TRUNCATE for the runtime role; the event log is INSERT only.
      for (const table of ['deliveries', 'delivery_assignments', 'delivery_events', 'delivery_incidents', 'shipper_latest_locations']) {
        await client.query(`SELECT 1 FROM app.${table} LIMIT 1`);
        await assert.rejects(client.query(`DELETE FROM app.${table}`), { code: '42501' });
        await assert.rejects(client.query(`TRUNCATE app.${table}`), { code: '42501' });
      }
      await assert.rejects(client.query('UPDATE app.delivery_events SET note = note'), { code: '42501' });
    });
  });
});

// ---- 4. limiter init, SYSTEM bootstrap, fixture seed -------------------------------------------------------------------

const limiterEnv = (extra = {}) => operatorEnv({ ADMIN_RATE_LIMIT_HMAC_KEY: LIMITER_KEY, ADMIN_RATE_LIMIT_KEY_ID: 'ci-key-1', ...extra });
const bootstrapInput = (phone, password) => `${JSON.stringify({ phone, password })}\n`;

describe('admin-auth operator commands on the self-hosted target', () => {
  test('init-limit-config: every refusal happens before any write', async () => {
    const before = await snapshot();
    const cases = [
      ['unknown selector', { DB_REMOTE_TARGET: 'LOCAL' }],
      ['production without typed target', { APP_ENV: 'production', MIGRATION_CONFIRM_TARGET: undefined }],
      ['IP address host', { MIGRATION_DATABASE_URL: dbUrl('ship11_migrator', MIGRATOR_PW, '127.0.0.1') }],
      ['another database', { DATABASE_URL: RUNTIME_URL.replace('/ship11_staging', '/postgres') }],
      ['the same role', { DATABASE_URL: MIGRATION_URL }],
      ['wrong typed target', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/other' }],
      ['no CA', { DB_SSL_CA_FILE: undefined }],
      ['no limiter key', { ADMIN_RATE_LIMIT_HMAC_KEY: undefined }],
    ];
    for (const [name, extra] of cases) {
      const result = run('admin-auth-init-limit-config.js', { env: limiterEnv(extra) });
      assert.equal(result.status, 1, `${name}: ${result.text}`);
      assertNoSecrets(result, name);
    }
    assert.deepEqual(await snapshot(), before);
  });

  test('init-limit-config writes the row once; the same key is "unchanged"; another key is refused', async () => {
    const first = run('admin-auth-init-limit-config.js', { env: limiterEnv() });
    assert.equal(first.status, 0, first.text);
    assert.match(first.stdout, /admin-auth:init-limit-config: created/);
    // A correctly pinned production operator is accepted; the limiter key remains write-once.
    const production = run('admin-auth-init-limit-config.js', { env: limiterEnv({ APP_ENV: 'production' }) });
    assert.equal(production.status, 0, production.text);
    assert.match(production.stdout, /admin-auth:init-limit-config: unchanged/);
    assertNoSecrets(production, 'production limiter');
    const second = run('admin-auth-init-limit-config.js', { env: limiterEnv() });
    assert.equal(second.status, 0, second.text);
    assert.match(second.stdout, /admin-auth:init-limit-config: unchanged/);
    const other = run('admin-auth-init-limit-config.js', { env: limiterEnv({ ADMIN_RATE_LIMIT_HMAC_KEY: OTHER_LIMITER_KEY }) });
    assert.equal(other.status, 1);
    assert.match(other.stderr, /refused: LIMIT_CONFIG_MISMATCH/);
    for (const [label, result] of [['first', first], ['second', second], ['other', other]]) assertNoSecrets(result, `limiter ${label}`);
    assert.equal((await snapshot()).limitConfig, 1);
  });

  test('bootstrap-system: refusals before any write; creates the single SYSTEM account once; the same phone is "unchanged"; another phone is refused', async () => {
    const before = await snapshot();
    for (const [name, extra] of [
      ['unknown selector', { DB_REMOTE_TARGET: 'LOCAL' }],
      ['IP address host', { MIGRATION_DATABASE_URL: dbUrl('ship11_migrator', MIGRATOR_PW, '127.0.0.1') }],
      ['wrong typed target', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/other' }],
    ]) {
      const result = run('admin-auth-bootstrap-system.js', { env: limiterEnv(extra), input: bootstrapInput(SYSTEM_PHONE, SYSTEM_PASSWORD) });
      assert.equal(result.status, 1, name);
      assertNoSecrets(result, name);
    }
    const malformed = run('admin-auth-bootstrap-system.js', { env: limiterEnv(), input: '{"phone": "not a phone", "password": "x"}' });
    assert.equal(malformed.status, 1);
    assertNoSecrets(malformed, 'malformed input');
    assert.deepEqual(await snapshot(), before, 'refused runs wrote nothing');

    const created = run('admin-auth-bootstrap-system.js', { env: limiterEnv(), input: bootstrapInput(SYSTEM_PHONE, SYSTEM_PASSWORD) });
    assert.equal(created.status, 0, created.text);
    assert.match(created.stdout, /admin-auth:bootstrap-system: created/);
    const again = run('admin-auth-bootstrap-system.js', { env: limiterEnv(), input: bootstrapInput(SYSTEM_PHONE, SYSTEM_PASSWORD) });
    assert.equal(again.status, 0, again.text);
    assert.match(again.stdout, /admin-auth:bootstrap-system: unchanged/);
    const different = run('admin-auth-bootstrap-system.js', { env: limiterEnv(), input: bootstrapInput(OTHER_PHONE, SYSTEM_PASSWORD) });
    assert.equal(different.status, 1);
    assert.match(different.stderr, /refused: SYSTEM_ACCOUNT_DIFFERENT/);
    for (const [label, result] of [['created', created], ['again', again], ['different', different]]) assertNoSecrets(result, `bootstrap ${label}`);

    const after = await snapshot();
    assert.equal(after.users, before.users + 1);
    assert.equal(after.memberships, before.memberships + 1);
    assert.equal(after.audit, before.audit + 1);
    await withClient(asMigrator, async (client) => {
      const roles = (await client.query('SELECT admin_role FROM app.admin_memberships')).rows.map((row) => row.admin_role);
      assert.deepEqual(roles, ['SYSTEM']);
    });
  });

  test('seed-fixtures: creates fixtures without any membership; repeating leaves them unchanged; a phone that is an administration account is another scope', async () => {
    const seedEnv = (extra = {}) =>
      operatorEnv({ AUTH_STAGING_FIXTURES_ENABLED: 'true', AUTH_STAGING_ALLOWED_PHONES: JSON.stringify([FIXTURE_PHONE, SYSTEM_PHONE]), ...extra });
    const batch = (entries) => JSON.stringify(entries);
    const before = await snapshot();

    for (const [name, extra] of [
      ['unknown selector', { DB_REMOTE_TARGET: 'LOCAL' }],
      ['IP address host', { MIGRATION_DATABASE_URL: dbUrl('ship11_migrator', MIGRATOR_PW, '127.0.0.1') }],
      ['wrong typed target', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/other' }],
      ['fixture mode off', { AUTH_STAGING_FIXTURES_ENABLED: undefined }],
    ]) {
      const result = run('staging-seed-fixtures.js', { env: seedEnv(extra), input: batch([{ phone: FIXTURE_PHONE, password: FIXTURE_PASSWORD }]) });
      assert.equal(result.status, 1, name);
      assertNoSecrets(result, name);
    }
    assert.deepEqual(await snapshot(), before, 'refused runs wrote nothing');

    const created = run('staging-seed-fixtures.js', { env: seedEnv(), input: batch([{ phone: FIXTURE_PHONE, password: FIXTURE_PASSWORD }]) });
    assert.equal(created.status, 0, created.text);
    assert.match(created.stdout, /created 1, skipped 0/);
    const again = run('staging-seed-fixtures.js', { env: seedEnv(), input: batch([{ phone: FIXTURE_PHONE, password: FIXTURE_PASSWORD }]) });
    assert.equal(again.status, 0, again.text);
    assert.match(again.stdout, /created 0, skipped 1/);

    const afterSeed = await snapshot();
    assert.equal(afterSeed.users, before.users + 1);
    assert.equal(afterSeed.memberships, before.memberships, 'a fixture never gets an administration membership');
    await withClient(asMigrator, async (client) => {
      const origins = (await client.query("SELECT account_origin, count(*)::int AS n FROM app.users GROUP BY account_origin ORDER BY account_origin")).rows;
      assert.deepEqual(origins.map((row) => [row.account_origin, row.n]).sort(), [['ADMIN_PROVISIONED', 1], ['STAGING_FIXTURE', 1]].sort());
    });

    // The SYSTEM administrator's phone is allowlisted here on purpose. An administration account and an application account are different
    // scopes (Owner decision 2026-10-14): the fixture is created BESIDE the SYSTEM account, which stays exactly as it was and gets no membership.
    const adminBefore = await withClient(asMigrator, async (client) =>
      (await client.query("SELECT user_id, password_hash, version::text AS version FROM app.users WHERE account_scope = 'ADMIN_WEB'")).rows,
    );
    const beside = run('staging-seed-fixtures.js', {
      env: seedEnv(),
      input: batch([
        { phone: FIXTURE_PHONE, password: FIXTURE_PASSWORD },
        { phone: SYSTEM_PHONE, password: FIXTURE_PASSWORD },
      ]),
    });
    assert.equal(beside.status, 0, beside.text);
    assert.match(beside.stdout, /created 1, skipped 1/);
    for (const [label, result] of [['created', created], ['again', again], ['beside', beside]]) assertNoSecrets(result, `seed ${label}`);
    const afterBeside = await snapshot();
    assert.equal(afterBeside.users, afterSeed.users + 1);
    assert.equal(afterBeside.memberships, afterSeed.memberships, 'the fixture beside SYSTEM gets no membership');
    await withClient(asMigrator, async (client) => {
      const adminAfter = (await client.query("SELECT user_id, password_hash, version::text AS version FROM app.users WHERE account_scope = 'ADMIN_WEB'")).rows;
      assert.deepEqual(adminAfter, adminBefore, 'the administration account is untouched');
    });
  });

  test('after everything the runtime role still works within its grants: it reads the limiter row and the SYSTEM membership, writes audit rows, and still cannot change either', async () => {
    await withClient(asRuntime, async (client) => {
      assert.equal((await client.query('SELECT count(*)::int AS n FROM app.admin_auth_limit_config')).rows[0].n, 1);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM app.admin_memberships WHERE admin_role = 'SYSTEM'")).rows[0].n, 1);
      await assert.rejects(client.query('DELETE FROM app.admin_memberships'), { code: '42501' });
      await assert.rejects(client.query('UPDATE app.admin_auth_limit_config SET limiter_key_id = limiter_key_id'), { code: '42501' });
    });
  });
});
