// M00-D2: the gates and the transaction shape of `npm run staging:seed-fixtures`, exercised with fake collaborators
// (no database, no network, no compiled application). The parsing rules and the SQL are covered by the Jest unit
// specs and by the PostgreSQL integration suites (tests/integration/staging-fixture-seed.int.spec.ts).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { main } = require('../../scripts/staging-seed-fixtures.js');

const PASSWORD = 'SECRET_MARKER_SEED_PW_71c';
const PHONE = '+84911111111';
const CA = '-----BEGIN CERTIFICATE-----\nSECRET_MARKER_CA_BODY\n-----END CERTIFICATE-----\n';
const HOST = 'pooler.example.test';
const REF = 'abcdefghij0123456789';
const urlFor = ({ role, ref = REF, port = 5432 }) => `postgres://${role}.${ref}:${PASSWORD}@${HOST}:${port}/postgres`;
const TARGET = `${HOST}:5432/postgres/${REF}`;
const GOOD_ENV = {
  APP_ENV: 'staging',
  MIGRATION_DATABASE_URL: urlFor({ role: 'ship11_migrator' }),
  DATABASE_URL: urlFor({ role: 'ship11_app' }),
  MIGRATION_CONFIRM_TARGET: TARGET,
  DB_SSL_CA: CA,
  AUTH_STAGING_FIXTURES_ENABLED: 'true',
  AUTH_STAGING_ALLOWED_PHONES: JSON.stringify([PHONE]),
};
const INPUT = JSON.stringify([{ phone: PHONE, password: PASSWORD }]);

class FakeConflict extends Error {}

function harness({
  stdin = INPUT,
  stdinError,
  fixtures = { ok: true, config: { enabled: true, allowedPhones: { has: () => true } } },
  tls,
  payload = { ok: true, entries: [{ phoneNormalized: PHONE, password: PASSWORD }] },
  versionNum = 170011,
  originPresent = true,
  seedError,
  seedResult = { created: 1, skipped: 0 },
  connectError,
  commitError,
  prepareError,
} = {}) {
  const log = { out: [], err: [], clients: [], statements: [], events: [], stdinReads: 0, ended: 0, seedCalls: 0 };
  const client = {
    on: () => undefined,
    connect: async () => {
      log.events.push('connect');
      if (connectError) throw connectError;
    },
    end: async () => {
      log.ended += 1;
    },
    query: async (sql) => {
      log.statements.push(sql);
      if (/server_version_num/.test(sql)) {
        return { rows: [{ version_num: versionNum, role: 'ship11_migrator', users_present: true, origin_present: originPresent }] };
      }
      if (sql === 'COMMIT' && commitError) throw commitError;
      return { rows: [], rowCount: 0 };
    },
  };
  const deps = {
    parseStagingFixtures: () => fixtures,
    resolveDatabaseTls: (input) => {
      log.tlsInput = input;
      return tls ?? { ok: true, tls: { ca: CA, rejectUnauthorized: true } };
    },
    safeErrorCode: (error) => error?.code ?? 'UNKNOWN',
    parseSeedPayload: () => payload,
    StagingSeedConflictError: FakeConflict,
    createSeeder: () => ({
      prepare: async (entries) => {
        log.events.push('prepare');
        if (prepareError) throw prepareError;
        return entries.map((entry) => ({ phoneNormalized: entry.phoneNormalized, passwordHash: '$argon2id$stub' }));
      },
      seed: async (_context, prepared, requestId) => {
        log.seedCalls += 1;
        log.events.push('seed');
        log.requestId = requestId;
        log.prepared = prepared;
        if (seedError) throw seedError;
        return seedResult;
      },
    }),
    createClient: (config) => {
      log.clients.push(config);
      return client;
    },
    readStdin: async () => {
      log.stdinReads += 1;
      if (stdinError) throw stdinError;
      return stdin;
    },
    newRequestId: () => '123e4567-e89b-42d3-a456-426614174000',
  };
  return { log, deps };
}

const run = async (env, argv, h) => main({ argv, env, deps: h.deps, out: (m) => h.log.out.push(m), err: (m) => h.log.err.push(m) });
const printed = (h) => [...h.log.out, ...h.log.err].join('\n');
const noSecrets = (h) => {
  const text = printed(h);
  for (const secret of [PASSWORD, 'SECRET_MARKER_CA_BODY', PHONE, 'postgres://']) {
    assert.ok(!text.includes(secret), `printed a secret: ${secret.slice(0, 12)}`);
  }
};

