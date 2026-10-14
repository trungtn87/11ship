// Static checks of the database-preparation procedure (review F1): one correct way, guards before the first CREATE, no secret
// in argv, no leftover of the procedure that could not work. The behaviour itself is proven by the Ubuntu CI job
// (tests/selfhosted/os-prep.sh) with the real OS users and modes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const read = (relative) => readFileSync(path(relative), 'utf8');
const sql = read('ops/selfhosted/01-roles-database.sql');
const wrapper = read('ops/selfhosted/run-roles-database.sh');
const runbook = read('ops/runbooks/selfhosted-postgres-staging.md');
const code = (text, comment) => text.split('\n').filter((line) => !line.trimStart().startsWith(comment)).join('\n');

describe('01-roles-database.sql', () => {
  const body = code(sql, '--');
  const firstCreate = body.indexOf('CREATE ROLE');

  test('every guard sits before the first CREATE and fails with an error, not a silent quit', () => {
    assert.ok(firstCreate > 0);
    const before = body.slice(0, firstCreate);
    assert.match(before, /\\set ON_ERROR_STOP on/);
    assert.match(before, /\\if :\{\?migrator_password\}/);
    assert.match(before, /\\if :\{\?app_password\}/);
    assert.match(before, /\[0-9a-f\]\{32,128\}/);
    assert.match(before, /migrator_password' <> :'app_password/);
    assert.equal((before.match(/RAISE EXCEPTION/g) ?? []).length, 3);
    assert.doesNotMatch(body, /\\quit/);
    assert.match(before, /SET log_statement = 'none'/);
    assert.match(before, /SET log_min_error_statement = 'panic'/);
  });

  test('the guard messages name variables, never values', () => {
    for (const [, message] of body.matchAll(/RAISE EXCEPTION '([^']*)'/g)) {
      assert.doesNotMatch(message, /%/, 'no format placeholder that could echo a value');
    }
  });

  test('the header documents the wrapper as the way to run it', () => {
    assert.match(sql, /run-roles-database\.sh/);
    assert.doesNotMatch(sql, /\\set\s+\w+\s+`cat/);
  });
});

describe('run-roles-database.sh', () => {
  test('is executable, valid bash, strict, root-only', () => {
    assert.ok((statSync(path('ops/selfhosted/run-roles-database.sh')).mode & 0o111) !== 0, 'executable bit');
    execFileSync('bash', ['-n', path('ops/selfhosted/run-roles-database.sh')]);
    assert.match(wrapper, /set -euo pipefail/);
    assert.match(wrapper, /id -u/);
    assert.match(wrapper, /700 0/);
    assert.match(wrapper, /600 0/);
    assert.match(wrapper, /\[0-9a-f\]\{32,128\}/);
  });

  test('never puts a secret in argv, a file or the environment', () => {
    const lines = code(wrapper, '#');
    assert.doesNotMatch(lines, /PGPASSWORD|-v\s+\w*password|--set|\bexport\b|set -x|\bmktemp\b|>\s*[^&\s|]*\.(sql|tmp)/i);
    assert.match(lines, /printf '\\\\set migrator_password %s\\n' "'\$migrator'"/);
    assert.match(lines, /\| runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres/);
  });
});

describe('runbook', () => {
  test('describes the wrapper and the failure table, and has no instruction that cannot run as the postgres user', () => {
    assert.match(runbook, /sudo \.\/ops\/selfhosted\/run-roles-database\.sh/);
    assert.match(runbook, /peer authentication/);
    const fenced = [...runbook.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
    assert.doesNotMatch(fenced, /\\set \w+_password\s+`cat/);
    assert.doesNotMatch(fenced, /sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres\s*$/m);
    assert.match(runbook, /chẩn đoán/i);
    assert.match(runbook, /không\*\* reset mật khẩu|không reset mật khẩu/i);
  });
});
