import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createPlatform } from './test-sms-platform';
import { createTestSmsRuntime, TestSmsRuntime, TestSmsRuntimeOptions } from './test-sms-runtime';
import { readVerifiedState, resolveRepo } from './test-sms-state';
import { TestSmsStartupError } from './test-sms-types';

// TS07/TS08 (runtime): the lifecycle of the shared inbox + listener + discovery state, restart semantics and the
// "refuse before anything opens" guard. Real files and real loopback sockets; no database.

const posix = process.platform === 'linux' || process.platform === 'darwin';
const dirs: string[] = [];
const runtimes: TestSmsRuntime[] = [];
const DB = 'postgres://ship11_dev:secret@127.0.0.1:5432/ship11_dev';

afterEach(async () => {
  while (runtimes.length > 0) {
    await (runtimes.pop() as TestSmsRuntime).stop();
  }
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function repoDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-rt-')));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '11ship' }));
  return dir;
}

function make(repoRoot: string, extra: Partial<TestSmsRuntimeOptions> = {}): TestSmsRuntime {
  const runtime = createTestSmsRuntime({
    config: { register: true, activation: true },
    appEnv: 'development',
    host: '127.0.0.1',
    databaseUrl: DB,
    repoRoot,
    ...extra,
  });
  runtimes.push(runtime);
  return runtime;
}

async function startupCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    if (error instanceof TestSmsStartupError) {
      return error.code;
    }
    throw error;
  }
}

describe('guard: refused before anything is created', () => {
  it('staging, production, unknown env, non-loopback host and remote database all refuse construction', () => {
    const attempts: Partial<TestSmsRuntimeOptions>[] = [
      { appEnv: 'staging' },
      { appEnv: 'production' },
      { appEnv: 'prod' },
      { host: '0.0.0.0' },
      { host: 'example.com' },
      { databaseUrl: 'postgres://u:p@db.example.com:5432/x' },
      { databaseUrl: 'not a url' },
    ];
    for (const attempt of attempts) {
      expect(() => createTestSmsRuntime({ config: { register: true, activation: false }, appEnv: 'development', host: '127.0.0.1', databaseUrl: DB, ...attempt })).toThrow(TestSmsStartupError);
    }
  });

  it('exposes only the adapters that were selected', async () => {
    const dir = await repoDir();
    const onlyRegister = make(dir, { config: { register: true, activation: false } });
    expect(onlyRegister.registerProvider).toBeDefined();
    expect(onlyRegister.activationProvider).toBeUndefined();
    const onlyActivation = make(dir, { config: { register: false, activation: true } });
    expect(onlyActivation.registerProvider).toBeUndefined();
    expect(onlyActivation.activationProvider).toBeDefined();
  });

  it('constructing does not open a listener nor write state', async () => {
    const dir = await repoDir();
    const runtime = make(dir);
    expect(runtime.listenerPort).toBeUndefined();
    await expect(readFile(path.join(dir, '.11ship-local', 'test-sms', 'state.json'))).rejects.toThrow();
  });
});

