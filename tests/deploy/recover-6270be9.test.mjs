import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('reviewed release recovery preserves the policy on mismatches and concurrent deploys', {
  skip: process.platform === 'win32' ? 'Linux VPS recovery uses fcntl and POSIX ownership' : false,
}, () => {
  const result = spawnSync('python3', ['tests/deploy/recover-6270be9.test.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
