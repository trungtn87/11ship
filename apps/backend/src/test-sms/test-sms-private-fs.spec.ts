import { chmod, link, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { CommandRunner, createPlatform } from './test-sms-platform';
import { PrivacyError, ensureStateDir, locateState, verifyStateDir, verifyStateFile } from './test-sms-private-fs';

// TS07/TS09 (private state): POSIX owner and modes, symlink refusal and the Windows ACL path (driven by a fake
// PowerShell runner here; the real Windows ACL is exercised by the windows-2022 CI job and the Owner runbook).

const posix = process.platform === 'linux' || process.platform === 'darwin';
const created: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-fs-')));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length > 0) {
    await rm(created.pop() as string, { recursive: true, force: true });
  }
});

async function expectNotPrivate(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow(PrivacyError);
}

describe('state directory privacy on POSIX', () => {
  it('creates .11ship-local/test-sms private (0700) and accepts it', async () => {
    if (!posix) {
      return;
    }
    const location = locateState(await tempRepo());
    const platform = createPlatform();
    await ensureStateDir(platform, location);
    expect((await lstat(location.dir)).mode & 0o777).toBe(0o700);
    expect((await lstat(location.parentDir)).mode & 0o022).toBe(0);
    await verifyStateDir(platform, location);
  });

  it('never repairs an existing directory in place: a wider mode is refused', async () => {
    if (!posix) {
      return;
    }
    const location = locateState(await tempRepo());
    await mkdir(location.dir, { recursive: true });
    await chmod(location.dir, 0o755);
    await expectNotPrivate(ensureStateDir(createPlatform(), location));
    expect((await lstat(location.dir)).mode & 0o777).toBe(0o755);
  });

  it('refuses a group/other-writable parent (it could swap the private directory)', async () => {
    if (!posix) {
      return;
    }
    const location = locateState(await tempRepo());
    await ensureStateDir(createPlatform(), location);
    await chmod(location.parentDir, 0o777);
    await expectNotPrivate(verifyStateDir(createPlatform(), location));
  });

  it('refuses a symlink in place of the state directory, even when it points to a private directory', async () => {
    if (!posix) {
      return;
    }
    const repo = await tempRepo();
    const location = locateState(repo);
    const elsewhere = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-elsewhere-')));
    created.push(elsewhere);
    await chmod(elsewhere, 0o700);
    await mkdir(location.parentDir, { recursive: true });
    await symlink(elsewhere, location.dir);
    await expectNotPrivate(ensureStateDir(createPlatform(), location));
    await expectNotPrivate(verifyStateDir(createPlatform(), location));
  });

  it('refuses a symlink in place of the parent directory', async () => {
    if (!posix) {
      return;
    }
    const repo = await tempRepo();
    const location = locateState(repo);
    const elsewhere = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-elsewhere-')));
    created.push(elsewhere);
    await mkdir(path.join(elsewhere, 'test-sms'), { mode: 0o700 });
    await symlink(elsewhere, location.parentDir);
    await expectNotPrivate(verifyStateDir(createPlatform(), location));
  });
});

describe('state file privacy on POSIX', () => {
  async function withDir(): Promise<ReturnType<typeof locateState>> {
    const location = locateState(await tempRepo());
    await ensureStateDir(createPlatform(), location);
    return location;
  }

  it('accepts a regular 0600 file owned by the current user', async () => {
    if (!posix) {
      return;
    }
    const location = await withDir();
    await writeFile(location.file, '{}', { mode: 0o600 });
    await verifyStateFile(createPlatform(), location);
  });

  it('refuses a file readable by group or others', async () => {
    if (!posix) {
      return;
    }
    const location = await withDir();
    await writeFile(location.file, '{}', { mode: 0o600 });
    for (const mode of [0o640, 0o644, 0o604, 0o660, 0o666]) {
      await chmod(location.file, mode);
      await expectNotPrivate(verifyStateFile(createPlatform(), location));
    }
  });

  it('refuses a symlink and a hard-linked file', async () => {
    if (!posix) {
      return;
    }
    const location = await withDir();
    const real = path.join(location.dir, 'real.json');
    await writeFile(real, '{}', { mode: 0o600 });
    await symlink(real, location.file);
    await expectNotPrivate(verifyStateFile(createPlatform(), location));
    await rm(location.file);
    await link(real, location.file);
    await expectNotPrivate(verifyStateFile(createPlatform(), location));
  });

  it('refuses a missing file', async () => {
    if (!posix) {
      return;
    }
    await expectNotPrivate(verifyStateFile(createPlatform(), await withDir()));
  });
});

