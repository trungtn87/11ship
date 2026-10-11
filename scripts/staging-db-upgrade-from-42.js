'use strict';

// `npm run staging:db-upgrade-from-42 [-- --apply | --restore-snapshot]` (issue #49 follow-up).
//
// Moves a DISPOSABLE staging database whose migration history comes from PR #42 (it holds 1791849600000 and its own
// 1791936000000_add-users-account-origin) onto the history and schema of the current main, keeping ONE thing: the SYSTEM
// administrator (users row, SYSTEM membership, ACTIVE TOTP factor, limiter check row), so the same phone, password and
// Authenticator keep working. Everything else the database holds is test data and is dropped; old sessions are not carried over.
//
//   - dry-run by default: it connects, checks everything and changes nothing. --apply is the only way to change anything.
//   - the SAME target gates as db:migrate:remote (shared code): staging only, Supabase session pooler on 5432, runtime and
//     migration URLs name the same host/port/database/project with different roles, strict TLS, MIGRATION_CONFIRM_TARGET typed.
//   - --apply additionally needs STAGING_UPGRADE_CONFIRM (a typed phrase that says the service is suspended and the rebuild is
//     understood), STAGING_UPGRADE_SNAPSHOT_FILE (a NEW file outside the repository) and STAGING_UPGRADE_SNAPSHOT_KEY.
//   - the current keyring (CRYPTO_KEYRING + CRYPTO_ACTIVE_KEY_ID, the values the service uses) is REQUIRED even for the dry-run:
//     the tool proves that the stored TOTP factor decrypts with it, before and after. Keys are never changed.
//   - the whole rebuild is ONE transaction: drop every object of schema app (except the history table), empty the history table,
//     execute every migration file of this checkout in order and record each in the history, restore the SYSTEM rows, restore the
//     table grants, verify, write one audit row, COMMIT. A failure BEFORE COMMIT rolls the whole thing back (the database is as it
//     was). A failure DURING COMMIT (lost connection or lost acknowledgement) leaves the outcome UNKNOWN: the tool says so (code
//     COMMIT_OUTCOME_UNKNOWN, exit 2), never retries a write, and --verify (read-only) tells which state the database is in. The history is never edited to hide a difference: it is rebuilt by really executing every migration.
//   - the SYSTEM rows are first written to an encrypted snapshot (AES-256-GCM, file mode 0600, created exclusively). The snapshot
//     is the recovery path (--restore-snapshot) if the database is ever found migrated but without its SYSTEM administrator.
//   - prints only counts and fixed codes: never a phone number, id, hash, ciphertext, key, URL or the snapshot path.
// Needs the compiled application (`npm run build`).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { checkRemoteTargets, listMigrationFiles, MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } = require('./db-migrate-remote.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'migrations');
const PROGRAM = 'staging:db-upgrade-from-42';
const MIN_SERVER_VERSION_NUM = 170000;
const APP_SCHEMA = 'app';
// node-pg-migrate's own advisory lock id: taking the same lock keeps the runner and this tool mutually exclusive.
const MIGRATE_LOCK_ID = '7241865325823964';
const CONFIRM_PHRASE = 'rebuild-keep-system-service-suspended';
const SNAPSHOT_MAGIC = Buffer.from('SHIP11-STAGING-SNAPSHOT-V1\n', 'utf8');

/** The history of a database migrated by PR #42, in application order. */
const EXPECTED_PRE_HISTORY = Object.freeze([
  '1791244800000_create-app-schema',
  '1791331200000_create-idempotency-records',
  '1791417600000_create-audit-outbox',
  '1791504000000_create-auth-core',
  '1791590400000_create-shop-onboarding',
  '1791676800000_create-driver-onboarding',
  '1791763200000_create-shop-business-hours',
  '1791849600000_add-users-account-origin',
  '1791936000000_add-users-account-origin',
  '1792022400000_create-admin-auth',
]);
const D2_ONLY_NAME = '1791849600000_add-users-account-origin';

/** Every table of schema app in that state (the history table is added by the caller when it lives in app). */
const EXPECTED_PRE_TABLES = Object.freeze([
  'admin_auth_challenges', 'admin_auth_limit_config', 'admin_auth_limits', 'admin_memberships', 'admin_sessions',
  'admin_totp_factors', 'audit_logs', 'drivers', 'idempotency_records', 'outbox_events', 'phone_verifications',
  'service_areas', 'sessions', 'shop_business_hours', 'shop_members', 'shops', 'user_roles', 'users', 'verification_proofs',
]);
const EXPECTED_PRE_FUNCTIONS = Object.freeze(['audit_logs_reject_mutation']);

