import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

// M12-F: the backup and restore-rehearsal scripts. These checks need no database: syntax, and that the restore script refuses every target that is not a brand-new scratch
// database BEFORE it connects anywhere. The real dump/restore rehearsal is recorded in docs/evidence/m12/restore-rehearsal-20261023.txt.

const script = (name) => fileURLToPath(new URL(`../../ops/backup/${name}`, import.meta.url));

describe('ops/backup scripts', () => {
  test('are valid bash', () => {
    for (const name of ['backup.sh', 'restore-rehearsal.sh']) {
      assert.equal(spawnSync('bash', ['-n', script(name)]).status, 0, name);
    }
  });

  test('restore-rehearsal refuses a database name that is not a scratch name, before any connection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearsal-'));
    try {
      const file = join(dir, 'x.enc');
      const pass = join(dir, 'pass');
      writeFileSync(file, 'x');
      writeFileSync(pass, 'x');
      chmodSync(pass, 0o600);
      for (const name of ['ship11_staging', 'ship11_dev', 'ship11_test', 'postgres', 'ship11_restore_', 'ship11_restore_UPPER', 'ship11_restore_x; DROP DATABASE ship11_staging', 'ship11_verify_' + 'a'.repeat(40)]) {
        // The URL points nowhere: a refusal must happen first, so no connection is attempted.
        const result = spawnSync('bash', [script('restore-rehearsal.sh'), file, pass, 'postgres://nobody@127.0.0.1:1/postgres', name], { encoding: 'utf8' });
        assert.equal(result.status, 64, `${name}: ${result.stderr}`);
        assert.match(result.stderr, /not a scratch database name/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('backup refuses an unknown kind and a missing setting', () => {
    const env = { PATH: process.env.PATH, BACKUP_SOURCE_URL: 'x', BACKUP_SCRATCH_URL: 'x', BACKUP_PASSPHRASE_FILE: 'x', BACKUP_DIR: '/nonexistent-backup-dir' };
    assert.notEqual(spawnSync('bash', [script('backup.sh')], { env: { PATH: process.env.PATH }, encoding: 'utf8' }).status, 0);
    const result = spawnSync('bash', [script('backup.sh')], { env: { ...env, BACKUP_KIND: 'WHENEVER' }, encoding: 'utf8' });
    assert.equal(result.status, 64);
    assert.match(result.stderr, /unknown kind/);
  });

  test('the schema version is read from app.pgmigrations when the VPS has it, otherwise from public.pgmigrations', () => {
    // A stand-in for psql: answers the two questions bk_schema_version asks and refuses anything else. No database is needed.
    const code = `
      source "${script('lib.sh')}"
      sql() {
        local q="\${*: -1}"
        case "$q" in
          *to_regclass*) echo "$FAKE_HAS_APP" ;;
          *"FROM app.pgmigrations"*) echo "APP_HISTORY" ;;
          *"FROM public.pgmigrations"*) echo "PUBLIC_HISTORY" ;;
          *) echo "unexpected query: $q" >&2; exit 1 ;;
        esac
      }
      bk_schema_version
    `;
    const run = (has) => spawnSync('bash', ['-c', code], { env: { PATH: process.env.PATH, FAKE_HAS_APP: has }, encoding: 'utf8' });
    const onVps = run('t');
    assert.equal(onVps.status, 0, onVps.stderr);
    assert.equal(onVps.stdout.trim(), 'APP_HISTORY');
    const local = run('f');
    assert.equal(local.status, 0, local.stderr);
    assert.equal(local.stdout.trim(), 'PUBLIC_HISTORY');
  });

  test('backup and verify both use the same migration-history rule (verify.sql is run by psql on the scratch database)', async () => {
    const { readFileSync } = await import('node:fs');
    const verify = readFileSync(script('verify.sql'), 'utf8');
    assert.match(verify, /to_regclass\('app\.pgmigrations'\)/);
    assert.match(verify, /\\if :has_app_migrations\b/);
    assert.match(verify, /FROM app\.pgmigrations/);
    assert.match(verify, /FROM public\.pgmigrations/);
    const backup = readFileSync(script('backup.sh'), 'utf8');
    assert.match(backup, /schema_version="\$\(bk_schema_version\)"/);
    assert.doesNotMatch(backup, /FROM public\.pgmigrations/);
  });

  test('the rehearsal seed refuses to run outside a rehearsal database', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(script('seed-rehearsal-data.sql'), 'utf8');
    assert.match(sql, /current_database\(\) !~ '\^ship11_rehearsal_/);
    assert.ok(sql.indexOf('REFUSED') < sql.indexOf('session_replication_role'), 'the guard comes before anything is written');
  });
});
