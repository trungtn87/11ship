import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const local = path.join(root, 'tools', 'local');
const script = await readFile(path.join(local, '11ship-launcher.ps1'), 'utf8');

// Windows PowerShell 5.1 is what the wrappers call on the Owner's machine; PowerShell 7 runs the same
// behaviour suite on other systems (the Windows-only wrapper runs are reported as SKIP there).
function findPowerShell() {
  const candidates = process.platform === 'win32' ? ['powershell.exe'] : ['pwsh'];
  for (const exe of candidates) {
    const probe = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (probe.status === 0) return { exe, version: probe.stdout.trim() };
  }
  return null;
}

test('launcher behaviour suite (real git, faked Docker/npm) passes under PowerShell', { timeout: 15 * 60_000 }, (t) => {
  const shell = findPowerShell();
  if (!shell) {
    // Never a silent pass: CI must have PowerShell, a developer machine without it sees an explicit skip.
    assert.equal(process.env.CI, undefined, 'PowerShell is required in CI to run the launcher behaviour suite');
    t.skip('PowerShell is not installed; behaviour suite not run');
    return;
  }
  const run = spawnSync(
    shell.exe,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests', 'local-launcher', 'launcher.Tests.ps1')],
    { encoding: 'utf8', cwd: root, timeout: 14 * 60_000 },
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const summary = /SUMMARY pass=(\d+) fail=(\d+) skip=(\d+)/.exec(output);
  // Everything except the PASS lines, kept for CI annotations (the job log itself cannot always be downloaded).
  const report = [`POWERSHELL ${shell.version} exit=${run.status}`, ...output.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('PASS '))];
  mkdirSync(path.join(root, '.test-results'), { recursive: true });
  writeFileSync(path.join(root, '.test-results', 'launcher-behaviour.log'), `${report.join('\n')}\n`);
  t.diagnostic(`PowerShell ${shell.version}: ${summary ? summary[0] : 'no summary line'}`);
  for (const line of output.split(/\r?\n/).filter((l) => l.startsWith('SKIP ') || l.startsWith('FAIL '))) t.diagnostic(line);
  assert.equal(run.status, 0, output.split(/\r?\n/).filter((l) => !l.startsWith('PASS ')).join('\n'));
  assert.ok(summary, 'behaviour suite printed its summary');
  assert.equal(Number(summary[2]), 0);
  // 165 before M00.01 plus the 63 checks it added (app entry, child-process and Windows wrapper runs): the suite must not shrink.
  assert.ok(Number(summary[1]) >= 228, `expected at least 228 behaviour checks, got ${summary[1]}`);
  if (process.platform === 'win32') {
    assert.ok(!/SKIP real Windows wrapper runs/.test(output), 'Windows wrapper runs must not be skipped on Windows');
  }
});

test('ships one menu, five command wrappers and three app wrappers that preserve exit codes and never pause on their own', async () => {
  const wrappers = (await readdir(local)).filter((name) => name.endsWith('.cmd') && name !== '11ship-test-sms.cmd').sort(); // the SMS reader: tests/test-sms-tool
  assert.deepEqual(wrappers, [
    '11Ship-Admin.cmd', '11Ship-Food.cmd', '11Ship-Ship.cmd', '11Ship-Start.cmd', '11Ship-Status.cmd', '11Ship-Stop.cmd',
    '11Ship-Test.cmd', '11Ship-Update.cmd', '11Ship.cmd',
  ]);
  for (const name of wrappers) {
    const text = await readFile(path.join(local, name), 'utf8');
    assert.match(text, /powershell\.exe -NoProfile -ExecutionPolicy Bypass/);
    assert.match(text, /exit \/b %code%/);
    // The launcher decides whether to keep the window open (double-click only); a bare `pause` would hang terminals.
    assert.doesNotMatch(text, /^\s*(if .*)?pause\b/im);
  }
});

test('each app wrapper hands exactly its own app to the one shared launcher, from its own folder', async () => {
  // The apps are Web Admin, 11Food (customer and shop owner) and 11Ship (driver): there is no separate shop-owner app.
  for (const app of ['Admin', 'Food', 'Ship']) {
    const text = await readFile(path.join(local, `11Ship-${app}.cmd`), 'utf8');
    const calls = text.split(/\r?\n/).filter((line) => line.includes('powershell.exe'));
    assert.equal(calls.length, 1, `${app}: one launcher call`);
    assert.ok(calls[0].includes('-File "%~dp011ship-launcher.ps1"'), `${app}: shared launcher beside the wrapper, not relative to the caller folder`);
    assert.ok(calls[0].includes(`-Command App -App ${app} %*`), `${app}: passes its own app and forwards extra arguments`);
    assert.deepEqual([...text.matchAll(/-App\s+(\S+)/g)].map((match) => match[1]), [app], `${app}: names no other app`);
    assert.doesNotMatch(text, /\b(start|explorer|msedge|chrome|node)\b/i, `${app}: the wrapper itself opens and starts nothing`);
  }
  assert.match(script, /\[ValidateSet\('Admin','Food','Ship'\)\]\s*\[string\]\$App/);
  assert.match(script, /\[ValidateSet\('Menu','Start','Update','Test','Stop','Status','InstallShortcut','App'\)\]/);
});

test('contains the approved destructive-operation guards', () => {
  for (const forbidden of ['reset --hard', 'down -v', 'db:migrate:remote', 'git stash', 'push --force', 'audit fix']) {
    assert.equal(script.includes(forbidden), false, forbidden);
  }
  for (const required of ["'--ff-only'", "'ship11_test'", "'ship11_dev'", 'Stop-Process', 'Start-Process']) {
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

test('CI and package scripts execute launcher tests, including on real Windows', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const workflow = (await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(pkg.scripts['launcher:test'], 'node --test "tests/local-launcher/*.test.mjs"');
  assert.match(workflow, /npm run launcher:test/);
  const start = workflow.indexOf('\n  launcher-windows:');
  assert.notEqual(start, -1, 'job launcher-windows exists');
  const job = workflow.slice(start);
  assert.match(job, /runs-on: windows-/);
  assert.match(job, /shell: powershell\n\s+run: npm run launcher:test/);
});
