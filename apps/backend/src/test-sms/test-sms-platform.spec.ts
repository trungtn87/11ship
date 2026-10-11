import { describe, expect, it } from '@jest/globals';
import {
  CommandRunner,
  createPlatform,
  encodePowerShell,
  parseBootTimeSeconds,
  parseLinuxStartTicks,
  parsePsStartTime,
} from './test-sms-platform';

// A real /proc/<pid>/stat line: the command name is in parentheses and may itself contain spaces and parentheses.
const STAT_FIELDS_AFTER_COMM = 'R 1 1 1 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 1000000 100 18446744073709551615';
// fields: state(3) ppid(4) pgrp(5) session(6) tty(7) tpgid(8) flags(9) minflt(10) cminflt(11) majflt(12) cmajflt(13)
//         utime(14) stime(15) cutime(16) cstime(17) priority(18) nice(19) threads(20) itrealvalue(21) starttime(22)

describe('process start time parsing', () => {
  it('reads starttime (field 22) after the closing parenthesis of the command name', () => {
    expect(parseLinuxStartTicks(`4242 (node) ${STAT_FIELDS_AFTER_COMM}`)).toBe(987654);
    expect(parseLinuxStartTicks(`4242 (my (odd) name) ${STAT_FIELDS_AFTER_COMM}`)).toBe(987654);
    expect(parseLinuxStartTicks('garbage')).toBeUndefined();
    expect(parseLinuxStartTicks('1 (x) S 1 2')).toBeUndefined();
  });

  it('reads btime from /proc/stat', () => {
    expect(parseBootTimeSeconds('cpu 1 2 3\nbtime 1790000000\nprocesses 5\n')).toBe(1_790_000_000);
    expect(parseBootTimeSeconds('cpu 1 2 3\n')).toBeUndefined();
  });

  it('reads the BSD ps lstart format as local time', () => {
    const parsed = parsePsStartTime('Sun Oct 11 07:30:12 2026\n');
    expect(parsed).toBe(new Date(2026, 9, 11, 7, 30, 12).getTime());
    expect(parsePsStartTime('nonsense')).toBeUndefined();
  });

  it('encodes a PowerShell script as base64 UTF-16LE for -EncodedCommand', () => {
    const encoded = encodePowerShell('Write-Output 1');
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe('Write-Output 1');
  });
});

describe('createPlatform', () => {
  it('linux: start time = btime*1000 + ticks*10 ms; a missing process is undefined', async () => {
    const files: Record<string, string> = {
      '/proc/4242/stat': `4242 (node) ${STAT_FIELDS_AFTER_COMM}`,
      '/proc/stat': 'cpu 1 2 3\nbtime 1790000000\n',
    };
    const platform = createPlatform({
      platform: 'linux',
      readText: (path) => {
        const text = files[path];
        if (text === undefined) {
          return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        }
        return Promise.resolve(text);
      },
    });
    expect(await platform.processStartTime(4242)).toBe(1_790_000_000_000 + 987_654 * 10);
    expect(await platform.processStartTime(1)).toBeUndefined();
    expect(await platform.processStartTime(0)).toBeUndefined();
    expect(await platform.processStartTime(-5)).toBeUndefined();
    expect(await platform.processStartTime(1.5)).toBeUndefined();
  });

  it('linux: an unreadable /proc entry is an error, never a guessed value', async () => {
    const platform = createPlatform({ platform: 'linux', readText: () => Promise.resolve('garbage') });
    await expect(platform.processStartTime(4242)).rejects.toThrow();
  });

  it('win32: asks Windows PowerShell for the start time (epoch ms) with the PID in the environment, not in the script', async () => {
    const calls: { file: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined }[] = [];
    const runner: CommandRunner = (file, args, env) => {
      calls.push({ file, args, env });
      return Promise.resolve('1790000123456\r\n');
    };
    const platform = createPlatform({ platform: 'win32', runner });
    expect(await platform.processStartTime(777)).toBe(1_790_000_123_456);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe('powershell.exe');
    expect(calls[0]?.args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    expect(calls[0]?.env).toEqual({ TSMS_PID: '777' });
    const script = Buffer.from(calls[0]?.args[5] ?? '', 'base64').toString('utf16le');
    expect(script).toContain('Get-Process');
    expect(script).not.toContain('777');
  });

  it('win32: no output means no such process; unreadable output is an error', async () => {
    expect(await createPlatform({ platform: 'win32', runner: () => Promise.resolve('') }).processStartTime(5)).toBeUndefined();
    await expect(createPlatform({ platform: 'win32', runner: () => Promise.resolve('abc') }).processStartTime(5)).rejects.toThrow();
  });

  it('darwin: uses ps lstart with a fixed locale; a failing ps means no such process', async () => {
    const seen: { file: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined }[] = [];
    const ok = createPlatform({
      platform: 'darwin',
      runner: (file, args, env) => {
        seen.push({ file, args, env });
        return Promise.resolve('Sun Oct 11 07:30:12 2026\n');
      },
    });
    expect(await ok.processStartTime(9)).toBe(new Date(2026, 9, 11, 7, 30, 12).getTime());
    expect(seen[0]).toEqual({ file: 'ps', args: ['-o', 'lstart=', '-p', '9'], env: { LC_ALL: 'C' } });
    const gone = createPlatform({ platform: 'darwin', runner: () => Promise.reject(new Error('exit 1')) });
    expect(await gone.processStartTime(9)).toBeUndefined();
  });

  it('an unsupported platform is an error', async () => {
    await expect(createPlatform({ platform: 'freebsd' }).processStartTime(5)).rejects.toThrow();
  });

  it('current user id: POSIX uid, Windows SID (cached), anything unreadable is an error', async () => {
    expect(await createPlatform({ platform: 'linux', getUid: () => 1000 }).currentUserId()).toBe('1000');
    let calls = 0;
    const win = createPlatform({
      platform: 'win32',
      runner: () => {
        calls += 1;
        return Promise.resolve('S-1-5-21-1111-2222-3333-1001\r\n');
      },
    });
    expect(await win.currentUserId()).toBe('S-1-5-21-1111-2222-3333-1001');
    expect(await win.currentUserId()).toBe('S-1-5-21-1111-2222-3333-1001');
    expect(calls).toBe(1);
    await expect(createPlatform({ platform: 'win32', runner: () => Promise.resolve('not a sid') }).currentUserId()).rejects.toThrow();
    await expect(createPlatform({ platform: 'linux', getUid: () => undefined }).currentUserId()).rejects.toThrow();
  });

  it('on a real Linux host the start time of this process is stable, in the past and after the epoch', async () => {
    if (process.platform !== 'linux') {
      return;
    }
    const platform = createPlatform();
    const first = await platform.processStartTime(process.pid);
    const second = await platform.processStartTime(process.pid);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect((first ?? 0) <= Date.now()).toBe(true);
    expect((first ?? 0) > 1_600_000_000_000).toBe(true);
  });
});
