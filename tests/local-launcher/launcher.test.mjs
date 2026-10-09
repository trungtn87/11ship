import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const local = path.join(root, 'tools', 'local');
const script = await readFile(path.join(local, '11ship-launcher.ps1'), 'utf8');

test('ships one menu and five command wrappers with preserved exit codes', async () => {
  const wrappers = (await readdir(local)).filter((name) => name.endsWith('.cmd')).sort();
  assert.deepEqual(wrappers, [
    '11Ship-Start.cmd', '11Ship-Status.cmd', '11Ship-Stop.cmd', '11Ship-Test.cmd', '11Ship-Update.cmd', '11Ship.cmd',
  ]);
  for (const name of wrappers) {
    const text = await readFile(path.join(local, name), 'utf8');
    assert.match(text, /powershell\.exe -NoProfile -ExecutionPolicy Bypass/);
    assert.match(text, /exit \/b %code%/);
  }
});

test('contains the approved destructive-operation guards', () => {
  for (const forbidden of ['reset --hard', 'down -v', 'db:migrate:remote', 'git stash', 'push --force']) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  for (const required of ["'--ff-only'", "'ship11_test'", "'ship11_dev'", 'TEST_DB_PASSWORD', 'Stop-Process', 'Start-Process']) {
    assert.equal(script.includes(required), true, required);
  }
});

test('keeps state local and documents unavailable applications as N/A', async () => {
  const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
  const runbook = await readFile(path.join(root, 'ops', 'runbooks', 'local-test-launcher-windows.md'), 'utf8');
  assert.match(ignore, /^\.11ship-local\/$/m);
  assert.match(script, /N\/A — chưa có trong repo/);
  assert.match(runbook, /không xóa volume/);
  assert.match(script, /Bỏ qua progress-check vì máy Owner không có GitHub token/);
});

test('CI and package scripts execute launcher contract tests', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const workflow = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.equal(pkg.scripts['launcher:test'], 'node --test "tests/local-launcher/*.test.mjs"');
  assert.match(workflow, /npm run launcher:test/);
});
