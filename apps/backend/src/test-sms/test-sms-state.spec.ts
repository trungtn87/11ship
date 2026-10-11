import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { Platform, createPlatform } from './test-sms-platform';
import {
  DiscoveryState,
  ResolvedRepo,
  StateError,
  StateFailure,
  OwnerClaim,
  claimOwnership,
  parseStateFile,
  publishState,
  readVerifiedState,
  releaseOwnership,
  removeOwnState,
  repoIdentityOf,
  resolveRepo,
  serializeState,
} from './test-sms-state';

// TS07/TS09 (discovery state): strict parsing, ownership by PID + start time, repository and user binding,
// stale/foreign/malformed/unsafe state, and "remove only my own state". Uses real files in temp directories and a
// fake process table so that "live", "dead" and "PID reuse" are deterministic.

const posix = process.platform === 'linux' || process.platform === 'darwin';
const created: string[] = [];
const TOKEN = 'A'.repeat(43);

afterEach(async () => {
  while (created.length > 0) {
    await rm(created.pop() as string, { recursive: true, force: true });
  }
});

async function tempRepo(name = '11ship'): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-state-')));
  created.push(dir);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name }));
  return dir;
}

/** A platform with a fake process table: pid -> start time (ms). Everything else is the real thing. */
function fakePlatform(pid: number, table: Map<number, number>, userId = '1000'): Platform {
  const real = createPlatform();
  return {
    ...real,
    pid,
    processStartTime: (target: number) => Promise.resolve(table.get(target)),
    currentUserId: () => Promise.resolve(userId),
  };
}

async function setup(table: Map<number, number>, pid = 4242, started = 1_790_000_000_000): Promise<{ platform: Platform; repo: ResolvedRepo; root: string }> {
  const root = await tempRepo();
  table.set(pid, started);
  const platform = fakePlatform(pid, table);
  return { platform, repo: await resolveRepo(platform, root), root };
}

function sampleState(overrides: Partial<DiscoveryState> = {}): DiscoveryState {
  return {
    instanceId: '11111111-2222-4333-8444-555555555555',
    port: 40123,
    token: TOKEN,
    backendPid: 4242,
    backendStartedAtMs: 1_790_000_000_000,
    repoIdentity: 'a'.repeat(64),
    userId: '1000',
    createdAtMs: 1_790_000_001_000,
    ...overrides,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<StateFailure | 'NO_ERROR'> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    if (error instanceof StateError) {
      return error.failure;
    }
    throw error;
  }
}

describe('strict state parser', () => {
  it('round-trips a serialized state', () => {
    const state = sampleState();
    expect(parseStateFile(serializeState(state))).toEqual(state);
  });

  it('accepts exactly the documented keys', () => {
    const parsed = JSON.parse(serializeState(sampleState())) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      ['backend', 'created_at', 'host', 'instance_id', 'port', 'protocol_version', 'repo', 'token', 'user'].sort(),
    );
    expect(parsed.host).toBe('127.0.0.1');
  });

  type Mutable = Record<string, unknown> & { backend: Record<string, unknown>; repo: Record<string, unknown>; user: Record<string, unknown> };
  function mutated(mutator: (o: Mutable) => void): string {
    const parsed = JSON.parse(serializeState(sampleState())) as Mutable;
    mutator(parsed);
    return JSON.stringify(parsed);
  }

  it('rejects extra keys, missing keys, wrong types and wrong grammars', () => {
    const bad: string[] = [
      'not json',
      '[]',
      'null',
      '42',
      mutated((o) => { o.extra = 1; }),
      mutated((o) => { delete o.token; }),
      mutated((o) => { o.backend.extra = 1; }),
      mutated((o) => { o.protocol_version = 2; }),
      mutated((o) => { o.host = '0.0.0.0'; }),
      mutated((o) => { o.host = 'localhost'; }),
      mutated((o) => { o.port = 0; }),
      mutated((o) => { o.port = 65536; }),
      mutated((o) => { o.port = 80.5; }),
      mutated((o) => { o.port = '40123'; }),
      mutated((o) => { o.token = 'short'; }),
      mutated((o) => { o.token = `${'A'.repeat(42)}+`; }),
      mutated((o) => { o.instance_id = 'nope'; }),
      mutated((o) => { o.backend.pid = 0; }),
      mutated((o) => { o.backend.pid = -3; }),
      mutated((o) => { o.backend.pid = '4242'; }),
      mutated((o) => { o.backend.started_at = 'yesterday'; }),
      mutated((o) => { o.repo.identity = 'XYZ'; }),
      mutated((o) => { o.user.id = ''; }),
      mutated((o) => { o.created_at = 12345; }),
    ];
    for (const text of bad) {
      expect(parseStateFile(text)).toBeUndefined();
    }
  });
});