describe('staging:seed-fixtures gates (nothing is read or connected before every gate passes)', () => {
  test('takes no argument at all, so no password can travel in argv', async () => {
    for (const argv of [['--apply'], [PASSWORD], ['--password', PASSWORD], ['x']]) {
      const h = harness();
      assert.equal(await run(GOOD_ENV, argv, h), 1, argv.join(' '));
      assert.match(printed(h), /takes no argument/);
      noSecrets(h);
      assert.equal(h.log.stdinReads, 0);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('is staging only: production, development, test and an unset APP_ENV are refused', async () => {
    for (const appEnv of [undefined, '', 'production', 'development', 'test']) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, APP_ENV: appEnv }, [], h), 1, String(appEnv));
      assert.match(printed(h), /APP_ENV must be staging/);
      assert.equal(h.log.stdinReads, 0);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('uses the shared D1 target gates: session pooler 5432, same project, different role, required runtime URL', async () => {
    const cases = [
      ['transaction pooler port', { MIGRATION_DATABASE_URL: urlFor({ role: 'ship11_migrator', port: 6543 }) }, /SESSION pooler on port 5432/],
      ['runtime port', { DATABASE_URL: urlFor({ role: 'ship11_app', port: 6543 }) }, /SESSION pooler on port 5432/],
      ['another project', { DATABASE_URL: urlFor({ role: 'ship11_app', ref: 'zyxwvutsrq9876543210' }) }, /differ in: projectRef/],
      ['same role', { DATABASE_URL: urlFor({ role: 'ship11_migrator' }) }, /same role/],
      ['no runtime URL', { DATABASE_URL: undefined }, /DATABASE_URL/],
      ['no migration URL', { MIGRATION_DATABASE_URL: undefined }, /MIGRATION_DATABASE_URL/],
    ];
    for (const [label, change, pattern] of cases) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, ...change }, [], h), 1, label);
      assert.match(printed(h), pattern, label);
      noSecrets(h);
      assert.equal(h.log.stdinReads, 0, label);
      assert.equal(h.log.clients.length, 0, label);
    }
  });

  test('requires the fixture mode configured as the application validates it, naming variables only', async () => {
    const off = harness({ fixtures: { ok: true, config: undefined } });
    assert.equal(await run(GOOD_ENV, [], off), 1);
    assert.match(printed(off), /AUTH_STAGING_FIXTURES_ENABLED/);
    const bad = harness({ fixtures: { ok: false, invalid: ['AUTH_STAGING_ALLOWED_PHONES'] } });
    assert.equal(await run(GOOD_ENV, [], bad), 1);
    assert.match(printed(bad), /AUTH_STAGING_ALLOWED_PHONES/);
    for (const h of [off, bad]) {
      noSecrets(h);
      assert.equal(h.log.stdinReads, 0);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('refuses invalid TLS with variable names only, mapping the URL to MIGRATION_DATABASE_URL', async () => {
    const h = harness({ tls: { ok: false, invalid: ['DATABASE_URL', 'DB_SSL_CA'] } });
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.match(printed(h), /MIGRATION_DATABASE_URL, DB_SSL_CA/);
    assert.equal(h.log.tlsInput.required, true);
    noSecrets(h);
    assert.equal(h.log.stdinReads, 0);
    assert.equal(h.log.clients.length, 0);
  });

  test('refuses a missing or wrong typed target, telling the operator what to type', async () => {
    for (const confirm of [undefined, '', `${HOST}/postgres`, `${HOST}:5432/postgres/zyxwvutsrq9876543210`, `${TARGET} `]) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, MIGRATION_CONFIRM_TARGET: confirm }, [], h), 1, String(confirm));
      assert.match(printed(h), new RegExp(`MIGRATION_CONFIRM_TARGET=${TARGET}`));
      assert.equal(h.log.stdinReads, 0);
      assert.equal(h.log.clients.length, 0);
    }
  });
});

describe('staging:seed-fixtures input (validated and hashed before any connection)', () => {
  test('a terminal or unreadable stdin, invalid JSON and every payload problem stop before a client exists', async () => {
    const cases = [
      ['tty', harness({ stdinError: Object.assign(new Error('x'), { code: 'STDIN_IS_TTY' }) }), /STDIN_IS_TTY/],
      ['too large', harness({ stdinError: Object.assign(new Error('x'), { code: 'STDIN_TOO_LARGE' }) }), /STDIN_TOO_LARGE/],
      ['not json', harness({ stdin: `{ ${PASSWORD}` }), /not valid JSON/],
      ['shape', harness({ payload: { ok: false, problem: 'SHAPE' } }), /exactly the keys/],
      ['not allowed', harness({ payload: { ok: false, problem: 'PHONE_NOT_ALLOWED' } }), /AUTH_STAGING_ALLOWED_PHONES/],
      ['too many', harness({ payload: { ok: false, problem: 'TOO_MANY' } }), /more than 20/],
      ['password', harness({ payload: { ok: false, problem: 'PASSWORD_INVALID' } }), /password rules/],
    ];
    for (const [label, h, pattern] of cases) {
      assert.equal(await run(GOOD_ENV, [], h), 1, label);
      assert.match(printed(h), pattern, label);
      noSecrets(h);
      assert.equal(h.log.clients.length, 0, label);
      assert.equal(h.log.seedCalls, 0, label);
    }
  });

  test('hashes BEFORE connecting, and a hashing failure never opens a connection', async () => {
    const ok = harness();
    await run(GOOD_ENV, [], ok);
    assert.deepEqual(ok.log.events.slice(0, 2), ['prepare', 'connect']);
    const failed = harness({ prepareError: Object.assign(new Error(`boom ${PASSWORD}`), { code: 'ERR_HASH' }) });
    assert.equal(await run(GOOD_ENV, [], failed), 1);
    assert.match(printed(failed), /hashing failed \(code ERR_HASH\)/);
    noSecrets(failed);
    assert.equal(failed.log.clients.length, 0);
  });
});

