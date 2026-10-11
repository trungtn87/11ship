import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// OS facts the test SMS inbox needs, behind small injectable functions so every branch is unit-testable on any OS:
//  - the START TIME of a process (PID + start time identify a backend instance; a reused PID has another start time);
//  - the current OS user id (POSIX uid, Windows SID);
//  - the Windows PowerShell runner used for ACL work (there is no chmod on Windows).
// The same functions are used by the backend (to publish its identity) and by the operator tool (to verify it), so
// both sides always compute the same value.

/** Runs an executable and returns stdout. Rejects on a non-zero exit, a timeout or output above the cap. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<string>;

export const runCommand: CommandRunner = (file, args, env) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        timeout: 20_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: { ...process.env, ...(env ?? {}) },
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });

/** Linux USER_HZ is a fixed ABI constant (100): one clock tick is 10 ms. */
const LINUX_TICK_MS = 10;

/** Field 22 of /proc/<pid>/stat (start time in clock ticks since boot). The command name may contain spaces. */
export function parseLinuxStartTicks(stat: string): number | undefined {
  const close = stat.lastIndexOf(')');
  if (close < 0) {
    return undefined;
  }
  // After ")" the fields start at number 3 (state). starttime is field 22 -> index 19.
  const fields = stat.slice(close + 2).trim().split(' ');
  const ticks = Number(fields[19]);
  return Number.isSafeInteger(ticks) && ticks >= 0 ? ticks : undefined;
}

export function parseBootTimeSeconds(procStat: string): number | undefined {
  const match = /^btime (\d+)$/m.exec(procStat);
  const seconds = match === null ? undefined : Number(match[1]);
  return seconds !== undefined && Number.isSafeInteger(seconds) ? seconds : undefined;
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** `ps -o lstart=` prints local time like "Sun Oct 11 07:30:12 2026" (macOS and other BSD-like systems). */
export function parsePsStartTime(output: string): number | undefined {
  const match = /^\s*[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s*$/.exec(output);
  if (match === null) {
    return undefined;
  }
  const month = MONTHS[match[1] as string];
  if (month === undefined) {
    return undefined;
  }
  const ms = new Date(
    Number(match[6]),
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const POWERSHELL_PID_SCRIPT =
  "$ErrorActionPreference='Stop';$p=Get-Process -Id ([int]$env:TSMS_PID) -ErrorAction SilentlyContinue;" +
  'if($p){[DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds()}';

const POWERSHELL_USER_SCRIPT =
  "$ErrorActionPreference='Stop';[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value";

export function runPowerShell(
  script: string,
  env: Readonly<Record<string, string>>,
  runner: CommandRunner = runCommand,
): Promise<string> {
  return runner(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(script)],
    env,
  );
}

export interface PlatformOptions {
  readonly platform?: NodeJS.Platform;
  readonly runner?: CommandRunner;
  readonly pid?: number;
  readonly readText?: (path: string) => Promise<string>;
  readonly getUid?: () => number | undefined;
}

export interface Platform {
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  readonly runner: CommandRunner;
  /** Epoch milliseconds when the process started, or undefined when no such process exists. Rejects if unknowable. */
  processStartTime(pid: number): Promise<number | undefined>;
  currentUserId(): Promise<string>;
}

export function createPlatform(options: PlatformOptions = {}): Platform {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? runCommand;
  const readText = options.readText ?? ((path: string) => readFile(path, 'utf8'));
  const getUid = options.getUid ?? (() => (typeof process.getuid === 'function' ? process.getuid() : undefined));
  let cachedUser: string | undefined;

  async function processStartTime(pid: number): Promise<number | undefined> {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return undefined;
    }
    if (platform === 'win32') {
      const output = (await runPowerShell(POWERSHELL_PID_SCRIPT, { TSMS_PID: String(pid) }, runner)).trim();
      if (output === '') {
        return undefined;
      }
      const value = Number(output);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error('unreadable process start time');
      }
      return value;
    }
    if (platform === 'linux') {
      let stat: string;
      try {
        stat = await readText(`/proc/${pid}/stat`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ESRCH') {
          return undefined;
        }
        throw error;
      }
      const ticks = parseLinuxStartTicks(stat);
      const boot = parseBootTimeSeconds(await readText('/proc/stat'));
      if (ticks === undefined || boot === undefined) {
        throw new Error('unreadable process start time');
      }
      return boot * 1000 + ticks * LINUX_TICK_MS;
    }
    if (platform === 'darwin') {
      let output: string;
      try {
        output = await runner('ps', ['-o', 'lstart=', '-p', String(pid)], { LC_ALL: 'C' });
      } catch {
        return undefined;
      }
      if (output.trim() === '') {
        return undefined;
      }
      const parsed = parsePsStartTime(output);
      if (parsed === undefined) {
        throw new Error('unreadable process start time');
      }
      return parsed;
    }
    throw new Error('unsupported platform');
  }

  async function currentUserId(): Promise<string> {
    if (cachedUser !== undefined) {
      return cachedUser;
    }
    if (platform === 'win32') {
      const sid = (await runPowerShell(POWERSHELL_USER_SCRIPT, {}, runner)).trim();
      if (!/^S-1-[0-9-]+$/.test(sid)) {
        throw new Error('unreadable user identity');
      }
      cachedUser = sid;
      return sid;
    }
    const uid = getUid();
    if (uid === undefined) {
      throw new Error('unreadable user identity');
    }
    cachedUser = String(uid);
    return cachedUser;
  }

  return { platform, pid: options.pid ?? process.pid, runner, processStartTime, currentUserId };
}