describe('repository resolution', () => {
  it('resolves a repository whose package.json is named 11ship, under .11ship-local/test-sms', async () => {
    const platform = createPlatform();
    const root = await tempRepo();
    const repo = await resolveRepo(platform, root);
    expect(repo.location.dir).toBe(path.join(root, '.11ship-local', 'test-sms'));
    expect(repo.location.file).toBe(path.join(root, '.11ship-local', 'test-sms', 'state.json'));
    expect(repo.identity).toBe(repoIdentityOf(platform.platform, root));
    expect(repo.identity).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses another package, a missing package.json and a missing directory', async () => {
    const platform = createPlatform();
    expect(await failureOf(resolveRepo(platform, await tempRepo('other')))).toBe('REPO_UNRESOLVED');
    const empty = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-empty-')));
    created.push(empty);
    expect(await failureOf(resolveRepo(platform, empty))).toBe('REPO_UNRESOLVED');
    expect(await failureOf(resolveRepo(platform, path.join(empty, 'missing')))).toBe('REPO_UNRESOLVED');
  });

  it('identity differs per repository path and is case-folded only on Windows', () => {
    expect(repoIdentityOf('linux', '/a/B')).not.toBe(repoIdentityOf('linux', '/a/b'));
    expect(repoIdentityOf('win32', 'C:\\Repo')).toBe(repoIdentityOf('win32', 'c:\\repo'));
  });
});

/** Claim + publish in one go (the sequence the runtime performs). */
async function own(platform: Platform, repo: ResolvedRepo, port = 40123, token = TOKEN): Promise<OwnerClaim> {
  const claim = await claimOwnership(platform, repo);
  await publishState(platform, repo, claim, { port, token });
  return claim;
}

describe('claim, publish, read and remove', () => {
  it('publishes atomically (private file, no temp leftovers) and the tool reads it back after verification', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    const claim = await own(platform, repo);
    expect(claim.backendPid).toBe(4242);
    expect((await lstat(repo.location.file)).mode & 0o777).toBe(0o600);
    const names = (await readdir(repo.location.dir)).sort();
    expect(names).toEqual(['owner.1.lock', 'state.json']);
    const verified = await readVerifiedState(platform, repo);
    expect(verified).toEqual({ instanceId: claim.instanceId, host: '127.0.0.1', port: 40123, token: TOKEN });
    // The ownership record never carries the token or the port.
    const lock = await readFile(path.join(repo.location.dir, 'owner.1.lock'), 'utf8');
    expect(lock).not.toContain(TOKEN);
    expect(lock).not.toContain('40123');
  });

  it('a restart after a clean stop replaces the state with a new instance id; the old claim cannot remove the new state', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    const oldClaim = await own(first.platform, first.repo, 40001);
    expect(await removeOwnState(first.platform, first.repo, oldClaim)).toBe(true);
    await releaseOwnership(first.platform, first.repo, oldClaim);
    table.set(5151, 1_790_000_100_000);
    const second = fakePlatform(5151, table);
    const newClaim = await own(second, first.repo, 40002, 'B'.repeat(43));
    expect(newClaim.instanceId).not.toBe(oldClaim.instanceId);
    expect(newClaim.generation).toBeGreaterThan(oldClaim.generation);
    expect(await removeOwnState(first.platform, first.repo, oldClaim)).toBe(false);
    expect((await readVerifiedState(second, first.repo)).port).toBe(40002);
    expect(await removeOwnState(second, first.repo, newClaim)).toBe(true);
    expect(await failureOf(readVerifiedState(second, first.repo))).toBe('MISSING');
  });

  it('removes only the state of the same instance, and only while it still owns the chain', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    const claim = await own(platform, repo);
    for (const wrong of [
      { ...claim, instanceId: '99999999-2222-4333-8444-555555555555' },
      { ...claim, backendPid: claim.backendPid + 1 },
      { ...claim, backendStartedAtMs: claim.backendStartedAtMs + 1 },
      { ...claim, generation: claim.generation + 1 },
    ]) {
      expect(await removeOwnState(platform, repo, wrong)).toBe(false);
      expect((await lstat(repo.location.file)).isFile()).toBe(true);
    }
    expect(await removeOwnState(platform, repo, claim)).toBe(true);
    expect(await removeOwnState(platform, repo, claim)).toBe(false);
  });

  it('release writes a tombstone as the highest generation and keeps no lower generation', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    const claim = await own(platform, repo);
    await removeOwnState(platform, repo, claim);
    await releaseOwnership(platform, repo, claim);
    expect(await readdir(repo.location.dir)).toEqual(['owner.2.lock']);
    expect(JSON.parse(await readFile(path.join(repo.location.dir, 'owner.2.lock'), 'utf8')).released).toBe(true);
    // The chain keeps counting up: the next claim is generation 3 and prunes everything below it.
    const next = await claimOwnership(platform, repo);
    expect(next.generation).toBe(3);
    expect(await readdir(repo.location.dir)).toEqual(['owner.3.lock']);
  });

  it('a write failure leaves no state and no temp file', async () => {
    if (!posix || process.getuid?.() === 0) {
      return; // root ignores directory modes
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    const claim = await claimOwnership(platform, repo);
    await chmod(repo.location.dir, 0o500);
    try {
      expect(await failureOf(publishState(platform, repo, claim, { port: 1, token: TOKEN }))).toBe('WRITE_FAILED');
    } finally {
      await chmod(repo.location.dir, 0o700);
    }
    expect(await readdir(repo.location.dir)).toEqual(['owner.1.lock']);
  });

  it('refuses to claim when the own start time is unknowable', async () => {
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    table.delete(4242);
    expect(await failureOf(claimOwnership(platform, repo))).toBe('WRITE_FAILED');
  });

  it('publishing without still owning the chain is refused (LOST_OWNERSHIP) and writes nothing', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    const claim = await claimOwnership(platform, repo);
    await releaseOwnership(platform, repo, claim); // now a tombstone is the highest generation
    expect(await failureOf(publishState(platform, repo, claim, { port: 1, token: TOKEN }))).toBe('LOST_OWNERSHIP');
    expect(await readdir(repo.location.dir)).toEqual(['owner.2.lock']);
  });
});

