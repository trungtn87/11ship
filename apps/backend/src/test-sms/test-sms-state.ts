import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Platform } from './test-sms-platform';
import {
  PrivacyError,
  StateLocation,
  ensureStateDir,
  locateState,
  verifyStateDir,
  verifyStateFile,
} from './test-sms-private-fs';
import { TEST_SMS_LOOPBACK_HOST, TEST_SMS_PROTOCOL_VERSION } from './test-sms-types';

// The discovery state file of the test SMS inbox (M01.22): where the operator tool finds the private listener.
//
//   <repo>/.11ship-local/test-sms/state.json     (not tracked by Git; private to the current OS user)
//
// It holds the loopback port, the read token and the identity of the backend instance that published it: PID and
// start time, repository identity, OS user, protocol version. It is published atomically only after the listener is
// ready. Cleanup removes only the state of the SAME instance (id + PID + start time match), so an old process can
// never delete the state of a newer backend, and nothing here kills or signals any process.

export type StateFailure =
  | 'REPO_UNRESOLVED'
  | 'NOT_PRIVATE'
  | 'UNSUPPORTED'
  | 'MISSING'
  | 'MALFORMED'
  | 'FOREIGN_REPO'
  | 'FOREIGN_USER'
  | 'STALE'
  | 'IN_USE'
  | 'WRITE_FAILED';

export class StateError extends Error {
  readonly failure: StateFailure;

  constructor(failure: StateFailure) {
    super(`discovery state problem (${failure})`);
    this.name = 'StateError';
    this.failure = failure;
  }
}

const MAX_STATE_BYTES = 4096;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const IDENTITY_SHAPE = /^[0-9a-f]{64}$/;
const INSTANCE_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface DiscoveryState {
  readonly instanceId: string;
  readonly port: number;
  readonly token: string;
  readonly backendPid: number;
  readonly backendStartedAtMs: number;
  readonly repoIdentity: string;
  readonly userId: string;
  readonly createdAtMs: number;
}

