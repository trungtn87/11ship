// M00-VPS-01 package A: the JavaScript operator commands (db:migrate:remote, staging:seed-fixtures) and the TypeScript
// administration CLI guard (admin-auth:init-limit-config / bootstrap-system) must accept and refuse exactly the same
// remote targets. The two implementations are separate code (JS scripts cannot import the TS source), so this test runs
// ONE case matrix through all three and fails if any verdict differs. No database, no network: a gate that passes is
// recognised by the command reaching the first thing that would connect or read standard input.
//
// It needs the compiled application (`npm run build`), because the TypeScript guard and the TLS rules are tested as
// compiled. CI builds before running `npm run deploy:test`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

const guardFile = root('apps/backend/dist/admin-auth/cli/cli-target-guard.js');
const tlsFile = root('apps/backend/dist/database/tls-config.js');
assert.ok(existsSync(guardFile) && existsSync(tlsFile), 'the compiled application is missing: run "npm run build" first');
const tsGuard = require(guardFile);
const tsTls = require(tlsFile);
const jsTarget = require('../../scripts/db-remote-target.js');
const migrate = require('../../scripts/db-migrate-remote.js');
const seed = require('../../scripts/staging-seed-fixtures.js');

const CA = readFileSync(root('tests/fixtures/selfhosted-test-ca.pem'), 'utf8');
const PASSWORD = 'SECRET_MARKER_PARITY_71c';
const url = ({ user, host = 'localhost', port = '5432', db = 'ship11_staging', suffix = '' }) =>
  `postgres://${user}:${PASSWORD}@${host}${port === '' ? '' : `:${port}`}/${db}${suffix}`;
const MIGRATION_URL = url({ user: 'ship11_migrator' });
const RUNTIME_URL = url({ user: 'ship11_app' });
const GOOD = {
  APP_ENV: 'staging',
  DB_REMOTE_TARGET: 'SELF_HOSTED',
  MIGRATION_DATABASE_URL: MIGRATION_URL,
  DATABASE_URL: RUNTIME_URL,
  MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_staging',
  DB_SSL_CA: CA,
};

// The three verdicts. "accepted" = every gate passed.
function tsAccepts(env) {
  return tsGuard.resolveCliTarget(env).ok === true;
}

async function migrateAccepts(env) {
  let reached = false;
  const deps = {
    resolveDatabaseTls: tsTls.resolveDatabaseTls,
    safeErrorCode: () => 'STOP',
    createClient: () => {
      reached = true;
      return {
        on: () => undefined,
        connect: async () => {
          throw new Error('stop');
        },
        end: async () => undefined,
        query: async () => {
          throw new Error('no query expected');
        },
      };
    },
    runMigrations: async () => {
      throw new Error('no migration expected');
    },
    migrationsDir: root('database/migrations'),
  };
  await migrate.main({ argv: [], env, deps, out: () => undefined, err: () => undefined });
  return reached;
}

async function seedAccepts(env) {
  let reached = false;
  const deps = {
    parseStagingFixtures: () => ({ ok: true, config: { allowedPhones: [] } }),
    resolveDatabaseTls: tsTls.resolveDatabaseTls,
    safeErrorCode: () => 'STOP',
    parseSeedPayload: () => ({ ok: false, problem: 'SHAPE' }),
    StagingSeedConflictError: class extends Error {},
    createSeeder: () => ({ prepare: async () => [] }),
    createClient: () => {
      throw new Error('no client expected');
    },
    readStdin: async () => {
      reached = true;
      throw Object.assign(new Error('stop'), { code: 'STDIN_IS_TTY' });
    },
    newRequestId: () => 'id',
  };
  await seed.main({ argv: [], env, deps, out: () => undefined, err: () => undefined });
  return reached;
}

