// Issue #49 follow-up: the gates and the pure parts of `npm run staging:db-upgrade-from-42`, exercised with fake collaborators
// (no database, no network, no compiled application). The behaviour against PostgreSQL (the rebuild, the SYSTEM login after it,
// the rollback, the recovery) is covered by tests/integration/staging-db-upgrade-from-42.int.spec.ts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const tool = require('../../scripts/staging-db-upgrade-from-42.js');
const { main, upSection, parseSnapshotKey, checkSnapshotPath, encryptSnapshot, decryptSnapshot, writeSnapshotFile, CONFIRM_PHRASE } = tool;

const PASSWORD = 'SECRET_MARKER_UPGRADE_PW_5d1';
const CA = '-----BEGIN CERTIFICATE-----\nSECRET_MARKER_CA_BODY\n-----END CERTIFICATE-----\n';
const HOST = 'pooler.example.test';
const REF = 'abcdefghij0123456789';
const urlFor = ({ role, ref = REF, port = 5432 }) => `postgres://${role}.${ref}:${PASSWORD}@${HOST}:${port}/postgres`;
const TARGET = `${HOST}:5432/postgres/${REF}`;
const SNAPSHOT_KEY = Buffer.alloc(32, 7).toString('base64');
const KEYRING = 'SECRET_MARKER_KEYRING';
const GOOD_ENV = {
  APP_ENV: 'staging',
  MIGRATION_DATABASE_URL: urlFor({ role: 'ship11_migrator' }),
  DATABASE_URL: urlFor({ role: 'ship11_app' }),
  MIGRATION_CONFIRM_TARGET: TARGET,
  DB_SSL_CA: CA,
  CRYPTO_KEYRING: KEYRING,
  CRYPTO_ACTIVE_KEY_ID: 'k1',
};

function harness({ tls, keyring = { ok: true, keyring: {} }, connectError } = {}) {
  const log = { out: [], err: [], clients: [], statements: [], tlsInput: undefined, keyringInput: undefined };
  const client = {
    on: () => undefined,
    connect: async () => {
      if (connectError) throw connectError;
    },
    end: async () => undefined,
    query: async (sql) => {
      log.statements.push(String(sql));
      throw Object.assign(new Error('stop here'), { code: 'FAKE_STOP' });
    },
  };
  const deps = {
    resolveDatabaseTls: (input) => {
      log.tlsInput = input;
      return tls ?? { ok: true, tls: { ca: CA, rejectUnauthorized: true } };
    },
    parseKeyringConfig: (raw, active) => {
      log.keyringInput = [raw, active];
      return keyring;
    },
    safeErrorCode: (error) => error?.code ?? 'UNKNOWN',
    createAudit: () => undefined,
    createClient: (config) => {
      log.clients.push(config);
      return client;
    },
    migrationsDir: join(process.cwd(), 'database', 'migrations'),
  };
  return { log, deps };
}
const run = async (env, argv, h) => main({ argv, env, deps: h.deps, out: (m) => h.log.out.push(m), err: (m) => h.log.err.push(m) });
const printed = (h) => [...h.log.out, ...h.log.err].join('\n');
const noSecrets = (h) => {
  const text = printed(h);
  for (const secret of [PASSWORD, 'SECRET_MARKER_CA_BODY', KEYRING, SNAPSHOT_KEY, 'postgres://']) {
    assert.ok(!text.includes(secret), `printed a secret: ${secret.slice(0, 12)}`);
  }
};

