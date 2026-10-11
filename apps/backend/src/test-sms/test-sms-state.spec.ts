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
  parseStateFile,
  prepareStateForStart,
  publishState,
  readVerifiedState,
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

  function mutated(mutator: (o: Record<string, any>) => void): string {
    const parsed = JSON.parse(serializeState(sampleState())) as Record<string, any>;
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

describe('publish, read and remove', () => {
  it('publishes atomically (private file, no temp leftovers) and the tool reads it back after verification', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await prepareStateForStart(platform, repo);
    const published = await publishState(platform, repo, { port: 40123, token: TOKEN });
    expect(published.backendPid).toBe(4242);
    expect((await lstat(repo.location.file)).mode & 0o777).toBe(0o600);
    expect(await readdir(repo.location.dir)).toEqual(['state.json']);
    const verified = await readVerifiedState(platform, repo);
    expect(verified).toEqual({ instanceId: published.instanceId, host: '127.0.0.1', port: 40123, token: TOKEN });
  });

  it('a restart replaces the state with a new instance id; the old process cannot remove the new state', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    await prepareStateForStart(first.platform, first.repo);
    const oldOwn = await publishState(first.platform, first.repo, { port: 40001, token: TOKEN });
    // The first backend dies without cleaning up; a new one (different PID) starts.
    table.delete(4242);
    table.set(5151, 1_790_000_100_000);
    const second = fakePlatform(5151, table);
    await prepareStateForStart(second, first.repo);
    const newOwn = await publishState(second, first.repo, { port: 40002, token: 'B'.repeat(43) });
    expect(newOwn.instanceId).not.toBe(oldOwn.instanceId);
    expect(await removeOwnState(first.platform, first.repo, oldOwn)).toBe(false);
    expect((await readVerifiedState(second, first.repo)).port).toBe(40002);
    expect(await removeOwnState(second, first.repo, newOwn)).toBe(true);
    expect(await failureOf(readVerifiedState(second, first.repo))).toBe('MISSING');
  });

  it('removes only the state of the same instance (id + PID + start time)', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await prepareStateForStart(platform, repo);
    const own = await publishState(platform, repo, { port: 40123, token: TOKEN });
    for (const wrong of [
      { ...own, instanceId: '99999999-2222-4333-8444-555555555555' },
      { ...own, backendPid: own.backendPid + 1 },
      { ...own, backendStartedAtMs: own.backendStartedAtMs + 1 },
    ]) {
      expect(await removeOwnState(platform, repo, wrong)).toBe(false);
      expect((await lstat(repo.location.file)).isFile()).toBe(true);
    }
    expect(await removeOwnState(platform, repo, own)).toBe(true);
    expect(await removeOwnState(platform, repo, own)).toBe(false);
  });

  it('a write failure leaves no state and no temp file', async () => {
    if (!posix || process.getuid?.() === 0) {
      return; // root ignores directory modes
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await prepareStateForStart(platform, repo);
    await chmod(repo.location.dir, 0o500);
    try {
      expect(await failureOf(publishState(platform, repo, { port: 1, token: TOKEN }))).toBe('WRITE_FAILED');
    } finally {
      await chmod(repo.location.dir, 0o700);
    }
    expect(await readdir(repo.location.dir)).toEqual([]);
  });

  it('refuses to publish when the own start time is unknowable', async () => {
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    table.delete(4242);
    expect(await failureOf(publishState(platform, repo, { port: 1, token: TOKEN }))).toBe('WRITE_FAILED');
  });
});

describe('prepareStateForStart (backend)', () => {
  it('creates the private directory and accepts an absent state', async () => {
    if (!posix) {
      return;
    }
    const { platform, repo } = await setup(new Map());
    await prepareStateForStart(platform, repo);
    expect((await lstat(repo.location.dir)).mode & 0o777).toBe(0o700);
  });

  it('refuses (IN_USE) when another LIVE backend instance owns the state, and leaves it untouched', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    await prepareStateForStart(first.platform, first.repo);
    await publishState(first.platform, first.repo, { port: 40001, token: TOKEN });
    const before = await readFile(first.repo.location.file, 'utf8');
    table.set(5151, 1_790_000_100_000);
    expect(await failureOf(prepareStateForStart(fakePlatform(5151, table), first.repo))).toBe('IN_USE');
    expect(await readFile(first.repo.location.file, 'utf8')).toBe(before);
  });

  it('replaces a stale state: dead PID, or PID reused by a different process (start time differs)', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table, 4242, 1_790_000_000_000);
    await prepareStateForStart(first.platform, first.repo);
    await publishState(first.platform, first.repo, { port: 40001, token: TOKEN });
    table.delete(4242);
    table.set(5151, 1_790_000_100_000);
    const second = fakePlatform(5151, table);
    await prepareStateForStart(second, first.repo); // dead PID
    table.set(4242, 1_790_000_999_999); // PID reuse: same number, different start time
    await prepareStateForStart(second, first.repo);
  });

  it('the same process restarting its own runtime is not "in use"', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await prepareStateForStart(platform, repo);
    await publishState(platform, repo, { port: 40001, token: TOKEN });
    await prepareStateForStart(platform, repo);
  });

  it('does not overwrite when it cannot tell whether the owner is alive', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const first = await setup(table);
    await prepareStateForStart(first.platform, first.repo);
    await publishState(first.platform, first.repo, { port: 40001, token: TOKEN });
    const blind: Platform = { ...fakePlatform(5151, table), processStartTime: () => Promise.reject(new Error('unknowable')) };
    expect(await failureOf(prepareStateForStart(blind, first.repo))).toBe('IN_USE');
  });

  it('a malformed state is replaced; a non-private or linked state is never touched', async () => {
    if (!posix) {
      return;
    }
    const table = new Map<number, number>();
    const { platform, repo } = await setup(table);
    await prepareStateForStart(platform, repo);
    await writeFile(repo.location.file, 'garbage', { mode: 0o600 });
    await prepareStateForStart(platform, repo);
    await chmod(repo.location.file, 0o644);
    expect(await failureOf(prepareStateForStart(platform, repo))).toBe('NOT_PRIVATE');
    expect(await readFile(repo.location.file, 'utf8')).toBe('garbage');
    await rm(repo.location.file);
    await symlink('/etc/hostname', repo.location.file);
    expect(await failureOf(prepareStateForStart(platform, repo))).toBe('NOT_PRIVATE');
  });
});

describe('readVerifiedState (tool): the token is only returned after the ownership chain checks out', () => {
  async function published(table: Map<number, number>): Promise<{ platform: Platform; repo: ResolvedRepo; root: string }> {
    const ctx = await setup(table);
    await prepareStateForStart(ctx.platform, ctx.repo);
    await publishState(ctx.platform, ctx.repo, { port: 40123, token: TOKEN });
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
    await prepareStateForStart(platform, repo);
    const own = await publishState(platform, repo, { port: 40123, token: TOKEN });
    expect((await readVerifiedState(platform, repo)).port).toBe(40123);
    expect(await removeOwnState(platform, repo, own)).toBe(true);
  });
});