/** Repository identity: sha256 of the real path of the repository root (lower-cased on Windows). */
export function repoIdentityOf(platform: NodeJS.Platform, repoRealPath: string): string {
  const normalized = platform === 'win32' ? repoRealPath.toLowerCase() : repoRealPath;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export interface ResolvedRepo {
  readonly location: StateLocation;
  readonly identity: string;
}

/** The repository root must contain a package.json named "11ship": nothing else is accepted as "the repo". */
export async function resolveRepo(platform: Platform, repoRoot: string): Promise<ResolvedRepo> {
  let real: string;
  try {
    real = await realpath(repoRoot);
    const manifest = JSON.parse(await readFile(path.join(real, 'package.json'), 'utf8')) as { name?: unknown };
    if (manifest.name !== '11ship') {
      throw new Error('not the 11ship repository');
    }
  } catch {
    throw new StateError('REPO_UNRESOLVED');
  }
  return { location: locateState(real), identity: repoIdentityOf(platform.platform, real) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

/** Strict parser: exact keys, exact types and grammars. Anything else is MALFORMED (never partially trusted). */
export function parseStateFile(text: string): DiscoveryState | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlainObject(raw) || !hasExactKeys(raw, ['protocol_version', 'instance_id', 'host', 'port', 'token', 'backend', 'repo', 'user', 'created_at'])) {
    return undefined;
  }
  const { backend, repo, user } = raw;
  if (
    !isPlainObject(backend) || !hasExactKeys(backend, ['pid', 'started_at']) ||
    !isPlainObject(repo) || !hasExactKeys(repo, ['identity']) ||
    !isPlainObject(user) || !hasExactKeys(user, ['id'])
  ) {
    return undefined;
  }
  const startedAtMs = typeof backend.started_at === 'string' ? Date.parse(backend.started_at) : Number.NaN;
  const createdAtMs = typeof raw.created_at === 'string' ? Date.parse(raw.created_at) : Number.NaN;
  if (
    raw.protocol_version !== TEST_SMS_PROTOCOL_VERSION ||
    typeof raw.instance_id !== 'string' || !INSTANCE_SHAPE.test(raw.instance_id) ||
    raw.host !== TEST_SMS_LOOPBACK_HOST ||
    typeof raw.port !== 'number' || !Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535 ||
    typeof raw.token !== 'string' || !TOKEN_SHAPE.test(raw.token) ||
    typeof backend.pid !== 'number' || !Number.isSafeInteger(backend.pid) || backend.pid <= 0 ||
    !Number.isFinite(startedAtMs) ||
    typeof repo.identity !== 'string' || !IDENTITY_SHAPE.test(repo.identity) ||
    typeof user.id !== 'string' || user.id.length === 0 || user.id.length > 128 ||
    !Number.isFinite(createdAtMs)
  ) {
    return undefined;
  }
  return {
    instanceId: raw.instance_id,
    port: raw.port,
    token: raw.token,
    backendPid: backend.pid,
    backendStartedAtMs: startedAtMs,
    repoIdentity: repo.identity,
    userId: user.id,
    createdAtMs,
  };
}

export function serializeState(state: DiscoveryState): string {
  return `${JSON.stringify({
    protocol_version: TEST_SMS_PROTOCOL_VERSION,
    instance_id: state.instanceId,
    host: TEST_SMS_LOOPBACK_HOST,
    port: state.port,
    token: state.token,
    backend: { pid: state.backendPid, started_at: new Date(state.backendStartedAtMs).toISOString() },
    repo: { identity: state.repoIdentity },
    user: { id: state.userId },
    created_at: new Date(state.createdAtMs).toISOString(),
  })}\n`;
}

function mapPrivacy(error: unknown): StateError {
  if (error instanceof PrivacyError) {
    return new StateError(error.failure === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'NOT_PRIVATE');
  }
  return new StateError('NOT_PRIVATE');
}

/** Opens the state file without following a link and reads at most MAX_STATE_BYTES. Same file as the lstat just done. */
async function readStateText(location: StateLocation): Promise<string> {
  const before = await lstat(location.file);
  const handle = await open(location.file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || (before.ino !== 0 && after.ino !== 0 && (before.ino !== after.ino || before.dev !== after.dev))) {
      throw new StateError('NOT_PRIVATE');
    }
    if (after.size > MAX_STATE_BYTES) {
      throw new StateError('MALFORMED');
    }
    const buffer = Buffer.alloc(Math.min(after.size, MAX_STATE_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function fileExists(location: StateLocation): Promise<boolean> {
  try {
    await lstat(location.file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw new StateError('NOT_PRIVATE');
  }
}

/**
 * Backend side, before the listener opens: creates/verifies the private directory and checks what is already there.
 * A live OTHER backend instance of this repository owns the state: refuse (never overwrite it). A stale or malformed
 * file is left to be replaced by the atomic publish. A file that is not private (or a link) is never touched.
 */
export async function prepareStateForStart(platform: Platform, repo: ResolvedRepo): Promise<void> {
  try {
    await ensureStateDir(platform, repo.location);
  } catch (error) {
    throw mapPrivacy(error);
  }
  if (!(await fileExists(repo.location))) {
    return;
  }
  try {
    await verifyStateFile(platform, repo.location);
  } catch (error) {
    throw mapPrivacy(error);
  }
  let existing: DiscoveryState | undefined;
  try {
    existing = parseStateFile(await readStateText(repo.location));
  } catch (error) {
    if (error instanceof StateError && error.failure === 'MALFORMED') {
      return;
    }
    throw error instanceof StateError ? error : new StateError('NOT_PRIVATE');
  }
  if (existing === undefined || existing.backendPid === platform.pid) {
    return;
  }
  let startedAt: number | undefined;
  try {
    startedAt = await platform.processStartTime(existing.backendPid);
  } catch {
    // Cannot tell: do not overwrite what might be a live instance.
    throw new StateError('IN_USE');
  }
  if (startedAt !== undefined && startedAt === existing.backendStartedAtMs) {
    throw new StateError('IN_USE');
  }
}

export interface PublishedState {
  readonly instanceId: string;
  readonly backendPid: number;
  readonly backendStartedAtMs: number;
}

/** Publishes the state atomically (temp file in the same private directory, fsync, rename). Call after the listener is ready. */
export async function publishState(
  platform: Platform,
  repo: ResolvedRepo,
  input: { readonly port: number; readonly token: string },
): Promise<PublishedState> {
  const pid = platform.pid;
  const startedAt = await platform.processStartTime(pid);
  if (startedAt === undefined) {
    throw new StateError('WRITE_FAILED');
  }
  const state: DiscoveryState = {
    instanceId: randomUUID(),
    port: input.port,
    token: input.token,
    backendPid: pid,
    backendStartedAtMs: startedAt,
    repoIdentity: repo.identity,
    userId: await platform.currentUserId(),
    createdAtMs: Date.now(),
  };
  const temp = path.join(repo.location.dir, `state.json.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    try {
      await handle.writeFile(serializeState(state), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, repo.location.file);
  } catch {
    await unlink(temp).catch(() => undefined);
    throw new StateError('WRITE_FAILED');
  }
  try {
    await verifyStateFile(platform, repo.location);
  } catch (error) {
    await unlink(repo.location.file).catch(() => undefined);
    throw mapPrivacy(error);
  }
  return { instanceId: state.instanceId, backendPid: pid, backendStartedAtMs: startedAt };
}

/** Removes the state file only when it still belongs to this exact instance. Returns whether it removed it. */
export async function removeOwnState(platform: Platform, repo: ResolvedRepo, own: PublishedState): Promise<boolean> {
  try {
    await verifyStateFile(platform, repo.location);
    const current = parseStateFile(await readStateText(repo.location));
    if (
      current === undefined ||
      current.instanceId !== own.instanceId ||
      current.backendPid !== own.backendPid ||
      current.backendStartedAtMs !== own.backendStartedAtMs
    ) {
      return false;
    }
    await unlink(repo.location.file);
    return true;
  } catch {
    return false;
  }
}

export interface VerifiedState {
  readonly instanceId: string;
  readonly host: typeof TEST_SMS_LOOPBACK_HOST;
  readonly port: number;
  readonly token: string;
}

/**
 * Operator tool side. Returns the connection data ONLY after the whole ownership chain checked out: private location,
 * strict content, this repository, this OS user, and a live backend process whose start time equals the recorded one.
 * Stale, malformed, foreign or unowned state is never used to connect and the token is never sent anywhere before.
 */
export async function readVerifiedState(platform: Platform, repo: ResolvedRepo): Promise<VerifiedState> {
  try {
    await verifyStateDir(platform, repo.location);
  } catch (error) {
    if (error instanceof PrivacyError && error.failure === 'NOT_PRIVATE' && !(await pathExists(repo.location.dir))) {
      throw new StateError('MISSING');
    }
    throw mapPrivacy(error);
  }
  if (!(await fileExists(repo.location))) {
    throw new StateError('MISSING');
  }
  try {
    await verifyStateFile(platform, repo.location);
  } catch (error) {
    throw mapPrivacy(error);
  }
  let parsed: DiscoveryState | undefined;
  try {
    parsed = parseStateFile(await readStateText(repo.location));
  } catch (error) {
    throw error instanceof StateError ? error : new StateError('NOT_PRIVATE');
  }
  if (parsed === undefined) {
    throw new StateError('MALFORMED');
  }
  if (parsed.repoIdentity !== repo.identity) {
    throw new StateError('FOREIGN_REPO');
  }
  if (parsed.userId !== (await platform.currentUserId())) {
    throw new StateError('FOREIGN_USER');
  }
  let startedAt: number | undefined;
  try {
    startedAt = await platform.processStartTime(parsed.backendPid);
  } catch {
    throw new StateError('STALE');
  }
  if (startedAt === undefined || startedAt !== parsed.backendStartedAtMs) {
    throw new StateError('STALE');
  }
  return { instanceId: parsed.instanceId, host: TEST_SMS_LOOPBACK_HOST, port: parsed.port, token: parsed.token };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}