describe('claimOwnership (backend)', () => {
  it('creates the private directory and accepts an absent state', async () => {
    if (!posix) {
      return;
    }
    const { platform, repo } = await setup(new Map());
    await claimOwnership(platform, repo);
    expect((await lstat(repo.location.dir)).mode & 0o777).toBe(0o700);
  });

  it('refuses (IN_USE) while another LIVE backend instance owns it, and leaves its state untouched', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    await own(first.platform, first.repo, 40001);
    const before = await readFile(first.repo.location.file, 'utf8');
    table.set(5151, 1_790_000_100_000);
    expect(await failureOf(claimOwnership(fakePlatform(5151, table), first.repo))).toBe('IN_USE');
    expect(await readFile(first.repo.location.file, 'utf8')).toBe(before);
    expect(await readdir(first.repo.location.dir)).toEqual(['owner.1.lock', 'state.json']);
  });

  it('the same process cannot claim twice without releasing (no silent second owner)', async () => {
    if (!posix) {
      return;
    }
    const { platform, repo } = await setup(new Map());
    await claimOwnership(platform, repo);
    expect(await failureOf(claimOwnership(platform, repo))).toBe('IN_USE');
  });

  it('recovers a stale owner: dead PID, or a PID reused by a different process (start time differs)', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    await own(first.platform, first.repo, 40001);
    table.delete(4242); // crash: no cleanup ran
    table.set(5151, 1_790_000_100_000);
    const second = fakePlatform(5151, table);
    const afterCrash = await claimOwnership(second, first.repo);
    expect(afterCrash.generation).toBe(2);
    await releaseOwnership(second, first.repo, afterCrash);
    // PID reuse: 4242 is alive again, but it is a different process (other start time) than the recorded owner.
    const third = await setup(table, 6161, 1_790_000_200_000);
    const reusedOwner = await claimOwnership(third.platform, third.repo);
    table.set(6161, 1_790_000_999_999);
    const fourth = fakePlatform(7171, table);
    table.set(7171, 1_790_000_300_000);
    const recovered = await claimOwnership(fourth, third.repo);
    expect(recovered.generation).toBe(reusedOwner.generation + 1);
  });

  it('does not take over when it cannot tell whether the owner is alive (fail closed)', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table);
    await own(first.platform, first.repo, 40001);
    const blind: Platform = { ...fakePlatform(5151, table), processStartTime: (target) => (target === 5151 ? Promise.resolve(1_790_000_100_000) : Promise.reject(new Error('unknowable'))) };
    expect(await failureOf(claimOwnership(blind, first.repo))).toBe('IN_USE');
  });

  it('a malformed or oversized lock record is a broken claim, never a live owner: it is taken over', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await claimOwnership(platform, repo).then((c) => releaseOwnership(platform, repo, c)); // creates the dir; leaves owner.2.lock
    await writeFile(path.join(repo.location.dir, 'owner.2.lock'), 'garbage', { mode: 0o600 });
    expect((await claimOwnership(platform, repo)).generation).toBe(3);
    await writeFile(path.join(repo.location.dir, 'owner.4.lock'), 'x'.repeat(5000), { mode: 0o600 });
    const table2 = new Map<number, number>([[5151, 1_790_000_100_000]]);
    expect((await claimOwnership(fakePlatform(5151, table2), repo)).generation).toBe(5);
  });

  it('a lock entry that is not a regular file is refused (fail closed)', async () => {
    if (!posix) {
      return;
    }
    const { platform, repo } = await setup(new Map());
    await claimOwnership(platform, repo).then((c) => releaseOwnership(platform, repo, c));
    await rm(path.join(repo.location.dir, 'owner.2.lock'));
    await mkdir(path.join(repo.location.dir, 'owner.2.lock'));
    expect(await failureOf(claimOwnership(platform, repo))).toBe('NOT_PRIVATE');
  });

  it('a stale state file does not block a new owner (it is replaced on publish); a non-private or linked one is never touched', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await mkdir(repo.location.dir, { recursive: true, mode: 0o700 });
    await writeFile(repo.location.file, 'garbage', { mode: 0o600 });
    const claim = await claimOwnership(platform, repo);
    await publishState(platform, repo, claim, { port: 40123, token: TOKEN });
    expect((await readVerifiedState(platform, repo)).port).toBe(40123);
    await removeOwnState(platform, repo, claim);
    await releaseOwnership(platform, repo, claim);

    await writeFile(repo.location.file, 'garbage', { mode: 0o644 });
    expect(await failureOf(claimOwnership(platform, repo))).toBe('NOT_PRIVATE');
    expect(await readFile(repo.location.file, 'utf8')).toBe('garbage');
    // The refused claim released itself: it did not leave a live owner behind.
    await chmod(repo.location.file, 0o600);
    await rm(repo.location.file);
    await symlink('/etc/hostname', repo.location.file);
    expect(await failureOf(claimOwnership(platform, repo))).toBe('NOT_PRIVATE');
  });
});

