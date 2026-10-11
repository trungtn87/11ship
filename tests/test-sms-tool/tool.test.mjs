import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// M01.22 operator tool, outside Jest: the real .cmd wrapper, the real Node entry point and the compiled backend
// modules (needs `npm run build`; in CI the build runs first). The in-process behaviour is covered by the Jest specs.

const root = path.resolve(import.meta.dirname, '..', '..');
const wrapper = path.join(root, 'tools', 'local', '11ship-test-sms.cmd');
const entry = path.join(root, 'scripts', 'test-sms-inbox.mjs');
const dist = path.join(root, 'apps', 'backend', 'dist');
const built = existsSync(path.join(dist, 'test-sms', 'tool-session.js'));
const require = createRequire(import.meta.url);

test('wrapper: ASCII, UTF-8 console, exits with the tool code, pauses only for a double-click and honours SHIP11_NO_PAUSE', async () => {
  const bytes = await readFile(wrapper);
  assert.ok(bytes.every((b) => b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)), 'wrapper is plain ASCII');
  const text = bytes.toString('ascii').replaceAll('\r\n', '\n');
  assert.match(text, /^@echo off$/m);
  assert.match(text, /^chcp 65001 >nul$/m);
  assert.match(text, /cmdcmdline/);
  assert.match(text, /SHIP11_NO_PAUSE/);
  assert.match(text, /node scripts\\test-sms-inbox\.mjs$/m);
  assert.match(text, /exit \/b %code%/);
  // No argument is forwarded: a code, a token or a number is never put on a command line.
  assert.doesNotMatch(text, /%\*|%1/);
});

test('entry point is read-only: no mutation verbs, no outbound request of its own, no file writes', async () => {
  const text = await readFile(entry, 'utf8');
  for (const forbidden of ['POST', 'PUT', 'DELETE', 'fetch(', 'writeFile', 'appendFile', 'child_process', 'process.env', 'exec(']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('entry point refuses any argument (exit 2) without touching state', { skip: !built && 'backend not built (npm run build)' }, () => {
  const run = spawnSync(process.execPath, [entry, '123456'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(run.status, 2);
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /123456/);
});

function tempRepoWithTool() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'tsms-e2e-')));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '11ship' }));
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(entry, path.join(dir, 'scripts', 'test-sms-inbox.mjs'));
  cpSync(dist, path.join(dir, 'apps', 'backend', 'dist'), { recursive: true });
  return dir;
}

function runTool(dir, input, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, 'scripts', 'test-sms-inbox.mjs')], {
      cwd: os.tmpdir(),
      env: { ...process.env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.stdin.end(input);
  });
}

test('end to end with the real private state: backend not running, then a live backend, then after its stop', { skip: !built && 'backend not built (npm run build)', timeout: 120_000 }, async (t) => {
  const dir = tempRepoWithTool();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dead = await runTool(dir, '');
  assert.equal(dead.code, 1);
  assert.match(dead.out, /Backend chưa chạy/);

  const { createTestSmsRuntime } = require(path.join(dir, 'apps', 'backend', 'dist', 'test-sms', 'test-sms-runtime.js'));
  const runtime = createTestSmsRuntime({
    config: { register: true, activation: true },
    appEnv: 'development',
    host: '127.0.0.1',
    databaseUrl: 'postgres://ship11_dev:secret@127.0.0.1:5432/ship11_dev',
    repoRoot: dir,
  });
  await runtime.start();
  try {
    await runtime.registerProvider.sendRegisterOtp('+84901234567', '135790');
    await runtime.activationProvider.send('+84901234567', '246802');
    const live = await runTool(dir, '1\n1\nq\n');
    assert.equal(live.code, 0, live.out);
    assert.match(live.out, /MÃ OTP   : (135790|246802)/);
    assert.equal(live.out.includes(String(runtime.listenerPort)), false, 'the port is never printed');
  } finally {
    await runtime.stop();
  }
  const after = await runTool(dir, '');
  assert.equal(after.code, 1);
  assert.match(after.out, /Backend chưa chạy/);
});

test('Windows: the real .cmd wrapper, started the way a double-click starts it, returns the tool exit code', { skip: process.platform !== 'win32' && 'Windows-only (cmd.exe wrapper)', timeout: 120_000 }, (t) => {
  if (!built) {
    t.skip('backend not built (npm run build)');
    return;
  }
  // Explorer starts "cmd.exe /c <wrapper>": that command line is what the wrapper uses to detect a double-click.
  const run = spawnSync('cmd.exe', ['/d', '/c', wrapper], { encoding: 'utf8', input: '', timeout: 90_000, env: { ...process.env, SHIP11_NO_PAUSE: '1' } });
  const out = `${run.stdout}${run.stderr}`;
  // Either the backend of the real repository is not running (exit 1) or a developer one is (exit 0); never a crash.
  assert.ok(run.status === 0 || run.status === 1, out);
  assert.match(out, /Hộp OTP test|H.p OTP test|Backend|repo/);
});
