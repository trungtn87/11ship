import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { createTestSmsRuntime, TestSmsRuntime } from './test-sms-runtime';
import { createPlatform } from './test-sms-platform';
import { TOOL_TEXT, ToolIo, runToolSession } from './tool-session';

// TS07/TS09 (operator tool flow): scripted keyboard against a REAL runtime (listener + private state).

const posix = process.platform === 'linux' || process.platform === 'darwin';
const PHONE = '+84901234567';
const DB = 'postgres://ship11_dev:secret@127.0.0.1:5432/ship11_dev';
const dirs: string[] = [];
const runtimes: TestSmsRuntime[] = [];

afterEach(async () => {
  while (runtimes.length > 0) await (runtimes.pop() as TestSmsRuntime).stop();
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function repoDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-tool-')));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '11ship' }));
  return dir;
}

function startRuntime(dir: string): TestSmsRuntime {
  const runtime = createTestSmsRuntime({ config: { register: true, activation: true }, appEnv: 'development', host: '127.0.0.1', databaseUrl: DB, repoRoot: dir });
  runtimes.push(runtime);
  return runtime;
}

function scripted(answers: (string | (() => Promise<void> | void))[]): { io: ToolIo; out: string[]; asked: string[] } {
  const out: string[] = [];
  const asked: string[] = [];
  const queue = [...answers];
  const io: ToolIo = {
    print: (line) => { out.push(line); },
    ask: async (prompt) => {
      asked.push(prompt);
      let next = queue.shift();
      while (typeof next === 'function') {
        await next();
        next = queue.shift();
      }
      return next;
    },
  };
  return { io, out, asked };
}

const fast = { sleep: () => Promise.resolve() };

describe('operator tool session', () => {
  it('backend not running -> clear message, exit 1, nothing connected', async () => {
    const dir = await repoDir();
    const { io, out } = scripted([]);
    expect(await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast })).toBe(1);
    expect(out).toContain(TOOL_TEXT.noBackend);
  });

  it('not the 11ship repository -> repo message', async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-tool-empty-')));
    dirs.push(dir);
    const { io, out } = scripted([]);
    expect(await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast })).toBe(1);
    expect(out).toContain(TOOL_TEXT.repo);
  });

  it('lists, picks one message and shows its code; the list itself never contains a code or the full phone', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const runtime = startRuntime(dir);
    await runtime.start();
    await runtime.registerProvider?.sendRegisterOtp(PHONE, '135790');
    const { io, out } = scripted(['1', '1', 'q']);
    expect(await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast })).toBe(0);
    const text = out.join('\n');
    const listIndex = out.findIndex((l) => l.startsWith('1. '));
    expect(listIndex).toBeGreaterThan(-1);
    expect(out[listIndex]).not.toContain('135790');
    expect(out[listIndex]).not.toContain(PHONE);
    expect(text).toContain('MÃ OTP   : 135790');
    expect(text).toContain(PHONE);
    expect(out).toContain(TOOL_TEXT.closed);
  });

  it('filters by purpose and by phone (normalizing the typed number); invalid input is rejected without a request', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const runtime = startRuntime(dir);
    await runtime.start();
    await runtime.registerProvider?.sendRegisterOtp(PHONE, '111111');
    await runtime.activationProvider?.send(PHONE, '222222');
    const { io, out } = scripted(['2', '2', '', '3', '0901234567', '', '3', 'abc', '2', '9', 'zzz', 'q']);
    await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast });
    expect(out.filter((l) => l.startsWith('1. ')).length).toBeGreaterThanOrEqual(2);
    expect(out).toContain(TOOL_TEXT.badPhone);
    expect(out).toContain(TOOL_TEXT.badChoice);
    expect(out.join('\n')).not.toContain('111111');
    expect(out.join('\n')).not.toContain('222222');
  });

  it('empty inbox says so; closed input ends cleanly', async () => {
    if (!posix) return;
    const dir = await repoDir();
    await startRuntime(dir).start();
    const { io, out } = scripted(['1']);
    expect(await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast })).toBe(0);
    expect(out).toContain(TOOL_TEXT.empty);
  });

  it('survives a backend restart: tells the operator the inbox was cleared, reconnects with the NEW token', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const first = startRuntime(dir);
    await first.start();
    await first.registerProvider?.sendRegisterOtp(PHONE, '111111');
    let second: TestSmsRuntime | undefined;
    const { io, out } = scripted([
      '1', '', // see the list, go back
      async () => {
        await first.stop();
        second = startRuntime(dir);
        await second.start();
        await second.registerProvider?.sendRegisterOtp(PHONE, '999999');
      },
      '1', '1', 'q',
    ]);
    await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast });
    expect(out).toContain(TOOL_TEXT.restarted);
    expect(out.join('\n')).toContain('MÃ OTP   : 999999');
    expect(out.join('\n')).not.toContain('MÃ OTP   : 111111');
  });

  it('a backend that disappeared mid-session ends with a stale message after bounded retries, never hanging', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const runtime = startRuntime(dir);
    await runtime.start();
    let sleeps = 0;
    const { io, out } = scripted([async () => { await runtime.stop(); }, '1', 'q']);
    await runToolSession({ io, platform: createPlatform(), repoRoot: dir, sleep: () => { sleeps += 1; return Promise.resolve(); } });
    expect(out.some((l) => l === TOOL_TEXT.stale || l === TOOL_TEXT.noBackend)).toBe(true);
    expect(sleeps).toBeLessThanOrEqual(3);
  });

  it('unsafe state is never used: the token is not sent when the ownership chain fails', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const runtime = startRuntime(dir);
    await runtime.start();
    let created = 0;
    const platform = { ...createPlatform(), currentUserId: () => Promise.resolve('someone-else') };
    const { io, out } = scripted([]);
    expect(await runToolSession({ io, platform, repoRoot: dir, createClient: () => { created += 1; throw new Error('must not connect'); }, ...fast })).toBe(1);
    expect(created).toBe(0);
    expect(out).toContain(TOOL_TEXT.unsafe);
  });

  it('prints neither the token nor the port', async () => {
    if (!posix) return;
    const dir = await repoDir();
    const runtime = startRuntime(dir);
    await runtime.start();
    await runtime.registerProvider?.sendRegisterOtp(PHONE, '135790');
    const port = String(runtime.listenerPort);
    const { io, out, asked } = scripted(['1', '1', 'q']);
    await runToolSession({ io, platform: createPlatform(), repoRoot: dir, ...fast });
    const everything = [...out, ...asked].join('\n');
    expect(everything).not.toContain(port);
    expect(everything).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});