/** Fixed vocabulary of refusals: a code and a sentence, never data. */
const PROBLEMS = {
  HISTORY_NOT_42: 'the migration history is not exactly the 10 migrations of the PR #42 history',
  HISTORY_UNKNOWN: 'the migration history is neither the PR #42 history nor this checkout\'s completed history',
  CHECKOUT_MISMATCH: 'this checkout does not contain the migrations the database needs (use the reviewed commit of PR #51)',
  UNEXPECTED_OBJECTS: 'schema app holds objects that the PR #42 history does not create',
  MISSING_OBJECTS: 'schema app lacks objects that the PR #42 history creates',
  ORIGIN_SHAPE: 'the account origin constraints do not have the PR #42 shape',
  SYSTEM_USER: 'there is not exactly one ADMIN_PROVISIONED user, or it is not ACTIVE with an argon2id hash',
  SYSTEM_MEMBERSHIP: 'there is not exactly one administration membership, ACTIVE, role SYSTEM, belonging to that user',
  SYSTEM_FACTOR: 'there is not exactly one TOTP factor, ACTIVE, belonging to that user',
  LIMIT_CONFIG: 'the limiter configuration has more than one row',
  SYSTEM_LINKED: 'the SYSTEM user also owns application data (roles, shop membership or driver profile) that the rebuild would drop',
  KEYRING_KEY_MISSING: 'the current keyring has no key with the id the TOTP factor was sealed with',
  KEYRING_CANNOT_DECRYPT: 'the TOTP factor does not decrypt with the current keyring',
  SERVER_VERSION: 'PostgreSQL 17 or newer is required',
  SCHEMA_MISSING: 'schema app does not exist',
  EXTERNAL_DEPENDENCY: 'an object outside schema app (a view or a foreign key of another schema) depends on a table of schema app; the rebuild never drops objects outside app',
  COMMIT_OUTCOME_UNKNOWN: 'the connection failed while COMMIT was in flight: it is NOT known whether the change was committed',
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;
function historyParts(historyTable) {
  const parts = historyTable.split('.');
  if (parts.length !== 2 || !parts.every((part) => IDENT.test(part))) {
    throw new Error('invalid history table');
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Read-only inspection

async function readHistory(client, historyTable) {
  historyParts(historyTable);
  const present = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [historyTable]);
  if (present.rows[0].present !== true) {
    return [];
  }
  const rows = await client.query(`SELECT name FROM ${historyTable} ORDER BY id`);
  return rows.rows.map((row) => row.name);
}

/** Objects of schema app that matter for the rebuild. Unowned sequences, views and types are reported, never ignored. */
async function readInventory(client, historyTable) {
  const [, historyName] = historyParts(historyTable);
  const tables = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
    [APP_SCHEMA],
  );
  const other = await client.query(
    `SELECT c.relname || ':' || c.relkind::text AS label FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('v', 'm', 'f', 'S')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
      UNION ALL
      SELECT t.typname || ':type' FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1 AND t.typtype IN ('e', 'd', 'r', 'm') ORDER BY 1`,
    [APP_SCHEMA],
  );
  const functions = await client.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 ORDER BY p.proname`,
    [APP_SCHEMA],
  );
  return {
    tables: tables.rows.map((row) => row.relname).filter((name) => !(historyTable.startsWith(`${APP_SCHEMA}.`) && name === historyName)),
    other: other.rows.map((row) => row.label),
    functions: functions.rows.map((row) => row.proname),
  };
}

/**
 * Objects OUTSIDE schema app that depend on a table of schema app: views/rules and foreign keys of other schemas. The rebuild drops
 * tables with RESTRICT, so PostgreSQL refuses any dependency (this check only gives an early, readable answer and also covers the dry-run).
 */
async function countExternalDependents(client) {
  const result = await client.query(
    `SELECT
       (SELECT count(DISTINCT r.ev_class)
          FROM pg_depend d JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
          JOIN pg_class t ON d.refclassid = 'pg_class'::regclass AND d.refobjid = t.oid
          JOIN pg_class v ON v.oid = r.ev_class
         WHERE t.relnamespace = $1::regnamespace AND t.relkind IN ('r', 'p') AND v.relnamespace <> $1::regnamespace)::int
     + (SELECT count(*)
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid JOIN pg_class o ON o.oid = c.conrelid
         WHERE c.contype = 'f' AND t.relnamespace = $1::regnamespace AND o.relnamespace <> $1::regnamespace)::int AS n`,
    [APP_SCHEMA],
  );
  return result.rows[0].n;
}

/** Runs a DROP; a dependency refusal (2BP01, RESTRICT) becomes the fixed code EXTERNAL_DEPENDENCY. */
async function dropRestrict(client, sql) {
  try {
    await client.query(sql);
  } catch (error) {
    if (error && error.code === '2BP01') {
      throw new RebuildError('EXTERNAL_DEPENDENCY');
    }
    throw error;
  }
}

const USER_COLUMNS =
  'user_id::text AS user_id, phone_normalized, password_hash, phone_verified_at::text AS phone_verified_at, account_origin, ' +
  'status, version::text AS version, created_at::text AS created_at, updated_at::text AS updated_at';
const MEMBERSHIP_COLUMNS =
  'user_id::text AS user_id, admin_role, status, version::text AS version, created_at::text AS created_at, updated_at::text AS updated_at';
const FACTOR_COLUMNS =
  'user_id::text AS user_id, factor_id::text AS factor_id, state, version::text AS version, key_id, ciphertext, iv, tag, ' +
  'last_accepted_step::text AS last_accepted_step, pending_challenge_id::text AS pending_challenge_id, ' +
  'created_at::text AS created_at, activated_at::text AS activated_at';
const LIMIT_COLUMNS = 'singleton_id::text AS singleton_id, limiter_key_id, key_check, created_at::text AS created_at';

/** Reads the SYSTEM identity exactly (timestamps and numbers as text, bytea as Buffer). Returns { problems, identity }. */
async function readSystemIdentity(client) {
  const problems = [];
  const users = await client.query(`SELECT ${USER_COLUMNS} FROM app.users WHERE account_origin = 'ADMIN_PROVISIONED'`);
  const user = users.rows.length === 1 ? users.rows[0] : undefined;
  if (user === undefined || user.status !== 'ACTIVE' || !/^\$argon2id\$/.test(user.password_hash) || user.phone_verified_at !== null) {
    problems.push('SYSTEM_USER');
  }
  const memberships = await client.query(`SELECT ${MEMBERSHIP_COLUMNS} FROM app.admin_memberships`);
  const membership = memberships.rows.length === 1 ? memberships.rows[0] : undefined;
  if (membership === undefined || membership.admin_role !== 'SYSTEM' || membership.status !== 'ACTIVE' || membership.user_id !== user?.user_id) {
    problems.push('SYSTEM_MEMBERSHIP');
  }
  const factors = await client.query(`SELECT ${FACTOR_COLUMNS} FROM app.admin_totp_factors`);
  const factor = factors.rows.length === 1 ? factors.rows[0] : undefined;
  if (
    factor === undefined || factor.user_id !== user?.user_id || factor.state !== 'ACTIVE' ||
    factor.pending_challenge_id !== null || factor.last_accepted_step === null || factor.activated_at === null
  ) {
    problems.push('SYSTEM_FACTOR');
  }
  const limits = await client.query(`SELECT ${LIMIT_COLUMNS} FROM app.admin_auth_limit_config`);
  if (limits.rows.length > 1) {
    problems.push('LIMIT_CONFIG');
  }
  if (user !== undefined) {
    const linked = await client.query(
      `SELECT (SELECT count(*) FROM app.user_roles WHERE user_id = $1::uuid)::int
            + (SELECT count(*) FROM app.shop_members WHERE user_id = $1::uuid)::int
            + (SELECT count(*) FROM app.drivers WHERE user_id = $1::uuid)::int AS n`,
      [user.user_id],
    );
    if (linked.rows[0].n > 0) {
      problems.push('SYSTEM_LINKED');
    }
  }
  return { problems, identity: problems.length > 0 ? undefined : { user, membership, factor, limitConfig: limits.rows[0] ?? null } };
}

/** Proves the factor decrypts with the keyring (the secret never leaves this function). */
function checkFactorDecrypts(keyring, identity) {
  const { factor } = identity;
  const version = keyring.version(factor.key_id);
  if (version === undefined) {
    return 'KEYRING_KEY_MISSING';
  }
  try {
    const secret = version.openAdminTotpSecret(
      { userId: factor.user_id, factorId: factor.factor_id, factorVersion: Number(factor.version) },
      { iv: factor.iv, tag: factor.tag, ciphertext: factor.ciphertext },
    );
    secret.fill(0);
    return undefined;
  } catch {
    return 'KEYRING_CANNOT_DECRYPT';
  }
}

const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Classifies the database without changing it. state: 'PRE' (the PR #42 history, ready for the rebuild), 'DONE' (the history of
 * this checkout is already complete) or 'STOP'. `problems` are codes of PROBLEMS.
 */
async function inspect(client, { files, historyTable = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`, keyring }) {
  const problems = [];
  const info = await client.query("SELECT current_setting('server_version_num')::int AS version_num, to_regnamespace($1) IS NOT NULL AS schema_present", [APP_SCHEMA]);
  if (info.rows[0].version_num < MIN_SERVER_VERSION_NUM) {
    problems.push('SERVER_VERSION');
  }
  if (info.rows[0].schema_present !== true) {
    return { state: 'STOP', problems: [...problems, 'SCHEMA_MISSING'] };
  }
  const history = await readHistory(client, historyTable);
  if (sameList(history, files)) {
    return { state: 'DONE', problems, history };
  }
  const needed = EXPECTED_PRE_HISTORY.filter((name) => name !== D2_ONLY_NAME);
  if (!needed.every((name) => files.includes(name)) || files.includes(D2_ONLY_NAME)) {
    problems.push('CHECKOUT_MISMATCH');
  }
  if (!sameList(history, EXPECTED_PRE_HISTORY)) {
    problems.push(history.length === 0 || !history.some((name) => name === D2_ONLY_NAME) ? 'HISTORY_UNKNOWN' : 'HISTORY_NOT_42');
    return { state: 'STOP', problems, history };
  }

  const inventory = await readInventory(client, historyTable);
  const expectedTables = [...EXPECTED_PRE_TABLES].sort();
  const missing = expectedTables.filter((name) => !inventory.tables.includes(name));
  const unexpected = [
    ...inventory.tables.filter((name) => !expectedTables.includes(name)),
    ...inventory.other,
    ...inventory.functions.filter((name) => !EXPECTED_PRE_FUNCTIONS.includes(name)),
  ];
  if (missing.length > 0 || EXPECTED_PRE_FUNCTIONS.some((name) => !inventory.functions.includes(name))) {
    problems.push('MISSING_OBJECTS');
  }
  if (unexpected.length > 0) {
    problems.push('UNEXPECTED_OBJECTS');
  }
  if (problems.includes('MISSING_OBJECTS')) {
    return { state: 'STOP', problems, history, inventory };
  }

  if ((await countExternalDependents(client)) > 0) {
    problems.push('EXTERNAL_DEPENDENCY');
  }

  const shape = await client.query(
    `SELECT (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'app.users'::regclass AND conname = 'users_account_origin_ck') AS origin_ck,
            (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'app.users'::regclass AND conname = 'users_origin_verified_ck') AS verified_ck`,
  );
  const { origin_ck: originCk, verified_ck: verifiedCk } = shape.rows[0];
  if (!['PHONE_VERIFIED', 'ADMIN_PROVISIONED', 'STAGING_FIXTURE'].every((value) => String(originCk).includes(`'${value}'`)) || verifiedCk === null) {
    problems.push('ORIGIN_SHAPE');
  }

  const found = await readSystemIdentity(client);
  problems.push(...found.problems);
  if (found.identity !== undefined && keyring !== undefined) {
    const decrypt = checkFactorDecrypts(keyring, found.identity);
    if (decrypt !== undefined) {
      problems.push(decrypt);
    }
  }

  const counts = {};
  for (const table of inventory.tables) {
    const count = await client.query(`SELECT count(*)::int AS n FROM app.${quoteIdent(table)}`);
    counts[table] = count.rows[0].n;
  }
  return { state: problems.length === 0 ? 'PRE' : 'STOP', problems, history, inventory, counts, identity: found.identity };
}

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot: AES-256-GCM, exclusive 0600 file, outside the repository

