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
  // 165 before M00.01, 250 after it (Linux), and M00.02 added the lock, Git, UAT and hand-over checks (460 on Windows PowerShell 5.1
  // at the first green run, including the Windows-only wrapper runs). The suite must not shrink.
  assert.ok(Number(summary[1]) >= 400, `expected at least 400 behaviour checks, got ${summary[1]}`);
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

test('M00.02: the shared lock is an exclusive OS handle, never a file age, and nothing stops or deletes the holder', async () => {
  assert.ok(script.includes('[IO.FileShare]::None'), 'lock file opened with FileShare.None');
  assert.match(script, /function Use-LaunchLock/);
  assert.match(script, /'LAUNCH_LOCK_TIMEOUT'/);
  assert.match(script, /'LAUNCH_LOCK_UNAVAILABLE'/);
  // The lock and gate files are never deleted or aged out by the launcher; only the display file is removed.
  assert.doesNotMatch(script, /Remove-Item[^\n]*\$script:(LockFile|GateFile)/);
  assert.doesNotMatch(script, /LastWriteTime|CreationTime/);
  // The re-run launcher needs our lock, so the old one never waits for it with -Wait (that would also wait for its backend).
  const spawnFunction = script.slice(script.indexOf('function Start-LauncherProcess'), script.indexOf('function Open-GateWithin'));
  assert.ok(spawnFunction.includes('Start-Process'));
  assert.doesNotMatch(spawnFunction.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('\n'), /-Wait\b/);
  assert.match(script, /ExclusiveLock\s*=\s*\[pscustomobject\]@\{ Ready = \$true;/);
  assert.match(script, /ArtifactIdentity\s*=\s*\[pscustomobject\]@\{ Ready = \$false;/);
});

test('M00.02: Git update modes and the hand-over to the new launcher are in place', () => {
  for (const code of ['NOT_MAIN_BRANCH', 'UPSTREAM_MISMATCH', 'GIT_FETCH_FAILED', 'GIT_UPDATE_FAILED', 'GIT_OPERATION_IN_PROGRESS', 'UAT_SHA_MISMATCH', 'UAT_PIN_INVALID',
    'GIT_STATE_UNREADABLE', 'GIT_DIFF_UNREADABLE', 'LAUNCHER_IDENTITY_UNREADABLE', 'RELAUNCH_FAILED', 'RELAUNCH_LIMIT', 'RELAUNCH_SHA_MISMATCH', 'RELAUNCH_LAUNCHER_MISMATCH', 'RELAUNCH_CHILD_FAILED', 'LAUNCHER_RELOAD_REQUIRED']) {
    assert.ok(script.includes(`'${code}'`), code);
  }
  for (const name of ['RelaunchToken', 'RelaunchFromSha', 'RelaunchToSha', 'RelaunchLauncherHash']) assert.match(script, new RegExp(`\\[string\\]\\$${name}`));
  assert.ok(script.includes("@('merge','--ff-only',$upstream)"), 'fast-forward only');
  // F1: the code a process loaded is compared with the file on disk once the lock is owned; F2: failed Git reads are not empty answers.
  assert.ok(script.includes('MIGRATION_COUNT_UNREADABLE'), 'unknown migration count is reported, never as 0');
  assert.match(script, /\$script:LoadedLauncherHash = Get-LauncherIdentity/);
  assert.match(script, /\$onDisk -ne \$script:LoadedLauncherHash/);
  // F3: the handle is disposed in a finally unless ownership was handed to the lock state.
  assert.match(script, /\$owned = \$false\s+try \{/);
  assert.match(script, /if \(!\$owned\) \{ try \{ \$handle\.Dispose\(\) \} catch \{ \} \}/);
  assert.doesNotMatch(script, /if \(\(Capture 'git\.exe' @\('status'/);
  assert.doesNotMatch(script, /return 0 \}\s*\n\s*return @\("\$names"/);
  assert.ok(script.includes('uat-pin.json'), 'UAT pin file');
  // Any npm/build/backend work runs inside the repository that holds the script, whatever the caller folder is.
  assert.match(script, /function Invoke-InRepo\(\[scriptblock\]\$Body\) \{ Push-Location -LiteralPath \$script:Repo/);
  assert.ok(script.includes('-WorkingDirectory $script:Repo'), 'child processes start in the repository');
});

test('M00.02: test support scripts exist and stay ASCII (Windows PowerShell 5.1 reads a BOM-less file as ANSI)', async () => {
  for (const name of ['lock-holder.ps1', 'relaunch-harness.ps1']) {
    const bytes = await readFile(path.join(root, 'tests', 'local-launcher', 'support', name));
    assert.ok(bytes.every((byte) => byte < 0x80), `${name} is ASCII`);
  }
  const bytes = await readFile(path.join(root, 'tests', 'local-launcher', 'launcher.Tests.ps1'));
  assert.ok(bytes.every((byte) => byte < 0x80), 'launcher.Tests.ps1 is ASCII');
  const launcher = await readFile(path.join(local, '11ship-launcher.ps1'));
  assert.deepEqual([...launcher.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'launcher keeps its UTF-8 BOM');
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