describe('readVerifiedState (tool): the token is only returned after the ownership chain checks out', () => {
  async function published(table: Map<number, number>): Promise<{ platform: Platform; repo: ResolvedRepo; root: string }> {
    const ctx = await setup(table);
    await own(ctx.platform, ctx.repo);
    return ctx;
  }

  it('MISSING when the backend never ran', async () => {
    if (!posix) {
      return;
    }
    const { platform, repo } = await setup(new Map());
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('MISSING');
  });

  it('STALE when the backend process is gone, or the PID now belongs to another process', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    table.delete(4242);
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('STALE');
    table.set(4242, 1_790_000_555_555);
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('STALE');
  });

  it('STALE (fail closed) when process identity cannot be determined', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    const blind: Platform = { ...platform, processStartTime: () => Promise.reject(new Error('unknowable')) };
    expect(await failureOf(readVerifiedState(blind, repo))).toBe('STALE');
  });

  it('FOREIGN_REPO when the state belongs to another repository, FOREIGN_USER when it belongs to another OS user', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    expect(await failureOf(readVerifiedState(platform, { ...repo, identity: 'f'.repeat(64) }))).toBe('FOREIGN_REPO');
    expect(await failureOf(readVerifiedState(fakePlatform(4242, table, '2000'), repo))).toBe('FOREIGN_USER');
  });

  it('MALFORMED for garbage or an oversized file; NOT_PRIVATE for a readable-by-others file', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    await writeFile(repo.location.file, 'x'.repeat(5000), { mode: 0o600 });
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('MALFORMED');
    await writeFile(repo.location.file, '{"nope":true}', { mode: 0o600 });
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('MALFORMED');
    await chmod(repo.location.file, 0o644);
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('NOT_PRIVATE');
  });

  it('NOT_PRIVATE when the directory was opened up or replaced by a link', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    await chmod(repo.location.dir, 0o755);
    expect(await failureOf(readVerifiedState(platform, repo))).toBe('NOT_PRIVATE');
  });

  it('never throws a message containing the token or the port', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await published(table);
    table.delete(4242);
    try {
      await readVerifiedState(platform, repo);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(TOKEN);
      expect(String((error as Error).message)).not.toContain('40123');
    }
  });
});

describe('real Linux process identity end to end', () => {
  it('the state published by this very process verifies with the real platform', async () => {
    if (process.platform !== 'linux') {
      return;
    }
    const platform = createPlatform();
    const root = await tempRepo();
    const repo = await resolveRepo(platform, root);
    await mkdir(path.join(root, 'x'), { recursive: true });
    const claim = await own(platform, repo);
    expect((await readVerifiedState(platform, repo)).port).toBe(40123);
    expect(await removeOwnState(platform, repo, claim)).toBe(true);
    await releaseOwnership(platform, repo, claim);
  });
});