describe('staging:seed-fixtures once the gates pass', () => {
  test('connects with exactly { ca, rejectUnauthorized: true } and the OPERATOR url, then one transaction around the seed', async () => {
    const h = harness();
    assert.equal(await run(GOOD_ENV, [], h), 0);
    assert.equal(h.log.clients.length, 1);
    assert.equal(h.log.clients[0].connectionString, GOOD_ENV.MIGRATION_DATABASE_URL);
    assert.deepEqual(h.log.clients[0].ssl, { ca: CA, rejectUnauthorized: true });
    const sql = h.log.statements.filter((s) => !/server_version_num/.test(s));
    assert.deepEqual(sql, ['BEGIN', "SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '30s'", 'COMMIT']);
    assert.equal(h.log.seedCalls, 1);
    assert.equal(h.log.requestId, '123e4567-e89b-42d3-a456-426614174000');
    assert.match(printed(h), /created 1, skipped 0 \(existing fixtures are left unchanged\)/);
    noSecrets(h);
    assert.equal(h.log.ended, 1);
  });

  test('a database older than PostgreSQL 17, or without account_origin, stops before BEGIN', async () => {
    for (const options of [{ versionNum: 160004 }, { originPresent: false }]) {
      const h = harness(options);
      assert.equal(await run(GOOD_ENV, [], h), 1);
      assert.ok(!h.log.statements.includes('BEGIN'));
      assert.equal(h.log.seedCalls, 0);
      assert.equal(h.log.ended, 1);
    }
    const missing = harness({ originPresent: false });
    await run(GOOD_ENV, [], missing);
    assert.match(printed(missing), /account_origin is missing/);
  });

  test('a verified account in the batch rolls the whole batch back and says nothing about the phone', async () => {
    const h = harness({ seedError: new FakeConflict(`verified ${PHONE}`) });
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.ok(h.log.statements.includes('ROLLBACK'));
    assert.ok(!h.log.statements.includes('COMMIT'));
    assert.match(printed(h), /belongs to a verified account.*rolled back/);
    noSecrets(h);
    assert.equal(h.log.ended, 1);
  });

  test('any other failure rolls back and prints only a safe code, never the driver message', async () => {
    const error = Object.assign(new Error(`insert failed for ${PHONE} ${PASSWORD} at ${GOOD_ENV.MIGRATION_DATABASE_URL}`), { code: '23505' });
    const h = harness({ seedError: error });
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.ok(h.log.statements.includes('ROLLBACK'));
    assert.ok(!h.log.statements.includes('COMMIT'));
    assert.match(printed(h), /seed failed \(code 23505\)/);
    noSecrets(h);
  });

  test('a connection failure prints only a safe code and still closes the client', async () => {
    const error = Object.assign(new Error(`auth failed ${PASSWORD}`), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    const h = harness({ connectError: error });
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.match(printed(h), /connect failed \(code SELF_SIGNED_CERT_IN_CHAIN\)/);
    noSecrets(h);
    assert.equal(h.log.ended, 1);
  });

  test('a failed COMMIT reports an unknown outcome and that re-running is safe; it does not pretend to roll back', async () => {
    const h = harness({ commitError: Object.assign(new Error('x'), { code: '08006' }) });
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.match(printed(h), /commit failed \(code 08006\).*unknown.*safe/);
    assert.ok(!h.log.statements.includes('ROLLBACK'));
    assert.equal(h.log.ended, 1);
  });
});

describe('staging:seed-fixtures source', () => {
  const source = readFileSync(new URL('../../scripts/staging-seed-fixtures.js', import.meta.url), 'utf8');
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

  test('never reads a value from argv beyond refusing it, and never writes the payload', () => {
    assert.match(code, /argv\.length > 0/);
    assert.doesNotMatch(code, /argv\[\d\]|argv\.slice\(\d\)\.|process\.argv\.(?!slice\(2\))/);
    assert.doesNotMatch(code, /console\.(log|error)\([^)]*(rawInput|json|parsed|entries|password)/i);
  });

  test('shares the D1 target gates instead of copying them, and never creates a role, profile or session', () => {
    assert.match(code, /checkRemoteTargets/);
    assert.doesNotMatch(code, /user_roles|INSERT INTO|UPDATE app|DELETE FROM|sessions/i);
  });
});
