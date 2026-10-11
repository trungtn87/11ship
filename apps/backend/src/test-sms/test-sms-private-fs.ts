import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Platform, runPowerShell } from './test-sms-platform';

// Privacy of the discovery state location (M01.22). The state file holds the read token, so the directory and the
// file must belong to the current OS user and be unreadable to everyone else.
//
//  - POSIX: owner = current uid, directory 0700, file 0600, never a symlink; the repo state parent
//    (.11ship-local) must be owned by the user and not group/other-writable.
//  - Windows: there is no chmod. The ACL is set and verified through Windows PowerShell: the directory is
//    PROTECTED (no inherited rules) with ONE Allow rule, FullControl for the current user's SID; files created in it
//    inherit exactly that. Verification fails on any other identity, any Deny rule, or an owner that is neither the
//    current user nor the Administrators group (which is the default owner of files created by an elevated token).
//  - Any platform: the real path of the directory must be the expected one (no symlink / junction / reparse point
//    redirecting the location outside the repository's own state directory).
// A failure is reported with one fixed code and no path.

export const STATE_PARENT_NAME = '.11ship-local';
export const STATE_DIR_NAME = 'test-sms';
export const STATE_FILE_NAME = 'state.json';

export type PrivacyFailure = 'NOT_PRIVATE' | 'UNSUPPORTED';

export class PrivacyError extends Error {
  readonly failure: PrivacyFailure;

  constructor(failure: PrivacyFailure) {
    super(`state location is not private (${failure})`);
    this.name = 'PrivacyError';
    this.failure = failure;
  }
}

const POWERSHELL_PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$p=$env:TSMS_PATH',
  '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$acl=Get-Acl -LiteralPath $p',
  '$acl.SetAccessRuleProtection($true,$false)',
  'foreach($r in @($acl.Access)){[void]$acl.RemoveAccessRule($r)}',
  '$inherit=[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit',
  '$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)',
  '$acl.AddAccessRule($rule)',
  'Set-Acl -LiteralPath $p -AclObject $acl',
  "'OK'",
].join(';');

const POWERSHELL_VERIFY_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  '$p=$env:TSMS_PATH',
  "$needProtected=($env:TSMS_PROTECTED -eq '1')",
  '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$acl=Get-Acl -LiteralPath $p',
  '$rules=@($acl.Access)',
  '$ok=($rules.Count -ge 1)',
  'foreach($r in $rules){$s=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($r.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $s -ne $me){$ok=$false}}',
  'if($needProtected -and -not $acl.AreAccessRulesProtected){$ok=$false}',
  '$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value',
  "if($owner -ne $me -and $owner -ne 'S-1-5-32-544'){$ok=$false}",
  "if($ok){'PRIVATE'}else{'NOT_PRIVATE'}",
].join(';');

function samePath(platform: NodeJS.Platform, left: string, right: string): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export interface StateLocation {
  /** realpath of the repository root. */
  readonly repoRoot: string;
  readonly parentDir: string;
  readonly dir: string;
  readonly file: string;
}

export function locateState(repoRealPath: string): StateLocation {
  const parentDir = path.join(repoRealPath, STATE_PARENT_NAME);
  const dir = path.join(parentDir, STATE_DIR_NAME);
  return { repoRoot: repoRealPath, parentDir, dir, file: path.join(dir, STATE_FILE_NAME) };
}

async function verifyWindowsAcl(platform: Platform, target: string, protectedRules: boolean): Promise<void> {
  let answer: string;
  try {
    answer = await runPowerShell(
      POWERSHELL_VERIFY_SCRIPT,
      { TSMS_PATH: target, TSMS_PROTECTED: protectedRules ? '1' : '0' },
      platform.runner,
    );
  } catch {
    throw new PrivacyError('NOT_PRIVATE');
  }
  if (answer.trim() !== 'PRIVATE') {
    throw new PrivacyError('NOT_PRIVATE');
  }
}

