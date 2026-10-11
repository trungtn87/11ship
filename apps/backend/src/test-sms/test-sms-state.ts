import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
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
  | 'WRITE_FAILED'
  | 'LOST_OWNERSHIP';

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


// ===== Cross-process ownership (F1) ==========================================================================================
//
// Only ONE backend instance of a repository may own the discovery state at a time, and ownership covers the whole
// lifetime: claim -> publish -> cleanup. A "check, then rename" is not enough (two starters both pass the check), so
// ownership is an append-only chain of generation files in the private directory:
//
//   owner.<n>.lock   created ATOMICALLY and COMPLETE (written to a temp file, then link()ed to its final name: link fails
//                    with EEXIST when the name exists, so exactly one racer creates generation n, and a reader never sees
//                    a half-written file). Nothing ever overwrites or deletes the highest generation of someone else.
//
// The owner is the holder of the HIGHEST generation, if its record is live (PID + start time still match) and not released.
// To take over (nothing, released, malformed or stale-by-PID/start-time) a starter creates generation highest+1; if two
// starters race for it, link() lets one win and the other re-evaluates and sees a live owner -> refused (IN_USE). Release
// is a "released" tombstone at generation n+1 (never an empty directory, so a late racer cannot re-create a lower number).
// Every mutation of state.json (publish, remove) re-checks that this instance still holds the highest generation. A loser
// never holds a claim, so it can neither publish nor remove anything of the winner. Fail closed: if liveness cannot be
// determined the owner is assumed live.

const LOCK_NAME = /^owner\.([0-9]{1,12})\.lock$/;
const MAX_LOCK_BYTES = 1024;
const MAX_CLAIM_ATTEMPTS = 6;

/** Test seams: deterministic barriers at the exact points where processes can interleave. Never set by main.ts. */
export interface StateHooks {
  /** After the owner of generation n was judged absent/stale/released, immediately before generation n+1 is created. */
  beforeClaimCreate?(): Promise<void>;
  /** After the new state was written to its temp file, immediately before it is renamed into place. */
  beforePublishRename?(): Promise<void>;
  /** Immediately before cleanup removes state.json. */
  beforeRemoveState?(): Promise<void>;
  /** After cleanup, immediately before the released tombstone is written. */
  beforeRelease?(): Promise<void>;
}

export interface OwnerClaim {
  readonly instanceId: string;
  readonly generation: number;
  readonly backendPid: number;
  readonly backendStartedAtMs: number;
}

interface LockRecord {
  readonly instanceId: string;
  readonly pid: number;
  readonly startedAtMs: number;
  readonly released: boolean;
}

function lockFileName(generation: number): string {
  return `owner.${generation}.lock`;
}

function serializeLock(record: LockRecord): string {
  return `${JSON.stringify({
    protocol_version: TEST_SMS_PROTOCOL_VERSION,
    instance_id: record.instanceId,
    pid: record.pid,
    started_at: new Date(record.startedAtMs).toISOString(),
    released: record.released,
  })}\n`;
}

/** Strict parse; undefined = malformed (treated as a broken, hence stale, claim: it can never be a live owner). */
function parseLock(text: string): LockRecord | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlainObject(raw) || !hasExactKeys(raw, ['protocol_version', 'instance_id', 'pid', 'started_at', 'released'])) {
    return undefined;
  }
  const startedAtMs = typeof raw.started_at === 'string' ? Date.parse(raw.started_at) : Number.NaN;
  if (
    raw.protocol_version !== TEST_SMS_PROTOCOL_VERSION ||
    typeof raw.instance_id !== 'string' || !INSTANCE_SHAPE.test(raw.instance_id) ||
    typeof raw.pid !== 'number' || !Number.isSafeInteger(raw.pid) || raw.pid <= 0 ||
    !Number.isFinite(startedAtMs) ||
    typeof raw.released !== 'boolean'
  ) {
    return undefined;
  }
  return { instanceId: raw.instance_id, pid: raw.pid, startedAtMs, released: raw.released };
}

async function listGenerations(location: StateLocation): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(location.dir);
  } catch {
    throw new StateError('NOT_PRIVATE');
  }
  const generations: number[] = [];
  for (const name of names) {
    const match = LOCK_NAME.exec(name);
    if (match !== null) {
      generations.push(Number(match[1]));
    }
  }
  return generations.sort((a, b) => b - a);
}