describe('staging:db-upgrade-from-42 gates (nothing is connected before every gate passes)', () => {
  test('accepts only --apply or --restore-snapshot, never both and never a free argument', async () => {
    for (const argv of [['x'], ['--force'], [PASSWORD], ['--apply', '--restore-snapshot'], ['--apply', '--dry-run'], ['--verify', '--apply'], ['--verify', '--verify']]) {
      const h = harness();
      assert.equal(await run(GOOD_ENV, argv, h), 1, argv.join(' '));
      assert.match(printed(h), /No other argument exists/);
      noSecrets(h);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('is staging only: production, development, test and an unset APP_ENV are refused', async () => {
    for (const appEnv of [undefined, '', 'production', 'development', 'test']) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, APP_ENV: appEnv }, [], h), 1, String(appEnv));
      assert.match(printed(h), /APP_ENV must be staging/);
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('refuses a missing compiled application (null deps: what loadDefaultDeps returns without a build)', async () => {
    const h = harness();
    assert.equal(await main({ argv: [], env: GOOD_ENV, deps: null, out: (m) => h.log.out.push(m), err: (m) => h.log.err.push(m) }), 1);
    assert.match(printed(h), /npm run build/);
  });

  test('uses the shared D1 target gates', async () => {
    const cases = [
      ['transaction pooler port', { MIGRATION_DATABASE_URL: urlFor({ role: 'ship11_migrator', port: 6543 }) }, /SESSION pooler on port 5432/],
      ['another project', { DATABASE_URL: urlFor({ role: 'ship11_app', ref: 'zyxwvutsrq9876543210' }) }, /differ in: projectRef/],
      ['same role', { DATABASE_URL: urlFor({ role: 'ship11_migrator' }) }, /same role/],
      ['no runtime URL', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ];
    for (const [label, change, pattern] of cases) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, ...change }, [], h), 1, label);
      assert.match(printed(h), pattern, label);
      noSecrets(h);
      assert.equal(h.log.clients.length, 0, label);
    }
  });

  test('refuses invalid TLS (names only) and a missing or wrong typed target', async () => {
    const tls = harness({ tls: { ok: false, invalid: ['DATABASE_URL', 'DB_SSL_CA'] } });
    assert.equal(await run(GOOD_ENV, [], tls), 1);
    assert.match(printed(tls), /MIGRATION_DATABASE_URL, DB_SSL_CA/);
    assert.equal(tls.log.tlsInput.required, true);
    noSecrets(tls);
    for (const confirm of [undefined, '', `${HOST}/postgres`, `${TARGET} `]) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, MIGRATION_CONFIRM_TARGET: confirm }, [], h), 1);
      assert.match(printed(h), new RegExp(`MIGRATION_CONFIRM_TARGET=${TARGET}`));
      assert.equal(h.log.clients.length, 0);
    }
  });

  test('needs the current keyring even for the dry-run, and never prints it', async () => {
    for (const change of [{ CRYPTO_KEYRING: undefined }, { CRYPTO_ACTIVE_KEY_ID: undefined }]) {
      const h = harness();
      assert.equal(await run({ ...GOOD_ENV, ...change }, [], h), 1);
      assert.match(printed(h), /CRYPTO_KEYRING, CRYPTO_ACTIVE_KEY_ID/);
      assert.equal(h.log.clients.length, 0);
    }
    const bad = harness({ keyring: { ok: false, invalid: ['CRYPTO_KEYRING'] } });
    assert.equal(await run(GOOD_ENV, [], bad), 1);
    assert.match(printed(bad), /CRYPTO_KEYRING/);
    noSecrets(bad);
    assert.equal(bad.log.clients.length, 0);
  });

  test('--apply needs a valid snapshot key, a new snapshot file outside the repository, and the typed confirmation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-gates-'));
    try {
      const file = join(dir, 'snapshot.bin');
      const good = { ...GOOD_ENV, STAGING_UPGRADE_SNAPSHOT_KEY: SNAPSHOT_KEY, STAGING_UPGRADE_SNAPSHOT_FILE: file, STAGING_UPGRADE_CONFIRM: CONFIRM_PHRASE };
      const cases = [
        ['no key', { STAGING_UPGRADE_SNAPSHOT_KEY: undefined }, /STAGING_UPGRADE_SNAPSHOT_KEY/],
        ['short key', { STAGING_UPGRADE_SNAPSHOT_KEY: Buffer.alloc(16, 1).toString('base64') }, /STAGING_UPGRADE_SNAPSHOT_KEY/],
        ['no file', { STAGING_UPGRADE_SNAPSHOT_FILE: undefined }, /SNAPSHOT_PATH/],
        ['relative file', { STAGING_UPGRADE_SNAPSHOT_FILE: 'snapshot.bin' }, /SNAPSHOT_PATH/],
        ['file in the repository', { STAGING_UPGRADE_SNAPSHOT_FILE: join(process.cwd(), 'snapshot.bin') }, /SNAPSHOT_IN_REPOSITORY/],
        ['folder missing', { STAGING_UPGRADE_SNAPSHOT_FILE: join(dir, 'missing', 'snapshot.bin') }, /SNAPSHOT_PATH/],
        ['no confirmation', { STAGING_UPGRADE_CONFIRM: undefined }, new RegExp(CONFIRM_PHRASE)],
        ['wrong confirmation', { STAGING_UPGRADE_CONFIRM: 'yes' }, new RegExp(CONFIRM_PHRASE)],
      ];
      for (const [label, change, pattern] of cases) {
        const h = harness();
        assert.equal(await run({ ...good, ...change }, ['--apply'], h), 1, label);
        assert.match(printed(h), pattern, label);
        noSecrets(h);
        assert.equal(h.log.clients.length, 0, label);
      }
      writeFileSync(file, 'x');
      const exists = harness();
      assert.equal(await run(good, ['--apply'], exists), 1);
      assert.match(printed(exists), /SNAPSHOT_EXISTS/);
      assert.equal(exists.log.clients.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--restore-snapshot needs an existing snapshot file and the key, but no rebuild confirmation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-gates-'));
    try {
      const h = harness();
      const env = { ...GOOD_ENV, STAGING_UPGRADE_SNAPSHOT_KEY: SNAPSHOT_KEY, STAGING_UPGRADE_SNAPSHOT_FILE: join(dir, 'none.bin') };
      assert.equal(await run(env, ['--restore-snapshot'], h), 1);
      assert.match(printed(h), /SNAPSHOT_MISSING/);
      assert.equal(h.log.clients.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--verify (read-only check after an unknown COMMIT outcome) needs the existing snapshot and the key, and no confirmation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-gates-'));
    try {
      const file = join(dir, 'snapshot.bin');
      const base = { ...GOOD_ENV, STAGING_UPGRADE_SNAPSHOT_KEY: SNAPSHOT_KEY, STAGING_UPGRADE_SNAPSHOT_FILE: file };
      const missing = harness();
      assert.equal(await run(base, ['--verify'], missing), 1);
      assert.match(printed(missing), /SNAPSHOT_MISSING/);
      const noKey = harness();
      assert.equal(await run({ ...base, STAGING_UPGRADE_SNAPSHOT_KEY: undefined }, ['--verify'], noKey), 1);
      assert.match(printed(noKey), /STAGING_UPGRADE_SNAPSHOT_KEY/);
      for (const h of [missing, noKey]) {
        assert.equal(h.log.clients.length, 0);
        noSecrets(h);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the dry-run reads only: a failing first query ends it with a code, nothing was changed, no statement writes', async () => {
    const h = harness();
    assert.equal(await run(GOOD_ENV, [], h), 1);
    assert.match(printed(h), /Nothing was changed/);
    assert.equal(h.log.clients.length, 1);
    assert.equal(h.log.clients[0].ssl.rejectUnauthorized, true);
    for (const sql of h.log.statements) {
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT)\b/i);
    }
    noSecrets(h);
  });
});