async function verifyDirectoryIdentity(platform: Platform, location: StateLocation): Promise<void> {
  for (const candidate of [location.parentDir, location.dir]) {
    let stat;
    try {
      stat = await lstat(candidate);
    } catch {
      throw new PrivacyError('NOT_PRIVATE');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PrivacyError('NOT_PRIVATE');
    }
  }
  let real: string;
  try {
    real = await realpath(location.dir);
  } catch {
    throw new PrivacyError('NOT_PRIVATE');
  }
  if (!samePath(platform.platform, real, location.dir)) {
    throw new PrivacyError('NOT_PRIVATE');
  }
}

/** Verifies the state directory (and its parent) are the user's own and private. Never creates or repairs anything. */
export async function verifyStateDir(platform: Platform, location: StateLocation): Promise<void> {
  await verifyDirectoryIdentity(platform, location);
  if (platform.platform === 'win32') {
    await verifyWindowsAcl(platform, location.dir, true);
    return;
  }
  if (platform.platform !== 'linux' && platform.platform !== 'darwin') {
    throw new PrivacyError('UNSUPPORTED');
  }
  const uid = String(process.getuid?.());
  const parent = await lstat(location.parentDir);
  if (String(parent.uid) !== uid || (parent.mode & 0o022) !== 0) {
    throw new PrivacyError('NOT_PRIVATE');
  }
  const dir = await lstat(location.dir);
  if (String(dir.uid) !== uid || (dir.mode & 0o077) !== 0) {
    throw new PrivacyError('NOT_PRIVATE');
  }
}

/** Verifies the state file: a regular file (never a link) that only the current user can read. */
export async function verifyStateFile(platform: Platform, location: StateLocation): Promise<void> {
  let stat;
  try {
    stat = await lstat(location.file);
  } catch {
    throw new PrivacyError('NOT_PRIVATE');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PrivacyError('NOT_PRIVATE');
  }
  if (platform.platform === 'win32') {
    await verifyWindowsAcl(platform, location.file, false);
    return;
  }
  if (platform.platform !== 'linux' && platform.platform !== 'darwin') {
    throw new PrivacyError('UNSUPPORTED');
  }
  if (String(stat.uid) !== String(process.getuid?.()) || (stat.mode & 0o077) !== 0) {
    throw new PrivacyError('NOT_PRIVATE');
  }
}

async function ensureDirectory(target: string, mode: number | undefined): Promise<'CREATED' | 'EXISTED'> {
  try {
    await mkdir(target, mode === undefined ? undefined : { mode });
    return 'CREATED';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'EXISTED';
    }
    throw error;
  }
}

/**
 * Creates `<repo>/.11ship-local/test-sms` when missing and makes a directory that WE created private (POSIX 0700 /
 * Windows protected ACL); an existing directory is never repaired in place, only verified. Fails closed.
 */
export async function ensureStateDir(platform: Platform, location: StateLocation): Promise<void> {
  if (platform.platform !== 'win32' && platform.platform !== 'linux' && platform.platform !== 'darwin') {
    throw new PrivacyError('UNSUPPORTED');
  }
  const parentState = await ensureDirectory(location.parentDir, undefined);
  if (parentState === 'CREATED' && platform.platform !== 'win32') {
    // Created by us: keep it out of group/other write whatever the umask was.
    await chmod(location.parentDir, 0o755);
  }
  const dirState = await ensureDirectory(location.dir, platform.platform === 'win32' ? undefined : 0o700);
  if (dirState === 'CREATED') {
    if (platform.platform === 'win32') {
      let answer: string;
      try {
        answer = await runPowerShell(POWERSHELL_PROTECT_SCRIPT, { TSMS_PATH: location.dir }, platform.runner);
      } catch {
        throw new PrivacyError('NOT_PRIVATE');
      }
      if (answer.trim() !== 'OK') {
        throw new PrivacyError('NOT_PRIVATE');
      }
    } else {
      // mkdir's mode is masked by the umask, never widened; make the result exact.
      await chmod(location.dir, 0o700);
    }
  }
  await verifyStateDir(platform, location);
}