/** Reads one generation. 'GONE' = no such file; undefined = malformed/oversized. A link or non-file is refused. */
async function readLock(location: StateLocation, generation: number): Promise<LockRecord | undefined | 'GONE'> {
  const file = path.join(location.dir, lockFileName(generation));
  try {
    const before = await lstat(file);
    if (!before.isFile()) {
      throw new StateError('NOT_PRIVATE');
    }
    if (before.size > MAX_LOCK_BYTES) {
      return undefined;
    }
    const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(Math.min(before.size, MAX_LOCK_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return parseLock(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof StateError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'GONE';
    }
    throw new StateError('NOT_PRIVATE');
  }
}

/** Atomically creates generation `generation` with COMPLETE content. false = somebody else created it first. */
async function createLock(location: StateLocation, generation: number, record: LockRecord): Promise<boolean> {
  const temp = path.join(location.dir, `owner.${generation}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
    try {
      await handle.writeFile(serializeLock(record), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temp, path.join(location.dir, lockFileName(generation)));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw new StateError('WRITE_FAILED');
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

async function pruneBelow(location: StateLocation, generation: number): Promise<void> {
  for (const known of await listGenerations(location).catch(() => [] as number[])) {
    if (known < generation) {
      await unlink(path.join(location.dir, lockFileName(known))).catch(() => undefined);
    }
  }
}

/** True when the record names a process that is (or might be) alive with the recorded start time. Unknowable = alive. */
async function ownerIsLive(platform: Platform, record: LockRecord): Promise<boolean> {
  let startedAt: number | undefined;
  try {
    startedAt = await platform.processStartTime(record.pid);
  } catch {
    return true;
  }
  return startedAt !== undefined && startedAt === record.startedAtMs;
}

/** Throws unless this claim still holds the highest generation (and it is not released). */
async function assertStillOwner(repo: ResolvedRepo, claim: OwnerClaim): Promise<void> {
  const generations = await listGenerations(repo.location);
  if (generations[0] !== claim.generation) {
    throw new StateError('LOST_OWNERSHIP');
  }
  const record = await readLock(repo.location, claim.generation);
  if (record === 'GONE' || record === undefined || record.released || record.instanceId !== claim.instanceId) {
    throw new StateError('LOST_OWNERSHIP');
  }
}

/**
 * Backend side, before the listener opens: creates/verifies the private directory and CLAIMS ownership of the state
 * (see the chain above). Refuses with IN_USE while another live instance of this repository owns it, whatever the
 * interleaving. A state file that is not private (or a link) is never touched: the claim is released and it is refused.
 */
export async function claimOwnership(platform: Platform, repo: ResolvedRepo, hooks: StateHooks = {}): Promise<OwnerClaim> {
  try {
    await ensureStateDir(platform, repo.location);
  } catch (error) {
    throw mapPrivacy(error);
  }
  const startedAtMs = await platform.processStartTime(platform.pid);
  if (startedAtMs === undefined) {
    throw new StateError('WRITE_FAILED');
  }
  const instanceId = randomUUID();
  const record: LockRecord = { instanceId, pid: platform.pid, startedAtMs, released: false };

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const generations = await listGenerations(repo.location);
    const highest = generations[0] ?? 0;
    if (highest > 0) {
      const current = await readLock(repo.location, highest);
      if (current !== 'GONE' && current !== undefined && !current.released && (await ownerIsLive(platform, current))) {
        throw new StateError('IN_USE');
      }
    }
    await hooks.beforeClaimCreate?.();
    if (!(await createLock(repo.location, highest + 1, record))) {
      continue; // somebody else created generation highest+1 first: look again (a live owner now -> IN_USE)
    }
    const claim: OwnerClaim = { instanceId, generation: highest + 1, backendPid: platform.pid, backendStartedAtMs: startedAtMs };
    await pruneBelow(repo.location, claim.generation);
    try {
      if (await fileExists(repo.location)) {
        await verifyStateFile(platform, repo.location);
      }
    } catch (error) {
      await releaseOwnership(platform, repo, claim);
      throw error instanceof StateError ? error : mapPrivacy(error);
    }
    return claim;
  }
  throw new StateError('IN_USE');
}

/** Publishes the state atomically (temp file, fsync, rename) while holding the claim. Call after the listener is ready. */
export async function publishState(
  platform: Platform,
  repo: ResolvedRepo,
  claim: OwnerClaim,
  input: { readonly port: number; readonly token: string },
  hooks: StateHooks = {},
): Promise<void> {
  await assertStillOwner(repo, claim);
  const state: DiscoveryState = {
    instanceId: claim.instanceId,
    port: input.port,
    token: input.token,
    backendPid: claim.backendPid,
    backendStartedAtMs: claim.backendStartedAtMs,
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
    await hooks.beforePublishRename?.();
    await assertStillOwner(repo, claim);
    await rename(temp, repo.location.file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error instanceof StateError ? error : new StateError('WRITE_FAILED');
  }
  try {
    await verifyStateFile(platform, repo.location);
  } catch (error) {
    await removeOwnState(platform, repo, claim);
    throw mapPrivacy(error);
  }
}

/** Removes state.json only while this claim still owns it AND the file carries this instance id. Returns whether it did. */
export async function removeOwnState(platform: Platform, repo: ResolvedRepo, claim: OwnerClaim, hooks: StateHooks = {}): Promise<boolean> {
  try {
    await hooks.beforeRemoveState?.();
    await assertStillOwner(repo, claim);
    await verifyStateFile(platform, repo.location);
    const current = parseStateFile(await readStateText(repo.location));
    if (
      current === undefined ||
      current.instanceId !== claim.instanceId ||
      current.backendPid !== claim.backendPid ||
      current.backendStartedAtMs !== claim.backendStartedAtMs
    ) {
      return false;
    }
    await unlink(repo.location.file);
    return true;
  } catch {
    return false;
  }
}

/** Gives ownership up: a "released" tombstone at generation+1 (EEXIST = somebody already took over: nothing to do). */
export async function releaseOwnership(_platform: Platform, repo: ResolvedRepo, claim: OwnerClaim, hooks: StateHooks = {}): Promise<void> {
  try {
    await hooks.beforeRelease?.();
    const tombstone: LockRecord = { instanceId: claim.instanceId, pid: claim.backendPid, startedAtMs: claim.backendStartedAtMs, released: true };
    if (await createLock(repo.location, claim.generation + 1, tombstone)) {
      await unlink(path.join(repo.location.dir, lockFileName(claim.generation))).catch(() => undefined);
    }
  } catch {
    // Best effort: if the tombstone cannot be written the claim simply goes stale when this process exits.
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