// One mutation per case, plus a few pairs. `expected` is what the contract says, written by hand, so the matrix cannot
// pass by being consistently wrong in all three implementations.
const CASES = [
  ['good', {}, true],
  ['selector unset (Supabase path) with self-hosted URLs', { DB_REMOTE_TARGET: undefined }, false],
  ['selector SUPABASE with self-hosted URLs', { DB_REMOTE_TARGET: 'SUPABASE' }, false],
  ['selector lower case', { DB_REMOTE_TARGET: 'self_hosted' }, false],
  ['selector empty', { DB_REMOTE_TARGET: '' }, false],
  ['selector with a space', { DB_REMOTE_TARGET: ' SELF_HOSTED' }, false],
  ['selector unknown', { DB_REMOTE_TARGET: 'LOCAL' }, false],
  ['production', { APP_ENV: 'production' }, false],
  ['migration host 127.0.0.1', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', host: '127.0.0.1' }) }, false],
  ['migration host upper case', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', host: 'LOCALHOST' }) }, false],
  ['migration host trailing dot', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', host: 'localhost.' }) }, false],
  ['migration host remote', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', host: 'db.example.test' }) }, false],
  ['runtime host differs', { DATABASE_URL: url({ user: 'ship11_app', host: '127.0.0.1' }) }, false],
  ['migration port 5433', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', port: '5433' }) }, false],
  ['runtime port 6543', { DATABASE_URL: url({ user: 'ship11_app', port: '6543' }) }, false],
  ['migration port omitted (default 5432)', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', port: '' }) }, true],
  ['migration database differs', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', db: 'postgres' }) }, false],
  ['runtime database differs', { DATABASE_URL: url({ user: 'ship11_app', db: 'ship11_test' }) }, false],
  ['migration query string', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', suffix: '?sslmode=disable' }) }, false],
  ['runtime query string', { DATABASE_URL: url({ user: 'ship11_app', suffix: '?ssl=false' }) }, false],
  ['migration bare question mark', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', suffix: '?' }) }, false],
  ['migration fragment', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', suffix: '#x' }) }, false],
  ['same role (migrator twice)', { DATABASE_URL: MIGRATION_URL }, false],
  ['same role (app twice)', { MIGRATION_DATABASE_URL: RUNTIME_URL }, false],
  ['roles swapped', { MIGRATION_DATABASE_URL: RUNTIME_URL, DATABASE_URL: MIGRATION_URL }, false],
  ['migration role postgres', { MIGRATION_DATABASE_URL: url({ user: 'postgres' }) }, false],
  ['runtime role postgres', { DATABASE_URL: url({ user: 'postgres' }) }, false],
  ['Supabase pooler user name form', { MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator.abcdefghij0123456789' }) }, false],
  ['migration url missing', { MIGRATION_DATABASE_URL: undefined }, false],
  ['runtime url missing', { DATABASE_URL: undefined }, false],
  ['migration url garbage', { MIGRATION_DATABASE_URL: 'not a url' }, false],
  ['runtime url wrong protocol', { DATABASE_URL: 'mysql://ship11_app:x@localhost:5432/ship11_staging' }, false],
  ['migration url without user', { MIGRATION_DATABASE_URL: 'postgres://localhost:5432/ship11_staging' }, false],
  ['migration url bad percent-encoding', { MIGRATION_DATABASE_URL: 'postgres://ship11_migrator:x@localhost:5432/ship11_%zz' }, false],
  ['confirm target missing', { MIGRATION_CONFIRM_TARGET: undefined }, false],
  ['confirm target empty', { MIGRATION_CONFIRM_TARGET: '' }, false],
  ['confirm target with trailing space', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_staging ' }, false],
  ['confirm target other database', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_test' }, false],
  ['confirm target Supabase form', { MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_staging/abcdefghij0123456789' }, false],
  ['CA missing', { DB_SSL_CA: undefined }, false],
  ['CA garbage', { DB_SSL_CA: 'not a certificate' }, false],
  ['CA and CA file both set', { DB_SSL_CA_FILE: '/nonexistent/ca.pem' }, false],
  ['CA file unreadable', { DB_SSL_CA: undefined, DB_SSL_CA_FILE: '/nonexistent/ca.pem' }, false],
  ['CA with a private key block', { DB_SSL_CA: `${CA}-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n` }, false],
  ['TLS verification switched off process-wide', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, false],
  ['pair: production and wrong host', { APP_ENV: 'production', MIGRATION_DATABASE_URL: url({ user: 'ship11_migrator', host: 'db.example.test' }) }, false],
  ['pair: unknown selector and good rest', { DB_REMOTE_TARGET: 'SELF-HOSTED', MIGRATION_CONFIRM_TARGET: 'localhost:5432/ship11_staging' }, false],
];

describe('one case matrix through db:migrate:remote, staging:seed-fixtures and the TypeScript admin CLI guard', () => {
  for (const [name, mutation, expected] of CASES) {
    test(`${expected ? 'accepts' : 'refuses'}: ${name}`, async () => {
      const env = { ...GOOD, ...mutation };
      for (const key of Object.keys(env)) {
        if (env[key] === undefined) delete env[key];
      }
      const verdicts = { typescript: tsAccepts(env), migrate: await migrateAccepts(env), seed: await seedAccepts(env) };
      assert.deepEqual(verdicts, { typescript: expected, migrate: expected, seed: expected }, name);
      // The pure gate shared by migrate and seed never accepts what the full command refuses for a TARGET reason.
      if (expected) {
        assert.equal(migrate.checkRemoteTargets(env).problem, undefined);
      }
    });
  }

  test('the Supabase path is untouched: no selector, or SUPABASE, with the Supabase URLs, passes the target gates in all three', async () => {
    const ref = 'abcdefghij0123456789';
    const supabase = {
      APP_ENV: 'staging',
      MIGRATION_DATABASE_URL: `postgres://ship11_migrator.${ref}:${PASSWORD}@pooler.example.test:5432/postgres`,
      DATABASE_URL: `postgres://ship11_app.${ref}:${PASSWORD}@pooler.example.test:5432/postgres`,
      MIGRATION_CONFIRM_TARGET: `pooler.example.test:5432/postgres/${ref}`,
      DB_SSL_CA: CA,
    };
    for (const selector of [undefined, 'SUPABASE']) {
      const env = { ...supabase, ...(selector === undefined ? {} : { DB_REMOTE_TARGET: selector }) };
      assert.equal(tsAccepts(env), true, String(selector));
      assert.equal(await migrateAccepts(env), true, String(selector));
      assert.equal(await seedAccepts(env), true, String(selector));
    }
    // And SELF_HOSTED with the Supabase URLs is refused by all three.
    const mixed = { ...supabase, DB_REMOTE_TARGET: 'SELF_HOSTED' };
    assert.equal(tsAccepts(mixed), false);
    assert.equal(await migrateAccepts(mixed), false);
    assert.equal(await seedAccepts(mixed), false);
  });
});

describe('the constants, the identity query and the identity verdict are the same in JavaScript and TypeScript', () => {
  test('target constants are equal', () => {
    assert.deepEqual({ ...jsTarget.SELF_HOSTED }, { ...tsGuard.SELF_HOSTED_TARGET });
    assert.equal(jsTarget.SELECTOR_VARIABLE, tsGuard.SELECTOR_VARIABLE);
    assert.equal(jsTarget.SELF_HOSTED.confirmTarget, `${jsTarget.SELF_HOSTED.host}:${jsTarget.SELF_HOSTED.port}/${jsTarget.SELF_HOSTED.database}`);
  });

  test('the identity query text is identical (read-only SELECT)', () => {
    assert.equal(jsTarget.SELF_HOSTED_IDENTITY_SQL, tsGuard.SELF_HOSTED_IDENTITY_SQL);
    assert.match(jsTarget.SELF_HOSTED_IDENTITY_SQL, /^SELECT /);
    assert.doesNotMatch(jsTarget.SELF_HOSTED_IDENTITY_SQL, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b/i);
  });

  const good = {
    database_name: 'ship11_staging',
    user_name: 'ship11_migrator',
    session_user_name: 'ship11_migrator',
    server_port: 5432,
    tls: true,
    privileged: false,
  };
  const ROWS = [
    ['good', good, true],
    ['good, port as text', { ...good, server_port: '5432' }, true],
    ['other database', { ...good, database_name: 'postgres' }, false],
    ['marker in database name', { ...good, database_name: 'SECRET_ROW_MARKER' }, false],
    ['marker in role name', { ...good, user_name: 'SECRET_ROW_MARKER' }, false],
    ['other current role', { ...good, user_name: 'ship11_app' }, false],
    ['other session role', { ...good, session_user_name: 'postgres' }, false],
    ['superuser-like role', { ...good, privileged: true }, false],
    ['privilege unknown (role row missing)', { ...good, privileged: null }, false],
    ['other port', { ...good, server_port: 5433 }, false],
    ['unix socket (no port)', { ...good, server_port: null }, false],
    ['no TLS', { ...good, tls: false }, false],
    ['TLS unknown', { ...good, tls: null }, false],
    ['empty row', {}, false],
    ['no row', undefined, false],
  ];
  for (const [name, row, ok] of ROWS) {
    test(`identity ${ok ? 'accepted' : 'refused'} the same way: ${name}`, () => {
      const js = jsTarget.selfHostedIdentityProblem(row);
      const ts = tsGuard.selfHostedIdentityProblem(row);
      assert.equal(js, ts);
      assert.equal(js === undefined, ok);
      if (js !== undefined) {
        assert.doesNotMatch(js, /SECRET_ROW_MARKER/, 'no value from the row may be echoed');
      }
    });
  }
});
