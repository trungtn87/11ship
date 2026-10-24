import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

// M12-F: the backup and restore-rehearsal scripts. These checks need no database: syntax, and that the restore script refuses every target that is not a brand-new scratch
// database BEFORE it connects anywhere. The real dump/restore rehearsal is recorded in docs/evidence/m12/restore-rehearsal-20261023.txt.

const script = (name) => new URL(`../../ops/backup/${name}`, import.meta.url).pathname;

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

  test('the rehearsal seed refuses to run outside a rehearsal database', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(script('seed-rehearsal-data.sql'), 'utf8');
    assert.match(sql, /current_database\(\) !~ '\^ship11_rehearsal_/);
    assert.ok(sql.indexOf('REFUSED') < sql.indexOf('session_replication_role'), 'the guard comes before anything is written');
  });
});
