// M00-D1: the gates of `npm run db:migrate:remote`, exercised with fake collaborators (no database, no network).
// The real runner API and the SQL that reads the history are exercised against PostgreSQL by
// tests/integration/remote-migration-runner.int.spec.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { main, parseDatabaseUrl, listMigrationFiles } = require('../../scripts/db-migrate-remote.js');

const PASSWORD = 'SECRET_MARKER_REMOTE_MIGRATE_3f9';
const CA = '-----BEGIN CERTIFICATE-----\nSECRET_MARKER_CA_BODY\n-----END CERTIFICATE-----\n';
const HOST = 'pooler.example.test';
const MIGRATION_URL = `postgres://ship11_migrator.projref:${PASSWORD}@${HOST}:5432/postgres`;
const RUNTIME_URL = `postgres://ship11_app.projref:${PASSWORD}@${HOST}:5432/postgres`;
const GOOD_ENV = {
  APP_ENV: 'staging',
  MIGRATION_DATABASE_URL: MIGRATION_URL,
  MIGRATION_CONFIRM_TARGET: `${HOST}/postgres`,
  DB_SSL_CA: CA,
};
const FILES = ['100_a', '200_b', '300_c'];

// A harness that records everything the script does and everything it prints.
function harness({ state = { applied: ['100_a', '200_b'] }, versionNum = 170011, tls, connectError, migrateError, schemaPresent = true } = {}) {
  const log = { out: [], err: [], clients: [], tlsCalls: [], migrations: [], ended: 0, queries: [] };
  const client = {
    on: () => undefined,
    connect: async () => {
      if (connectError) throw connectError;
    },
    end: async () => {
      log.ended += 1;
    },
    query: async (sql) => {
      log.queries.push(sql);
      if (/server_version_num/.test(sql)) {
        return { rows: [{ version_num: versionNum, version: '17.11', role: 'ship11_migrator.projref', db: 'postgres' }] };
      }
      if (/to_regnamespace/.test(sql)) return { rows: [{ present: schemaPresent }] };
      if (/to_regclass/.test(sql)) return { rows: [{ present: state.applied.length > 0 }] };
      if (/FROM app\.pgmigrations/.test(sql)) return { rows: state.applied.map((name) => ({ name })) };
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const deps = {
    resolveDatabaseTls: (input) => {
      log.tlsCalls.push(input);
      return tls ?? { ok: true, tls: { ca: CA, rejectUnauthorized: true } };
    },
    safeErrorCode: (error) => error?.code ?? 'UNKNOWN',
    createClient: (config) => {
      log.clients.push(config);
      return client;
    },
    runMigrations: async (options) => {
      log.migrations.push(options);
      if (migrateError) throw migrateError;
      return ['300_c'];
    },
    migrationsDir: new URL('../../database/migrations', import.meta.url).pathname,
  };
  return { log, deps, client };
}

// The script lists real files; point the fake at the real directory but make "pending" deterministic by
// choosing applied names from the real file list.
const realFiles = listMigrationFiles();
const run = async (env, argv, h) =>
  main({ argv, env, deps: h.deps, out: (m) => h.log.out.push(m), err: (m) => h.log.err.push(m) });
const printed = (h) => [...h.log.out, ...h.log.err].join('\n');
const noSecrets = (h) => {
  const text = printed(h);
  assert.ok(!text.includes(PASSWORD), 'the password was printed');
  assert.ok(!text.includes('SECRET_MARKER_CA_BODY'), 'the CA was printed');
  assert.ok(!text.includes('postgres://'), 'a connection URL was printed');
};

describe('db:migrate:remote gates (nothing connects before every gate passes)', () => {
  test('refuses outside staging/production', async () => {
    for (const appEnv of [undefined, '', 'development', 'test']) {
      const h = harness();
      const code = await run({ ...GOOD_ENV, APP_ENV: appEnv }, [], h);
      assert.equal(code, 1, String(appEnv));
      assert.match(printed(h), /APP_ENV must be staging or production/);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('refuses a missing or malformed MIGRATION_DATABASE_URL by name, never by value', async () => {
    for (const url of [undefined, 'not a url', `mysql://u:${PASSWORD}@h/db`, `postgres://u:${PASSWORD}@/db`, `postgres://u:${PASSWORD}@h`]) {
      const h = harness();
      const code = await run({ ...GOOD_ENV, MIGRATION_DATABASE_URL: url }, [], h);
      assert.equal(code, 1, String(url));
      assert.match(printed(h), /MIGRATION_DATABASE_URL/);
      noSecrets(h);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('refuses when the migration role is the runtime role', async () => {
    const h = harness();
    const code = await run({ ...GOOD_ENV, DATABASE_URL: MIGRATION_URL }, [], h);
    assert.equal(code, 1);
    assert.match(printed(h), /same role/);
    assert.equal(h.log.clients.length, 0);
  });

  test('accepts a runtime URL with a different role present in the same environment', async () => {
    const h = harness({ state: { applied: realFiles } });
    assert.equal(await run({ ...GOOD_ENV, DATABASE_URL: RUNTIME_URL }, [], h), 0);
  });

  test('asks the shared TLS rules for strict TLS and passes the MIGRATION url to them', async () => {
    const h = harness({ state: { applied: realFiles } });
    await run(GOOD_ENV, [], h);
    assert.equal(h.log.tlsCalls.length, 1);
    assert.equal(h.log.tlsCalls[0].required, true);
    assert.equal(h.log.tlsCalls[0].databaseUrl, MIGRATION_URL);
  });

  test('refuses invalid TLS, mapping the URL problem to the right variable name and printing no value', async () => {
    const h = harness({ tls: { ok: false, invalid: ['DATABASE_URL', 'NODE_TLS_REJECT_UNAUTHORIZED', 'DB_SSL_CA'] } });
    const code = await run(GOOD_ENV, [], h);
    assert.equal(code, 1);
    const text = printed(h);
    assert.match(text, /MIGRATION_DATABASE_URL, NODE_TLS_REJECT_UNAUTHORIZED, DB_SSL_CA/);
    assert.doesNotMatch(text, /[^_]DATABASE_URL, NODE/);
    noSecrets(h);
    assert.equal(h.log.clients.length, 0);
  });

  test('refuses without the typed target, and a wrong target, telling the operator what to type', async () => {
    for (const confirm of [undefined, '', `${HOST}/other`, 'other-host/postgres', `${HOST}/postgres `]) {
      const h = harness();
      const code = await run({ ...GOOD_ENV, MIGRATION_CONFIRM_TARGET: confirm }, [], h);
      assert.equal(code, 1, String(confirm));
      assert.match(printed(h), new RegExp(`MIGRATION_CONFIRM_TARGET=${HOST}/postgres`));
      noSecrets(h);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('refuses unknown arguments (the only option is --apply)', async () => {
    for (const argv of [['--yes'], ['--apply', '--force'], ['down'], ['--no-lock']]) {
      const h = harness();
      assert.equal(await run(GOOD_ENV, argv, h), 1, argv.join(' '));
      assert.equal(h.log.clients.length, 0);
    }
  });
});

describe('db:migrate:remote behaviour once the gates pass', () => {
  test('connects with exactly { ca, rejectUnauthorized: true } and the migration URL', async () => {
    const h = harness({ state: { applied: realFiles } });
    await run(GOOD_ENV, [], h);
    assert.equal(h.log.clients.length, 1);
    assert.equal(h.log.clients[0].connectionString, MIGRATION_URL);
    assert.deepEqual(h.log.clients[0].ssl, { ca: CA, rejectUnauthorized: true });
  });

  test('defaults to a read-only check: reports pending migrations and changes nothing', async () => {
    const h = harness({ state: { applied: realFiles.slice(0, 2) } });
    const code = await run(GOOD_ENV, [], h);
    assert.equal(code, 0);
    assert.equal(h.log.migrations.length, 0, 'the runner must not be called without --apply');
    const text = printed(h);
    assert.match(text, /check only; nothing was changed/);
    assert.match(text, /connected over verified TLS to pooler\.example\.test\/postgres/);
    assert.match(text, new RegExp(`pending ${realFiles[2]}`));
    assert.ok(h.log.queries.every((sql) => /^\s*SELECT/i.test(sql)), 'check mode must only SELECT');
    assert.equal(h.log.ended, 1);
    noSecrets(h);
  });

  test('--apply runs the runner once, on the same verified client, with the migrations directory', async () => {
    const h = harness({ state: { applied: realFiles.slice(0, 2) } });
    const code = await run(GOOD_ENV, ['--apply'], h);
    assert.equal(code, 0);
    assert.equal(h.log.migrations.length, 1);
    assert.equal(h.log.migrations[0].client, h.client);
    assert.equal(h.log.migrations[0].dir, h.deps.migrationsDir);
    assert.equal(h.log.ended, 1);
    noSecrets(h);
  });

  test('--apply with nothing pending does not call the runner', async () => {
    const h = harness({ state: { applied: realFiles } });
    assert.equal(await run(GOOD_ENV, ['--apply'], h), 0);
    assert.equal(h.log.migrations.length, 0);
    assert.match(printed(h), /nothing to apply/);
  });

  test('keeps the history in the app schema and never touches Supabase\'s public schema', async () => {
    const h = harness({ state: { applied: realFiles } });
    await run(GOOD_ENV, ['--apply'], h);
    const all = h.log.queries.join('\n');
    assert.match(all, /app\.pgmigrations/);
    assert.doesNotMatch(all, /public\./);
  });

  test('refuses (check and apply) when the app schema was not created first, and never creates it', async () => {
    for (const argv of [[], ['--apply']]) {
      const h = harness({ schemaPresent: false });
      assert.equal(await run(GOOD_ENV, argv, h), 1, argv.join(' '));
      assert.match(printed(h), /schema app does not exist/);
      assert.equal(h.log.migrations.length, 0);
      assert.ok(h.log.queries.every((sql) => /^\s*SELECT/i.test(sql)), 'must only SELECT');
      assert.equal(h.log.ended, 1);
    }
  });

  test('refuses a server older than PostgreSQL 17, even with --apply', async () => {
    const h = harness({ versionNum: 160004, state: { applied: realFiles.slice(0, 2) } });
    assert.equal(await run(GOOD_ENV, ['--apply'], h), 1);
    assert.match(printed(h), /PostgreSQL 17 or newer is required/);
    assert.equal(h.log.migrations.length, 0);
    assert.equal(h.log.ended, 1);
  });

  test('refuses a database that has migrations this checkout does not know', async () => {
    const h = harness({ state: { applied: [...realFiles.slice(0, 2), '999_from_another_branch'] } });
    assert.equal(await run(GOOD_ENV, ['--apply'], h), 1);
    assert.match(printed(h), /999_from_another_branch/);
    assert.equal(h.log.migrations.length, 0);
  });

  test('a connection failure prints only a safe code, never the driver message, and still closes the client', async () => {
    const error = Object.assign(new Error(`password authentication failed for ${PASSWORD} at ${MIGRATION_URL}`), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
    const h = harness({ connectError: error });
    assert.equal(await run(GOOD_ENV, ['--apply'], h), 1);
    assert.match(printed(h), /connect failed \(code SELF_SIGNED_CERT_IN_CHAIN\)/);
    noSecrets(h);
    assert.equal(h.log.ended, 1);
  });

  test('a failing migration prints only the code and leaves the failure to the operator', async () => {
    const error = Object.assign(new Error(`syntax error near ${PASSWORD}`), { code: '42601' });
    const h = harness({ state: { applied: realFiles.slice(0, 2) }, migrateError: error });
    assert.equal(await run(GOOD_ENV, ['--apply'], h), 1);
    assert.match(printed(h), /migrate failed \(code 42601\)/);
    noSecrets(h);
    assert.equal(h.log.ended, 1);
  });
});

describe('helpers', () => {
  test('parseDatabaseUrl returns host, database and role only for a usable postgres URL', () => {
    assert.deepEqual(parseDatabaseUrl(MIGRATION_URL), { host: HOST, database: 'postgres', username: 'ship11_migrator.projref' });
    assert.equal(parseDatabaseUrl('http://h/db'), undefined);
    assert.equal(parseDatabaseUrl('nonsense'), undefined);
  });

  test('listMigrationFiles lists the real migrations in order, without the extension', () => {
    assert.ok(realFiles.length >= 7);
    assert.deepEqual(realFiles, [...realFiles].sort());
    assert.ok(realFiles.every((name) => /^\d+_[a-z0-9-]+$/.test(name)));
    assert.ok(FILES.length === 3);
  });
});
