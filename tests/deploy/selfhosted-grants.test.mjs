// M00-VPS-01 package A: the runtime grants of the self-hosted staging database cannot drift. Static checks only (no
// database): ops/selfhosted/02-runtime-grants.sql, the matrix of ops/runbooks/render-supabase-staging.md section 3 and the
// tables the migrations create must describe exactly the same set. The same files are then exercised against a real
// PostgreSQL 17 by tests/selfhosted (CI job "Self-hosted PostgreSQL 17 over TLS").

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative) => readFileSync(root(relative), 'utf8');

const KINDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

function runbookMatrix() {
  const lines = read('ops/runbooks/render-supabase-staging.md').split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Table | Privileges'));
  assert.ok(start >= 0, 'runbook grants table not found');
  const matrix = new Map();
  for (const line of lines.slice(start + 2)) {
    const match = /^\| ([a-z_]+) \| ([^|]+) \|$/.exec(line);
    if (match === null) break;
    matrix.set(match[1], (match[2].split('(')[0].match(/SELECT|INSERT|UPDATE|DELETE/g) ?? []).sort());
  }
  return matrix;
}

function sqlStatements() {
  const text = read('ops/selfhosted/02-runtime-grants.sql');
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return code
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

function migrationTables() {
  const dir = root('database/migrations');
  const tables = new Set();
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql'))) {
    const up = readFileSync(`${dir}/${name}`, 'utf8').split(/^-- Down Migration/m)[0];
    for (const match of up.matchAll(/^\s*CREATE TABLE app\.([a-z_]+)\s*\(/gm)) {
      tables.add(match[1]);
    }
    for (const match of up.matchAll(/^\s*DROP TABLE app\.([a-z_]+)/gm)) {
      tables.delete(match[1]);
    }
  }
  return tables;
}

describe('ops/selfhosted/02-runtime-grants.sql', () => {
  const statements = sqlStatements();
  const parsed = new Map();
  for (const statement of statements) {
    const match = /^GRANT ((?:SELECT|INSERT|UPDATE|DELETE)(?:, (?:SELECT|INSERT|UPDATE|DELETE))*) ON app\.([a-z_]+) TO ship11_app$/.exec(statement);
    parsed.set(match?.[2] ?? `UNPARSED: ${statement.slice(0, 40)}`, match === null ? [] : match[1].split(', ').sort());
  }

  test('every statement is one explicit per-table GRANT to ship11_app (no ALL, no PUBLIC, no default privileges, no sequence)', () => {
    assert.ok([...parsed.keys()].every((key) => !key.startsWith('UNPARSED')), `unexpected statement: ${[...parsed.keys()].find((key) => key.startsWith('UNPARSED'))}`);
    assert.equal(parsed.size, statements.length, 'no table is granted twice');
    const text = read('ops/selfhosted/02-runtime-grants.sql');
    assert.doesNotMatch(text.replace(/--.*$/gm, ''), /\b(ALL|PUBLIC|DEFAULT PRIVILEGES|SEQUENCE|TRUNCATE|REFERENCES|TRIGGER|WITH GRANT OPTION|pgmigrations)\b/i);
  });

  test('is the same matrix as the runbook table, row by row', () => {
    const matrix = runbookMatrix();
    assert.deepEqual([...parsed.keys()].sort(), [...matrix.keys()].sort());
    for (const [table, privileges] of matrix) {
      assert.deepEqual(parsed.get(table), privileges, table);
    }
  });

  test('covers exactly the tables the migrations create', () => {
    assert.deepEqual([...parsed.keys()].sort(), [...migrationTables()].sort());
    assert.ok(parsed.size >= 28);
  });

  test('keeps the append-only and write-once rules: audit_logs INSERT only; limiter configuration SELECT only; no DELETE where a trigger forbids it', () => {
    assert.deepEqual(parsed.get('audit_logs'), ['INSERT']);
    assert.deepEqual(parsed.get('admin_auth_limit_config'), ['SELECT']);
    for (const table of ['admin_invitations', 'admin_sensitive_operations', 'admin_activation_attempts', 'admin_activation_otp_challenges', 'customer_profiles', 'user_consents']) {
      assert.ok(!(parsed.get(table) ?? []).includes('DELETE'), table);
    }
    assert.deepEqual(parsed.get('user_consents'), ['INSERT', 'SELECT']);
    // M04-A1 / M07: the runtime role can create and move a wallet and append to the ledger (the commission) but never delete any of them.
    assert.deepEqual(parsed.get('driver_wallets'), ['INSERT', 'SELECT', 'UPDATE']);
    assert.deepEqual(parsed.get('wallet_ledger_entries'), ['INSERT', 'SELECT']);
    // M04-A2: holds are written only through the M07 source gates.
    assert.deepEqual(parsed.get('wallet_holds'), ['INSERT', 'SELECT', 'UPDATE']);
    // M07: the delivery history is append-only for the runtime role; nothing of the delivery flow is ever deleted.
    assert.deepEqual(parsed.get('delivery_events'), ['INSERT', 'SELECT']);
    // M04-B1: the topup sources are read-only too; no table of money can be written by the runtime role yet.
    for (const table of ['system_owned_bank_accounts', 'wallet_bank_transactions', 'wallet_topups']) {
      assert.deepEqual(parsed.get(table), ['SELECT'], table);
    }
    // M04-B2.1: the only money-adjacent table the runtime writes is the request (create + cancel); never DELETE, never the balance or the ledger.
    assert.deepEqual(parsed.get('wallet_topup_requests'), ['INSERT', 'SELECT', 'UPDATE']);
    for (const privileges of parsed.values()) {
      assert.ok(privileges.every((kind) => KINDS.includes(kind)));
    }
  });
});

describe('ops/selfhosted configuration files', () => {
  test('pg_hba.conf allows only TLS + SCRAM from loopback for the two project roles on ship11_staging, and rejects everything else', () => {
    const rules = read('ops/selfhosted/pg_hba.conf')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
      .map((line) => line.trim().split(/\s+/));
    assert.deepEqual(rules, [
      ['local', 'all', 'postgres', 'peer'],
      ['hostssl', 'ship11_staging', 'ship11_app', '127.0.0.1/32', 'scram-sha-256'],
      ['hostssl', 'ship11_staging', 'ship11_app', '::1/128', 'scram-sha-256'],
      ['hostssl', 'ship11_staging', 'ship11_migrator', '127.0.0.1/32', 'scram-sha-256'],
      ['hostssl', 'ship11_staging', 'ship11_migrator', '::1/128', 'scram-sha-256'],
      ['host', 'all', 'all', 'all', 'reject'],
    ]);
    assert.doesNotMatch(read('ops/selfhosted/pg_hba.conf').replace(/#.*$/gm, ''), /\b(trust|md5|password)\b/);
  });

  test('postgresql-ship11.conf listens on localhost only and requires TLS 1.3 with SCRAM', () => {
    const settings = new Map(
      read('ops/selfhosted/postgresql-ship11.conf')
        .split('\n')
        .filter((line) => /^[a-z_]+\s*=/.test(line))
        .map((line) => {
          const [key, ...value] = line.split('=');
          return [key.trim(), value.join('=').replace(/#.*$/, '').trim()];
        }),
    );
    assert.equal(settings.get('listen_addresses'), "'localhost'");
    assert.equal(settings.get('port'), '5432');
    assert.equal(settings.get('ssl'), 'on');
    assert.equal(settings.get('ssl_min_protocol_version'), "'TLSv1.3'");
    assert.equal(settings.get('password_encryption'), "'scram-sha-256'");
  });

  test('01-roles-database.sql creates the two non-superuser roles and the database and schema the contract names, with no password in the file', () => {
    const sql = read('ops/selfhosted/01-roles-database.sql');
    const code = sql.replace(/^--.*$/gm, '');
    assert.match(code, /CREATE ROLE ship11_migrator LOGIN PASSWORD :'migrator_password'\s+NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;/);
    assert.match(code, /CREATE ROLE ship11_app LOGIN PASSWORD :'app_password'\s+NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;/);
    assert.match(code, /CREATE DATABASE ship11_staging /);
    assert.match(code, /CREATE SCHEMA app AUTHORIZATION ship11_migrator;/);
    assert.match(code, /GRANT USAGE ON SCHEMA app TO ship11_app;/);
    assert.doesNotMatch(code, /\bSUPERUSER\b(?<!NOSUPERUSER)/);
    assert.doesNotMatch(code, /PASSWORD\s+'/);
  });

  test('make-pki.sh names localhost only (no IP address), refuses to overwrite, and never prints key material', () => {
    const script = read('ops/selfhosted/make-pki.sh');
    assert.match(script, /subjectAltName = DNS:localhost\n/);
    assert.doesNotMatch(script, /IP:/);
    assert.match(script, /already exists/);
    assert.doesNotMatch(script, /cat\s+\S*\.key|echo\s+.*\.key"?\s*\)/);
  });
});
