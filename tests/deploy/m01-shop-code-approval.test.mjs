import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = readFileSync(new URL('../../scripts/deploy/github-vps-approve-m01-shop-codes.sh', import.meta.url), 'utf8');
const python = source.split("<<'REMOTE'\n")[1].split('\nREMOTE')[0];
const names = ['1795564800000_shop-display-order-codes', '1795651200000_password-client-sessions'];
const hashes = names.map((name) => createHash('sha256').update(readFileSync(new URL(`../../database/migrations/${name}.sql`, import.meta.url))).digest('hex'));

function fixture(callback) {
  const dir = mkdtempSync(join(tmpdir(), '11ship-policy-'));
  const file = join(dir, 'policy.json');
  try {
    writeFileSync(file, JSON.stringify({ historical: 'preserved' }));
    const args = names.flatMap((name, index) => [name, hashes[index]]);
    const run = (values = args) => spawnSync('python3', ['-c', `import sys\nsys.argv = ${JSON.stringify(['approval', ...values])}\n` + python.replace("Path('/etc/11ship/migration-compatibility.json')", `Path(${JSON.stringify(file)})`)], { encoding: 'utf8' });
    callback({ file, args, run });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('approval preserves old hashes, adds exactly the reviewed pair, is private and idempotent', () => fixture(({ file, run }) => {
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const expected = { historical: 'preserved', [names[0]]: hashes[0], [names[1]]: hashes[1] };
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
  for (const hash of hashes) assert.ok(source.includes(`== ${hash}`), 'the shell must pin the reviewed SQL content');
}));

test('a conflicting prior approval or another migration cannot change the policy', () => fixture(({ file, args, run }) => {
  writeFileSync(file, JSON.stringify({ historical: 'preserved', [names[0]]: 'f'.repeat(64) }));
  const before = readFileSync(file, 'utf8');
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.notEqual(run(['another-migration', ...args.slice(1)]).status, 0);
  assert.equal(readFileSync(file, 'utf8'), before);
}));