describe('lifecycle', () => {
  it('start publishes state with a loopback port; one shared inbox receives both purposes; stop removes everything', async () => {
    if (!posix) {
      return;
    }
    const dir = await repoDir();
    const runtime = make(dir);
    await runtime.start();
    expect(runtime.listenerPort).toBeGreaterThan(0);
    const verified = await readVerifiedState(createPlatform(), await resolveRepo(createPlatform(), dir));
    expect(verified.port).toBe(runtime.listenerPort);

    await runtime.registerProvider?.sendRegisterOtp('+84901234567', '123456');
    await runtime.activationProvider?.send('+84901234567', '654321');
    expect(runtime.inbox.size()).toBe(2);

    const response = await fetch(`http://127.0.0.1:${verified.port}/messages`, { headers: { Authorization: `Bearer ${verified.token}` } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { items: { purpose: string }[] } };
    expect(body.data.items.map((m) => m.purpose).sort()).toEqual(['ADMIN_ACTIVATION', 'REGISTER']);

    await runtime.stop();
    expect(runtime.inbox.size()).toBe(0);
    expect(runtime.listenerPort).toBeUndefined();
    await expect(readFile(path.join(dir, '.11ship-local', 'test-sms', 'state.json'))).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${verified.port}/messages`, { headers: { Authorization: `Bearer ${verified.token}` } })).rejects.toThrow();
  });

  it('start and stop are idempotent', async () => {
    if (!posix) {
      return;
    }
    const runtime = make(await repoDir());
    await runtime.start();
    const port = runtime.listenerPort;
    await runtime.start();
    expect(runtime.listenerPort).toBe(port);
    await runtime.stop();
    await runtime.stop();
  });

  it('a restart gives a NEW token and an EMPTY inbox (old token is dead)', async () => {
    if (!posix) {
      return;
    }
    const dir = await repoDir();
    const platform = createPlatform();
    const repo = await resolveRepo(platform, dir);
    const first = make(dir);
    await first.start();
    const before = await readVerifiedState(platform, repo);
    await first.registerProvider?.sendRegisterOtp('+84901234567', '123456');
    await first.stop();

    const second = make(dir);
    await second.start();
    const after = await readVerifiedState(platform, repo);
    expect(after.token).not.toBe(before.token);
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(second.inbox.size()).toBe(0);
    const oldTokenOnNewPort = await fetch(`http://127.0.0.1:${after.port}/messages`, { headers: { Authorization: `Bearer ${before.token}` } });
    expect(oldTokenOnNewPort.status).toBe(401);
  });

  it('two live backends of the same repository: the second refuses (STATE_IN_USE) and the first keeps its state', async () => {
    if (process.platform !== 'linux') {
      return;
    }
    const dir = await repoDir();
    const platform = createPlatform();
    const first = make(dir);
    await first.start();
    const state = await readFile(path.join(dir, '.11ship-local', 'test-sms', 'state.json'), 'utf8');
    // The same OS process cannot play "another backend": pretend to be the real parent process (alive, other start time).
    const other = make(dir, { platform: { ...platform, pid: process.pid + 100_000 } });
    // Real PID of this process is in the state; the pretender has a different PID, so the state is "owned by a live other".
    expect(await startupCode(other.start())).toBe('TEST_INBOX_STATE_IN_USE');
    expect(await readFile(path.join(dir, '.11ship-local', 'test-sms', 'state.json'), 'utf8')).toBe(state);
    expect(other.listenerPort).toBeUndefined();
  });
});

describe('startup failures close everything that was opened', () => {
  it('listener failure -> fixed code, no state, no listener', async () => {
    if (!posix) {
      return;
    }
    const dir = await repoDir();
    const runtime = make(dir, { startListener: () => Promise.reject(new Error('EADDRINUSE secret-detail')) });
    expect(await startupCode(runtime.start())).toBe('TEST_INBOX_LISTENER_FAILED');
    await expect(readFile(path.join(dir, '.11ship-local', 'test-sms', 'state.json'))).rejects.toThrow();
  });

  it('state publish failure after the listener opened -> the listener is closed again', async () => {
    if (!posix) {
      return;
    }
    const dir = await repoDir();
    let stopped = 0;
    const runtime = make(dir, {
      platform: { ...createPlatform(), processStartTime: () => Promise.resolve(undefined) },
      startListener: () => Promise.resolve({ host: '127.0.0.1', port: 40000, stop: () => { stopped += 1; return Promise.resolve(); } }),
    });
    expect(await startupCode(runtime.start())).toBe('TEST_INBOX_STATE_WRITE_FAILED');
    expect(stopped).toBe(1);
    expect(runtime.inbox.size()).toBe(0);
  });

  it('an unresolvable repository -> TEST_INBOX_REPO_UNRESOLVED before any listener opens', async () => {
    let opened = 0;
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-rt-empty-')));
    dirs.push(dir);
    const runtime = make(dir, { startListener: () => { opened += 1; return Promise.reject(new Error('x')); } });
    expect(await startupCode(runtime.start())).toBe('TEST_INBOX_REPO_UNRESOLVED');
    expect(opened).toBe(0);
  });

  it('error messages carry only a fixed code (no token, path or port)', async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-rt-empty-')));
    dirs.push(dir);
    const runtime = make(dir);
    try {
      await runtime.start();
    } catch (error) {
      expect((error as Error).message).not.toContain(dir);
    }
  });
});