describe('Windows ACL path (driven by a fake PowerShell runner)', () => {
  function windowsPlatform(answers: { protect?: string; verify?: string; failWith?: Error }): {
    platform: ReturnType<typeof createPlatform>;
    calls: { script: string; env: Readonly<Record<string, string>> | undefined }[];
  } {
    const calls: { script: string; env: Readonly<Record<string, string>> | undefined }[] = [];
    const runner: CommandRunner = (_file, args, env) => {
      const script = Buffer.from(args[5] ?? '', 'base64').toString('utf16le');
      calls.push({ script, env });
      if (answers.failWith !== undefined) {
        return Promise.reject(answers.failWith);
      }
      return Promise.resolve(script.includes('Set-Acl') ? (answers.protect ?? 'OK') : (answers.verify ?? 'PRIVATE'));
    };
    return { platform: createPlatform({ platform: 'win32', runner }), calls };
  }

  it('protects a newly created directory (single Allow rule for the current SID, no inherited rules) and verifies it', async () => {
    const location = locateState(await tempRepo());
    const { platform, calls } = windowsPlatform({});
    await ensureStateDir(platform, location);
    expect(calls).toHaveLength(2);
    const protect = calls[0];
    expect(protect?.env).toEqual({ TSMS_PATH: location.dir });
    expect(protect?.script).toContain('SetAccessRuleProtection($true,$false)');
    expect(protect?.script).toContain('WindowsIdentity]::GetCurrent().User');
    expect(protect?.script).toContain('FullControl');
    expect(protect?.script).toContain('AccessControlType]::Allow');
    expect(protect?.script).not.toContain(location.dir);
    const verify = calls[1];
    expect(verify?.env).toEqual({ TSMS_PATH: location.dir, TSMS_PROTECTED: '1' });
    expect(verify?.script).toContain('AreAccessRulesProtected');
    expect(verify?.script).toContain("S-1-5-32-544");
  });

  it('does not touch an existing directory ACL: it only verifies it', async () => {
    const location = locateState(await tempRepo());
    await mkdir(location.dir, { recursive: true });
    const { platform, calls } = windowsPlatform({});
    await ensureStateDir(platform, location);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.script).not.toContain('Set-Acl');
  });

  it('fails closed when the ACL is not private, when PowerShell fails, or when protecting fails', async () => {
    const location = locateState(await tempRepo());
    await expectNotPrivate(ensureStateDir(windowsPlatform({ verify: 'NOT_PRIVATE' }).platform, location));
    const second = locateState(await tempRepo());
    await expectNotPrivate(ensureStateDir(windowsPlatform({ failWith: new Error('powershell missing') }).platform, second));
    const third = locateState(await tempRepo());
    await expectNotPrivate(ensureStateDir(windowsPlatform({ protect: 'DENIED' }).platform, third));
  });

  it('verifies the file with unprotected (inherited) rules allowed', async () => {
    const location = locateState(await tempRepo());
    await mkdir(location.dir, { recursive: true });
    await writeFile(location.file, '{}');
    const { platform, calls } = windowsPlatform({});
    await verifyStateFile(platform, location);
    expect(calls[0]?.env).toEqual({ TSMS_PATH: location.file, TSMS_PROTECTED: '0' });
    await expectNotPrivate(verifyStateFile(windowsPlatform({ verify: 'NOT_PRIVATE' }).platform, location));
  });

  it('an unsupported platform is refused', async () => {
    const location = locateState(await tempRepo());
    await expect(ensureStateDir(createPlatform({ platform: 'freebsd' }), location)).rejects.toThrow(PrivacyError);
  });
});