describe('staging:db-upgrade-from-42 pure parts', () => {
  test('upSection returns the Up part only and refuses a file without one', () => {
    assert.equal(upSection('-- Up Migration\nSELECT 1;\n-- Down Migration\nSELECT 2;\n').trim(), 'SELECT 1;');
    assert.equal(upSection('-- Up Migration\nSELECT 1;\n').trim(), 'SELECT 1;');
    assert.throws(() => upSection('SELECT 1;'), /Up section/);
    for (const name of ['1792022400000_create-admin-auth', '1792627200000_allow-staging-fixture-account-origin']) {
      const sql = readFileSync(join(process.cwd(), 'database', 'migrations', `${name}.sql`), 'utf8');
      assert.doesNotMatch(upSection(sql), /Down Migration/i);
      assert.ok(upSection(sql).trim().length > 0);
    }
  });

  test('the snapshot key must be exactly 32 random bytes in canonical base64', () => {
    assert.ok(parseSnapshotKey(SNAPSHOT_KEY));
    for (const bad of [undefined, '', 'abc', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), `${SNAPSHOT_KEY} `]) {
      assert.equal(parseSnapshotKey(bad), undefined);
    }
  });

  test('the snapshot path must be absolute, outside the repository and in an existing folder', () => {
    assert.equal(checkSnapshotPath('rel.bin'), 'SNAPSHOT_PATH');
    assert.equal(checkSnapshotPath(join(process.cwd(), 'x.bin')), 'SNAPSHOT_IN_REPOSITORY');
    assert.equal(checkSnapshotPath(join(process.cwd(), '..', 'x-outside.bin'), { mustExist: true }), 'SNAPSHOT_MISSING');
  });

  test('the snapshot is authenticated encryption: no plaintext, a wrong key or any flipped byte fails, round trip keeps bytea exact', () => {
    const key = parseSnapshotKey(SNAPSHOT_KEY);
    const identity = {
      user: { user_id: 'u1', password_hash: '$argon2id$SECRET_MARKER_HASH' },
      factor: { ciphertext: Buffer.from('SECRET_MARKER_CIPHER'), iv: Buffer.alloc(12, 3), tag: Buffer.alloc(16, 4) },
    };
    const blob = encryptSnapshot(identity, key);
    assert.ok(!blob.includes('SECRET_MARKER'));
    assert.ok(!blob.includes('argon2id'));
    const back = decryptSnapshot(blob, key);
    assert.equal(back.user.password_hash, identity.user.password_hash);
    assert.ok(Buffer.isBuffer(back.factor.ciphertext));
    assert.ok(back.factor.ciphertext.equals(identity.factor.ciphertext));
    assert.throws(() => decryptSnapshot(blob, Buffer.alloc(32, 9)));
    for (const index of [0, 30, blob.length - 1]) {
      const bad = Buffer.from(blob);
      bad[index] ^= 1;
      assert.throws(() => decryptSnapshot(bad, key));
    }
    assert.throws(() => decryptSnapshot(Buffer.from('nope'), key), /not a snapshot/);
  });

  test('the snapshot file is created exclusively with mode 0600 and never overwritten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upgrade-snapshot-'));
    try {
      const key = parseSnapshotKey(SNAPSHOT_KEY);
      const file = join(dir, 's.bin');
      writeSnapshotFile(file, { user: { password_hash: '$argon2id$SECRET_MARKER_HASH' } }, key);
      assert.ok(existsSync(file));
      if (process.platform !== 'win32') {
        assert.equal(statSync(file).mode & 0o777, 0o600);
      }
      assert.throws(() => writeSnapshotFile(file, { user: {} }, key), /EEXIST/);
      assert.ok(!readFileSync(file).includes('SECRET_MARKER_HASH'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