function parseSnapshotKey(raw) {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    return undefined;
  }
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 && key.toString('base64') === raw ? key : undefined;
}

/** A path the snapshot may be created at: absolute, its folder exists, not inside the repository, not existing yet. */
function checkSnapshotPath(file, { mustExist = false } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    return 'SNAPSHOT_PATH';
  }
  const resolved = path.resolve(file);
  const relative = path.relative(REPO_ROOT, resolved);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return 'SNAPSHOT_IN_REPOSITORY';
  }
  if (fs.existsSync(resolved) !== mustExist) {
    return mustExist ? 'SNAPSHOT_MISSING' : 'SNAPSHOT_EXISTS';
  }
  if (!mustExist && !fs.existsSync(path.dirname(resolved))) {
    return 'SNAPSHOT_PATH';
  }
  return undefined;
}

const toWire = (identity) =>
  JSON.stringify(identity, (_key, value) =>
    Buffer.isBuffer(value) ? { $b64: value.toString('base64') } : value && value.type === 'Buffer' && Array.isArray(value.data) ? { $b64: Buffer.from(value.data).toString('base64') } : value,
  );
const fromWire = (text) => JSON.parse(text, (_key, value) => (value && typeof value === 'object' && typeof value.$b64 === 'string' ? Buffer.from(value.$b64, 'base64') : value));

function encryptSnapshot(identity, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(SNAPSHOT_MAGIC);
  const body = Buffer.concat([cipher.update(toWire(identity), 'utf8'), cipher.final()]);
  return Buffer.concat([SNAPSHOT_MAGIC, iv, cipher.getAuthTag(), body]);
}

function decryptSnapshot(buffer, key) {
  const head = SNAPSHOT_MAGIC.length;
  if (buffer.length < head + 28 || !buffer.subarray(0, head).equals(SNAPSHOT_MAGIC)) {
    throw new Error('not a snapshot');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(head, head + 12));
  decipher.setAAD(SNAPSHOT_MAGIC);
  decipher.setAuthTag(buffer.subarray(head + 12, head + 28));
  return fromWire(Buffer.concat([decipher.update(buffer.subarray(head + 28)), decipher.final()]).toString('utf8'));
}

/** Created exclusively (wx) with mode 0600, flushed, then read back and compared. */
function writeSnapshotFile(file, identity, key) {
  const data = encryptSnapshot(identity, key);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const back = decryptSnapshot(fs.readFileSync(file), key);
  if (toWire(back) !== toWire(identity)) {
    throw new Error('snapshot verification failed');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The rebuild (ONE transaction)

function upSection(sql) {
  const lines = sql.split('\n');
  const up = lines.findIndex((line) => /^\s*--[\s-]*up\s+migration/i.test(line));
  const down = lines.findIndex((line) => /^\s*--[\s-]*down\s+migration/i.test(line));
  if (up === -1) {
    throw new Error('migration without an Up section');
  }
  return lines.slice(up + 1, down === -1 ? undefined : down).join('\n');
}

async function insertIdentity(client, identity) {
  const { user, membership, factor, limitConfig } = identity;
  await client.query(
    `INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4::timestamptz, $5, $6, $7::bigint, $8::timestamptz, $9::timestamptz)`,
    [user.user_id, user.phone_normalized, user.password_hash, user.phone_verified_at, user.account_origin, user.status, user.version, user.created_at, user.updated_at],
  );
  await client.query(
    `INSERT INTO app.admin_memberships (user_id, admin_role, status, version, created_at, updated_at)
     VALUES ($1::uuid, $2, $3, $4::bigint, $5::timestamptz, $6::timestamptz)`,
    [membership.user_id, membership.admin_role, membership.status, membership.version, membership.created_at, membership.updated_at],
  );
  await client.query(
    `INSERT INTO app.admin_totp_factors (user_id, factor_id, state, version, key_id, ciphertext, iv, tag, last_accepted_step, pending_challenge_id, created_at, activated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4::bigint, $5, $6, $7, $8, $9::bigint, $10::uuid, $11::timestamptz, $12::timestamptz)`,
    [factor.user_id, factor.factor_id, factor.state, factor.version, factor.key_id, factor.ciphertext, factor.iv, factor.tag, factor.last_accepted_step, factor.pending_challenge_id, factor.created_at, factor.activated_at],
  );
  if (limitConfig !== null && limitConfig !== undefined) {
    await client.query(
      `INSERT INTO app.admin_auth_limit_config (singleton_id, limiter_key_id, key_check, created_at)
       VALUES ($1::smallint, $2, $3, $4::timestamptz)`,
      [limitConfig.singleton_id, limitConfig.limiter_key_id, limitConfig.key_check, limitConfig.created_at],
    );
  }
}

async function captureGrants(client, historyTable) {
  const [, historyName] = historyParts(historyTable);
  const rows = await client.query(
    `SELECT c.relname AS table_name,
            CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
            a.privilege_type, a.is_grantable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.grantee <> c.relowner AND c.relname <> $2
      ORDER BY 1, 2, 3`,
    [APP_SCHEMA, historyName],
  );
  return rows.rows;
}

async function restoreGrants(client, grants) {
  const present = await client.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`, [APP_SCHEMA]);
  const tables = new Set(present.rows.map((row) => row.relname));
  const restored = new Set();
  for (const grant of grants) {
    if (!tables.has(grant.table_name) || !/^(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)$/.test(grant.privilege_type)) {
      continue;
    }
    const role = grant.grantee === 'PUBLIC' ? 'PUBLIC' : quoteIdent(grant.grantee);
    await client.query(`GRANT ${grant.privilege_type} ON app.${quoteIdent(grant.table_name)} TO ${role}${grant.is_grantable ? ' WITH GRANT OPTION' : ''}`);
    restored.add(grant.table_name);
  }
  return { restoredTables: restored.size, tablesWithoutGrants: [...tables].filter((name) => !restored.has(name) && name !== MIGRATIONS_TABLE).length };
}

const identityDigest = (identity) => crypto.createHash('sha256').update(toWire(identity)).digest('hex');

/**
 * The atomic rebuild. Throws on ANY problem after ROLLBACK; the database is then exactly as before. Returns safe counts.
 * `identity` is what the snapshot holds: the identity read under the locks must be identical, or nothing is changed.
 */
async function rebuild(client, { identity, files, dir = MIGRATIONS_DIR, historyTable = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`, keyring, audit, requestId = crypto.randomUUID() }) {
  const [historySchema, historyName] = historyParts(historyTable);
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [MIGRATE_LOCK_ID]);
    if (lock.rows[0].locked !== true) {
      throw new RebuildError('MIGRATION_LOCK_BUSY');
    }

    const before = await readInventory(client, historyTable);
    if (before.other.length > 0 || before.functions.some((name) => !EXPECTED_PRE_FUNCTIONS.includes(name)) || before.tables.some((name) => !EXPECTED_PRE_TABLES.includes(name))) {
      throw new RebuildError('UNEXPECTED_OBJECTS');
    }
    // Nobody else can touch the tables from here on; a long-running transaction makes this fail after 10 s instead of waiting.
    if (before.tables.length > 0) {
      await client.query(`LOCK TABLE ${before.tables.map((name) => `app.${quoteIdent(name)}`).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    }
    if (!sameList(await readHistory(client, historyTable), EXPECTED_PRE_HISTORY)) {
      throw new RebuildError('HISTORY_NOT_42');
    }
    const current = await readSystemIdentity(client);
    if (current.identity === undefined || identityDigest(current.identity) !== identityDigest(identity)) {
      throw new RebuildError('IDENTITY_CHANGED');
    }
    const counts = {};
    for (const table of before.tables) {
      counts[table] = (await client.query(`SELECT count(*)::int AS n FROM app.${quoteIdent(table)}`)).rows[0].n;
    }
    const grants = await captureGrants(client, historyTable);

    // Drop everything of schema app except the history table (no CASCADE).
    if ((await countExternalDependents(client)) > 0) {
      throw new RebuildError('EXTERNAL_DEPENDENCY');
    }
    // ONE statement, RESTRICT: PostgreSQL resolves the dependencies between the tables of the list and REFUSES any dependency from
    // outside the list (a view, a foreign key or a function body in another schema). Nothing outside schema app is ever dropped.
    if (before.tables.length > 0) {
      await dropRestrict(client, `DROP TABLE ${before.tables.map((name) => `app.${quoteIdent(name)}`).join(', ')} RESTRICT`);
    }
    for (const fn of before.functions) {
      await dropRestrict(client, `DROP FUNCTION app.${quoteIdent(fn)}() RESTRICT`);
    }
    const after = await readInventory(client, historyTable);
    if (after.tables.length + after.other.length + after.functions.length !== 0) {
      throw new RebuildError('DROP_INCOMPLETE');
    }

    // Rebuild the history by REALLY executing every migration of this checkout, in order.
    await client.query(`TRUNCATE ${quoteIdent(historySchema)}.${quoteIdent(historyName)} RESTART IDENTITY`);
    for (const name of files) {
      await client.query(upSection(fs.readFileSync(path.join(dir, `${name}.sql`), 'utf8')));
      await client.query(`INSERT INTO ${quoteIdent(historySchema)}.${quoteIdent(historyName)} (name, run_on) VALUES ($1, now())`, [name]);
    }

    await insertIdentity(client, identity);
    const granted = await restoreGrants(client, grants);

    // Verification before COMMIT.
    if (!sameList(await readHistory(client, historyTable), files)) {
      throw new RebuildError('HISTORY_MISMATCH');
    }
    const check = await readSystemIdentity(client);
    if (check.identity === undefined || identityDigest(check.identity) !== identityDigest(identity)) {
      throw new RebuildError('IDENTITY_NOT_RESTORED');
    }
    const strays = await client.query(
      `SELECT (SELECT count(*) FROM app.users)::int AS users, (SELECT count(*) FROM app.admin_memberships)::int AS memberships,
              (SELECT count(*) FROM app.admin_totp_factors)::int AS factors, (SELECT count(*) FROM app.admin_sessions)::int AS admin_sessions,
              (SELECT count(*) FROM app.sessions)::int AS sessions`,
    );
    const s = strays.rows[0];
    if (s.users !== 1 || s.memberships !== 1 || s.factors !== 1 || s.admin_sessions !== 0 || s.sessions !== 0) {
      throw new RebuildError('UNEXPECTED_ROWS');
    }
    if (keyring !== undefined) {
      const decrypt = checkFactorDecrypts(keyring, check.identity);
      if (decrypt !== undefined) {
        throw new RebuildError(decrypt);
      }
    }
    if (audit !== undefined) {
      await audit.append(
        { isActive: true, query: (text, values) => client.query(text, values) },
        {
          requestId,
          actorType: 'OPERATOR',
          actorId: 'staging-db-upgrade-cli',
          action: 'ops.staging_db_rebuild.v1',
          resourceType: 'database',
          outcome: 'SUCCESS',
          metadata: { migrations_applied: files.length, tables_dropped: before.tables.length, users_dropped: Math.max(0, (counts.users ?? 1) - 1) },
        },
      );
    }
    await commitOrUnknown(client, () => {
      open = false;
    });
    return { counts, migrations: files.length, grants: granted };
  } catch (error) {
    if (open) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  }
}

/**
 * COMMIT is the only statement whose failure does not say what happened: the server may have committed and the acknowledgement may
 * have been lost. No ROLLBACK is sent and nothing is retried; the caller gets COMMIT_OUTCOME_UNKNOWN and the read-only --verify decides.
 */
async function commitOrUnknown(client, markClosed) {
  markClosed();
  try {
    await client.query('COMMIT');
  } catch {
    throw new RebuildError('COMMIT_OUTCOME_UNKNOWN');
  }
}

class RebuildError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RebuildError';
    this.code = code;
  }
}

/** Recovery: puts the SYSTEM identity of a snapshot into a database that is fully migrated but has no administrator. */
async function restoreFromSnapshot(client, { identity, files, historyTable = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`, keyring }) {
  let open = false;
  try {
    await client.query('BEGIN');
    open = true;
    await client.query("SET LOCAL lock_timeout = '10s'");
    if (!sameList(await readHistory(client, historyTable), files)) {
      throw new RebuildError('HISTORY_MISMATCH');
    }
    await client.query('LOCK TABLE app.users, app.admin_memberships, app.admin_totp_factors IN ACCESS EXCLUSIVE MODE');
    const rows = await client.query(`SELECT (SELECT count(*) FROM app.users)::int AS users, (SELECT count(*) FROM app.admin_memberships)::int AS memberships, (SELECT count(*) FROM app.admin_totp_factors)::int AS factors`);
    const r = rows.rows[0];
    if (r.users !== 0 || r.memberships !== 0 || r.factors !== 0) {
      throw new RebuildError('TARGET_NOT_EMPTY');
    }
    // A limiter configuration that already exists must be the same one (the limiter key is not ours to change); never duplicated.
    const limits = await client.query(`SELECT ${LIMIT_COLUMNS} FROM app.admin_auth_limit_config`);
    const wanted = identity.limitConfig;
    if (limits.rows.length > 1 || (limits.rows.length === 1 && wanted !== null && wanted !== undefined &&
        (limits.rows[0].limiter_key_id !== wanted.limiter_key_id || !Buffer.from(limits.rows[0].key_check).equals(Buffer.from(wanted.key_check))))) {
      throw new RebuildError('LIMIT_CONFIG');
    }
    await insertIdentity(client, limits.rows.length === 1 ? { ...identity, limitConfig: null } : identity);
    if (keyring !== undefined) {
      const decrypt = checkFactorDecrypts(keyring, identity);
      if (decrypt !== undefined) {
        throw new RebuildError(decrypt);
      }
    }
    await commitOrUnknown(client, () => {
      open = false;
    });
  } catch (error) {
    if (open) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Read-only verification after an unknown outcome

/**
 * Tells which state the database is in, comparing the SYSTEM identity with the snapshot (a complete history alone proves nothing
 * about the identity). One REPEATABLE READ READ ONLY transaction: it cannot change anything.
 *   PRE_UNCHANGED            the PR #42 history, SYSTEM identical to the snapshot: the earlier run did not commit
 *   UPGRADED_OK              the history of this checkout, exactly one SYSTEM identical to the snapshot, factor decrypts, no sessions
 *   MIGRATED_WITHOUT_SYSTEM  the history of this checkout and no administrator at all: --restore-snapshot is the next step
 *   ABNORMAL                 anything else: stop
 */
async function verify(client, { files, historyTable = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`, keyring, snapshot }) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const history = await readHistory(client, historyTable);
    if (sameList(history, EXPECTED_PRE_HISTORY)) {
      const state = await inspect(client, { files, historyTable, keyring });
      if (state.state === 'PRE' && identityDigest(state.identity) === identityDigest(snapshot)) {
        return { state: 'PRE_UNCHANGED', problems: [] };
      }
      return { state: 'ABNORMAL', problems: state.problems.length > 0 ? state.problems : ['IDENTITY_DIFFERS'] };
    }
    if (!sameList(history, files)) {
      return { state: 'ABNORMAL', problems: ['HISTORY_UNKNOWN'] };
    }
    const rows = await client.query(
      `SELECT (SELECT count(*) FROM app.users)::int AS users, (SELECT count(*) FROM app.admin_memberships)::int AS memberships,
              (SELECT count(*) FROM app.admin_totp_factors)::int AS factors, (SELECT count(*) FROM app.admin_sessions)::int AS admin_sessions,
              (SELECT count(*) FROM app.sessions)::int AS sessions`,
    );
    const n = rows.rows[0];
    if (n.users === 0 && n.memberships === 0 && n.factors === 0) {
      return { state: 'MIGRATED_WITHOUT_SYSTEM', problems: [] };
    }
    const found = await readSystemIdentity(client);
    const problems = [];
    if (found.identity === undefined || identityDigest(found.identity) !== identityDigest(snapshot)) {
      problems.push('IDENTITY_DIFFERS');
    } else if (n.users !== 1 || n.memberships !== 1 || n.factors !== 1) {
      problems.push('UNEXPECTED_ROWS');
    } else if (keyring !== undefined && checkFactorDecrypts(keyring, found.identity) !== undefined) {
      problems.push('KEYRING_CANNOT_DECRYPT');
    }
    return problems.length === 0 ? { state: 'UPGRADED_OK', problems, sessions: n.admin_sessions + n.sessions } : { state: 'ABNORMAL', problems };
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Command

function loadDefaultDeps() {
  const dist = path.join(REPO_ROOT, 'apps', 'backend', 'dist');
  const wanted = {
    tls: path.join(dist, 'database', 'tls-config.js'),
    safeError: path.join(dist, 'common', 'safe-error.js'),
    keyring: path.join(dist, 'crypto', 'keyring.js'),
    audit: path.join(dist, 'audit', 'audit-writer.js'),
  };
  if (!Object.values(wanted).every((file) => fs.existsSync(file))) {
    return undefined;
  }
  require('reflect-metadata');
  const { Client } = require('pg');
  return {
    resolveDatabaseTls: require(wanted.tls).resolveDatabaseTls,
    safeErrorCode: require(wanted.safeError).safeErrorCode,
    parseKeyringConfig: require(wanted.keyring).parseKeyringConfig,
    createAudit: () => new (require(wanted.audit).AuditWriter)(),
    createClient: (config) => new Client(config),
    migrationsDir: MIGRATIONS_DIR,
  };
}

/** Returns the process exit code. All I/O goes through `out`/`err`/`deps`, so it can be tested. */
async function main({ argv, env, deps = loadDefaultDeps(), out = console.log, err = console.error }) {
  const fail = (message) => {
    err(`${PROGRAM}: ${message}`);
    return 1;
  };
  const known = new Set(['--apply', '--restore-snapshot', '--verify']);
  if (argv.some((arg) => !known.has(arg)) || new Set(argv).size !== argv.length || argv.length > 1) {
    return fail('options: none (dry-run: checks only), --apply (rebuild), --restore-snapshot (recovery) or --verify (read-only check after an unknown COMMIT outcome). One option at most. No other argument exists.');
  }
  const apply = argv.includes('--apply');
  const restore = argv.includes('--restore-snapshot');
  const verifyOnly = argv.includes('--verify');

  if (env.APP_ENV !== 'staging') {
    return fail('APP_ENV must be staging. This tool never runs against production.');
  }
  if (deps === undefined || deps === null) {
    return fail('the compiled application is missing. Run "npm run build" first.');
  }
  const targets = checkRemoteTargets(env);
  if (targets.problem !== undefined) {
    return fail(targets.problem);
  }
  const { target, rawUrl } = targets;
  const tls = deps.resolveDatabaseTls({ env, required: true, databaseUrl: rawUrl });
  if (!tls.ok || tls.tls === undefined) {
    const names = (tls.ok ? ['DB_SSL_CA', 'DB_SSL_CA_FILE'] : tls.invalid).map((name) => (name === 'DATABASE_URL' ? 'MIGRATION_DATABASE_URL' : name));
    return fail(`invalid or missing configuration. Check environment variable(s): ${names.join(', ')}`);
  }
  const expectedTarget = `${target.host}:${target.port}/${target.database}/${target.projectRef}`;
  if (env.MIGRATION_CONFIRM_TARGET !== expectedTarget) {
    return fail(`confirm the target by setting MIGRATION_CONFIRM_TARGET=${expectedTarget}`);
  }

  // The keyring the service uses: needed to PROVE the stored factor still decrypts. Values are never printed.
  if (env.CRYPTO_KEYRING === undefined || env.CRYPTO_ACTIVE_KEY_ID === undefined) {
    return fail('invalid or missing configuration. Check environment variable(s): CRYPTO_KEYRING, CRYPTO_ACTIVE_KEY_ID');
  }
  const parsedKeyring = deps.parseKeyringConfig(env.CRYPTO_KEYRING, env.CRYPTO_ACTIVE_KEY_ID);
  if (!parsedKeyring.ok) {
    return fail(`invalid or missing configuration. Check environment variable(s): ${parsedKeyring.invalid.join(', ')}`);
  }
  const keyring = parsedKeyring.keyring;

  let snapshotKey;
  if (apply || restore || verifyOnly) {
    snapshotKey = parseSnapshotKey(env.STAGING_UPGRADE_SNAPSHOT_KEY);
    if (snapshotKey === undefined) {
      return fail('invalid or missing configuration. Check environment variable(s): STAGING_UPGRADE_SNAPSHOT_KEY (base64 of exactly 32 random bytes)');
    }
    const pathProblem = checkSnapshotPath(env.STAGING_UPGRADE_SNAPSHOT_FILE, { mustExist: restore || verifyOnly });
    if (pathProblem !== undefined) {
      return fail(`STAGING_UPGRADE_SNAPSHOT_FILE refused (${pathProblem}): it must be an absolute path outside the repository${restore || verifyOnly ? ' of an existing snapshot' : ' of a file that does not exist yet, in an existing folder'}.`);
    }
  }
  if (apply && env.STAGING_UPGRADE_CONFIRM !== CONFIRM_PHRASE) {
    return fail(`--apply rebuilds the whole schema and keeps only the SYSTEM administrator. Stop the Render service, then set STAGING_UPGRADE_CONFIRM=${CONFIRM_PHRASE}`);
  }

  const files = listMigrationFiles(deps.migrationsDir);
  // The history table is app.pgmigrations on the remote; a test may point at its own (injected) table.
  const historyTable = deps.historyTable ?? `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const client = deps.createClient({ connectionString: rawUrl, ssl: { ca: tls.tls.ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  let stage = 'connect';
  try {
    await client.connect();
    stage = 'identity';
    const who = await client.query('SELECT current_user AS role, current_database() AS db');
    out(`${PROGRAM}: connected over verified TLS to ${expectedTarget} as role ${who.rows[0].role} (${restore ? 'restore' : verifyOnly ? 'verify, read-only' : apply ? 'APPLY' : 'dry-run'})`);

    stage = 'inspect';
    if (verifyOnly) {
      const snapshot = decryptSnapshot(fs.readFileSync(env.STAGING_UPGRADE_SNAPSHOT_FILE), snapshotKey);
      stage = 'verify';
      const result = await verify(client, { files, historyTable, keyring, snapshot });
      if (result.state === 'PRE_UNCHANGED') {
        out(`${PROGRAM}: PRE_UNCHANGED: the database is still on the PR #42 history and the SYSTEM is identical to the snapshot. The earlier run did NOT commit. Keep that snapshot and its key; a new --apply needs a NEW snapshot file.`);
      } else if (result.state === 'UPGRADED_OK') {
        out(`${PROGRAM}: UPGRADED_OK: complete history of this checkout (${files.length} migrations), exactly one SYSTEM identical to the snapshot, the TOTP factor decrypts with the keyring. The earlier run DID commit. Do not run --apply again.`);
      } else if (result.state === 'MIGRATED_WITHOUT_SYSTEM') {
        out(`${PROGRAM}: MIGRATED_WITHOUT_SYSTEM: complete history and no administrator. Run --restore-snapshot with this snapshot and key.`);
      } else {
        err(`${PROGRAM}: ABNORMAL, STOP; do not run any write. Report to ChatGPT/Owner; the provider backup is the way back.`);
        for (const code of result.problems) {
          err(`${PROGRAM}:   ${code}: ${PROBLEMS[code] ?? 'the identity or the history is not what the snapshot and this checkout expect'}`);
        }
        return 1;
      }
      return 0;
    }
    if (restore) {
      const snapshot = decryptSnapshot(fs.readFileSync(env.STAGING_UPGRADE_SNAPSHOT_FILE), snapshotKey);
      stage = 'restore';
      await restoreFromSnapshot(client, { identity: snapshot, files, historyTable, keyring });
      out(`${PROGRAM}: SYSTEM administrator restored from the snapshot (1 user, 1 membership, 1 factor); the TOTP factor decrypts with the current keyring.`);
      return 0;
    }

    const state = await inspect(client, { files, historyTable, keyring });
    if (state.state === 'DONE') {
      out(`${PROGRAM}: the database already has the complete history of this checkout (${files.length} migrations); nothing to do.`);
      return 0;
    }
    if (state.state === 'STOP') {
      err(`${PROGRAM}: STOP, nothing was changed:`);
      for (const code of state.problems) {
        err(`${PROGRAM}:   ${code}: ${PROBLEMS[code] ?? 'refused'}`);
      }
      return 1;
    }
    out(`${PROGRAM}: the database is on the PR #42 history (${state.history.length} migrations) and ready for the rebuild.`);
    out(`${PROGRAM}: SYSTEM identity verified: 1 user, 1 SYSTEM membership, 1 ACTIVE TOTP factor that decrypts with the current keyring.`);
    out(`${PROGRAM}: would DROP ${state.inventory.tables.length} tables holding ${Object.values(state.counts).reduce((a, b) => a + b, 0)} rows in total (the SYSTEM rows are kept), apply ${files.length} migrations and restore the grants of the existing tables.`);
    if (!apply) {
      out(`${PROGRAM}: dry-run; nothing was changed. See ops/runbooks/staging-db-upgrade-from-42.md before running with "-- --apply".`);
      return 0;
    }

    stage = 'snapshot';
    // A consistent read of the identity, then the encrypted snapshot, BEFORE anything is changed.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let identity;
    try {
      const read = await readSystemIdentity(client);
      identity = read.identity;
    } finally {
      await client.query('ROLLBACK');
    }
    if (identity === undefined) {
      return fail('the SYSTEM identity changed while reading it; nothing was changed. Run again.');
    }
    writeSnapshotFile(env.STAGING_UPGRADE_SNAPSHOT_FILE, identity, snapshotKey);
    out(`${PROGRAM}: encrypted snapshot of the SYSTEM identity written (mode 0600) and read back successfully.`);

    stage = 'rebuild';
    const result = await rebuild(client, { identity, files, dir: deps.migrationsDir, historyTable, keyring, audit: deps.createAudit === undefined ? undefined : deps.createAudit() });
    out(`${PROGRAM}: committed. ${result.migrations} migrations applied, history rebuilt; SYSTEM identity restored and verified; grants restored on ${result.grants.restoredTables} table(s).`);
    if (result.grants.tablesWithoutGrants > 0) {
      out(`${PROGRAM}: ${result.grants.tablesWithoutGrants} table(s) have no runtime grant yet: run the runbook section 3 grants for them before starting the service.`);
    }
    out(`${PROGRAM}: old sessions were not carried over (all revoked). Next: npm run db:migrate:remote must report nothing pending.`);
    return 0;
  } catch (error) {
    const code = error instanceof RebuildError ? error.code : deps.safeErrorCode(error);
    if (code === 'COMMIT_OUTCOME_UNKNOWN') {
      err(`${PROGRAM}: COMMIT_OUTCOME_UNKNOWN: the connection failed while COMMIT was in flight; it is NOT known whether the ${stage} was committed.`);
      err(`${PROGRAM}: do NOT run any write command again, do NOT delete the snapshot file or its key. Run the read-only check: npm run staging:db-upgrade-from-42 -- --verify`);
      return 2;
    }
    if (stage === 'rebuild' || stage === 'restore') {
      return fail(`${stage} failed (code ${code}). The transaction never reached COMMIT, so nothing was committed (PostgreSQL discards an unfinished transaction). Confirm with the dry-run.`);
    }
    return fail(`${stage} failed (code ${code}). Nothing was changed.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

module.exports = {
  main, inspect, verify, rebuild, restoreFromSnapshot, readSystemIdentity, insertIdentity, checkFactorDecrypts, encryptSnapshot, decryptSnapshot,
  writeSnapshotFile, checkSnapshotPath, parseSnapshotKey, upSection, RebuildError,
  EXPECTED_PRE_HISTORY, EXPECTED_PRE_TABLES, EXPECTED_PRE_FUNCTIONS, PROBLEMS, CONFIRM_PHRASE,
};

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
