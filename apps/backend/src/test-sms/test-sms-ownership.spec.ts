import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { RunningTestSmsListener, startTestSmsListener } from './test-sms-listener';
import { Platform, createPlatform } from './test-sms-platform';
import { createTestSmsRuntime, TestSmsRuntime } from './test-sms-runtime';
import {
  ResolvedRepo,
  StateError,
  StateHooks,
  claimOwnership,
  publishState,
  readVerifiedState,
  releaseOwnership,
  removeOwnState,
  resolveRepo,
} from './test-sms-state';
import { TestSmsStartupError } from './test-sms-types';

// F1 — ownership of the discovery state is serialized BETWEEN PROCESSES from claim to publish to cleanup.
// Deterministic: every interleaving is forced with barriers placed at the exact step (StateHooks), never with sleeps.
// "Processes" are separate Platform objects with their own PID in a fake process table; files are real.

const posix = process.platform === 'linux' || process.platform === 'darwin';
const DB = 'postgres://ship11_dev:secret@127.0.0.1:5432/ship11_dev';
const dirs: string[] = [];
const runtimes: TestSmsRuntime[] = [];
const T0 = 1_790_000_000_000;

afterEach(async () => {
  while (runtimes.length > 0) {
    await (runtimes.pop() as TestSmsRuntime).stop();
  }
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function repoDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tsms-own-')));
  dirs.push(dir);
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '11ship' }));
  return dir;
}

function processAt(pid: number, table: Map<number, number>, startedAtMs: number, userId = '1000'): Platform {
  table.set(pid, startedAtMs);
  return {
    ...createPlatform(),
    pid,
    processStartTime: (target: number) => Promise.resolve(table.get(target)),
    currentUserId: () => Promise.resolve(userId),
  };
}

/** n parties wait at `wait()`; all are released together once the n-th arrives. */
function barrier(parties: number): { wait(): Promise<void>; arrived(): number; opened: Promise<void> } {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived >= parties) {
        open();
      }
      await opened;
    },
    arrived: () => arrived,
    opened,
  };
}

/** A latch the test opens by hand; `reached` resolves when the paused code arrives at the hook. */
function pause(): { hook(): Promise<void>; reached: Promise<void>; resume(): void } {
  let resume!: () => void;
  let reach!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  return {
    hook: async () => {
      reach();
      await gate;
    },
    reached,
    resume,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    if (error instanceof StateError) {
      return error.failure;
    }
    if (error instanceof TestSmsStartupError) {
      return error.code;
    }
    throw error;
  }
}

const stateText = (repo: ResolvedRepo): Promise<string> => readFile(repo.location.file, 'utf8');

describe('1. two instances both reach the claim step before any publish', () => {
  it('exactly one wins on an empty chain; the loser is refused and the winner publishes and stays intact', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const a = processAt(4242, table, T0);
    const b = processAt(5151, table, T0 + 1000);
    const repo = await resolveRepo(a, root);
    const gate = barrier(2);
    const hooks: StateHooks = { beforeClaimCreate: () => gate.wait() };

    const results = await Promise.allSettled([claimOwnership(a, repo, hooks), claimOwnership(b, repo, hooks)]);

    expect(gate.arrived()).toBe(2); // both really were at the claim step together
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(((losers[0] as PromiseRejectedResult).reason as StateError).failure).toBe('IN_USE');

    const winnerIsA = results[0]?.status === 'fulfilled';
    const winnerClaim = (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof claimOwnership>>>).value;
    const winnerPlatform = winnerIsA ? a : b;
    await publishState(winnerPlatform, repo, winnerClaim, { port: 40111, token: 'W'.repeat(43) });
    const published = await stateText(repo);

    // The loser retrying (now sequentially) still cannot touch anything.
    const loserPlatform = winnerIsA ? b : a;
    expect(await failureOf(claimOwnership(loserPlatform, repo))).toBe('IN_USE');
    expect(await stateText(repo)).toBe(published);
    expect(await readdir(repo.location.dir)).toEqual(['owner.1.lock', 'state.json']);
    expect((await readVerifiedState(winnerPlatform, repo)).token).toBe('W'.repeat(43));
  });

  it('three racers: still exactly one winner', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const platforms = [4242, 5151, 6161].map((pid, index) => processAt(pid, table, T0 + index));
    const repo = await resolveRepo(platforms[0] as Platform, root);
    const gate = barrier(3);
    const results = await Promise.allSettled(platforms.map((p) => claimOwnership(p, repo, { beforeClaimCreate: () => gate.wait() })));
    expect(gate.arrived()).toBe(3);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  });

  it('two instances racing to take over the SAME stale owner: exactly one wins, nobody deletes the winner', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const dead = processAt(4242, table, T0);
    const repo = await resolveRepo(dead, root);
    const deadClaim = await claimOwnership(dead, repo);
    await publishState(dead, repo, deadClaim, { port: 40001, token: 'D'.repeat(43) });
    table.delete(4242); // crash: no cleanup ran

    const a = processAt(5151, table, T0 + 1000);
    const b = processAt(6161, table, T0 + 2000);
    const gate = barrier(2);
    const hooks: StateHooks = { beforeClaimCreate: () => gate.wait() };
    const results = await Promise.allSettled([claimOwnership(a, repo, hooks), claimOwnership(b, repo, hooks)]);
    expect(gate.arrived()).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((loser.reason as StateError).failure).toBe('IN_USE');
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claimOwnership>>>).value;
    expect(winner.generation).toBe(2);
    // Between the takeover and the publish, the dead owner's leftover state is NOT served to the tool.
    const winnerPlatform = results[0]?.status === 'fulfilled' ? a : b;
    expect(await failureOf(readVerifiedState(winnerPlatform, repo))).toBe('STALE');
    await publishState(winnerPlatform, repo, winner, { port: 40222, token: 'N'.repeat(43) });
    expect((await readVerifiedState(winnerPlatform, repo)).token).toBe('N'.repeat(43));
  });
});

describe('2. the losing instance fails startup but the winner state and token stay intact', () => {
  function runtimeFor(root: string, platform: Platform, hooks: StateHooks): { runtime: TestSmsRuntime; listeners: () => number } {
    let opened = 0;
    const runtime = createTestSmsRuntime({
      config: { register: true, activation: true },
      appEnv: 'development',
      host: '127.0.0.1',
      databaseUrl: DB,
      repoRoot: root,
      platform,
      stateHooks: hooks,
      startListener: async (options): Promise<RunningTestSmsListener> => {
        opened += 1;
        return startTestSmsListener(options);
      },
    });
    runtimes.push(runtime);
    return { runtime, listeners: () => opened };
  }

  it('two backends of one repository starting together: one is up, the other stops with STATE_IN_USE and touches nothing', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const a = processAt(4242, table, T0);
    const b = processAt(5151, table, T0 + 1000);
    const gate = barrier(2);
    const hooks: StateHooks = { beforeClaimCreate: () => gate.wait() };
    const first = runtimeFor(root, a, hooks);
    const second = runtimeFor(root, b, hooks);

    const results = await Promise.allSettled([first.runtime.start(), second.runtime.start()]);
    expect(gate.arrived()).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as TestSmsStartupError).code).toBe('TEST_INBOX_STATE_IN_USE');

    const winner = results[0]?.status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    const winnerPlatform = winner === first ? a : b;
    const repo = await resolveRepo(winnerPlatform, root);

    expect(loser.listeners()).toBe(0); // the loser never opened a listener
    const connection = await readVerifiedState(winnerPlatform, repo);
    const before = await stateText(repo);
    const locksBefore = (await readdir(repo.location.dir)).sort();

    // The loser's own cleanup (its start() already ran it, and we run it again) removes nothing of the winner.
    await loser.runtime.stop();
    await loser.runtime.stop();
    expect(await stateText(repo)).toBe(before);
    expect((await readdir(repo.location.dir)).sort()).toEqual(locksBefore);

    // The winner's token and listener still work, and it still holds the chain.
    const reply = await fetch(`http://127.0.0.1:${connection.port}/messages`, { headers: { Authorization: `Bearer ${connection.token}` } });
    expect(reply.status).toBe(200);
    expect((await readVerifiedState(winnerPlatform, repo)).token).toBe(connection.token);
    expect(winner.runtime.listenerPort).toBe(connection.port);
  });

  it('a loser that starts later (winner fully up) is refused without opening a listener', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const first = runtimeFor(root, processAt(4242, table, T0), {});
    await first.runtime.start();
    const second = runtimeFor(root, processAt(5151, table, T0 + 1000), {});
    expect(await failureOf(second.runtime.start())).toBe('TEST_INBOX_STATE_IN_USE');
    expect(second.listeners()).toBe(0);
    const repo = await resolveRepo(processAt(4242, table, T0), root);
    const connection = await readVerifiedState(processAt(4242, table, T0), repo);
    expect(connection.port).toBe(first.runtime.listenerPort);
  });
});

describe('3. cleanup of the old instance racing the publish of the new one', () => {
  it('old instance paused INSIDE its cleanup (before removing state): a new instance is refused, then wins only after the release', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const oldPlatform = processAt(4242, table, T0);
    const repo = await resolveRepo(oldPlatform, root);
    const oldClaim = await claimOwnership(oldPlatform, repo);
    await publishState(oldPlatform, repo, oldClaim, { port: 40001, token: 'P'.repeat(43) });
    const oldState = await stateText(repo);
    await removeOwnState(oldPlatform, repo, oldClaim);
    await releaseOwnership(oldPlatform, repo, oldClaim);

    const stopping = pause();
    const owner = processAt(9191, table, T0 + 6000);
    const claim = await claimOwnership(owner, repo);
    await publishState(owner, repo, claim, { port: 40333, token: 'O'.repeat(43) });
    const ownerState = await stateText(repo);
    expect(ownerState).not.toBe(oldState);

    const stop = (async () => {
      await removeOwnState(owner, repo, claim, { beforeRemoveState: stopping.hook });
      await releaseOwnership(owner, repo, claim);
    })();
    await stopping.reached; // the old instance is inside cleanup, state.json still there

    const newcomer = processAt(7272, table, T0 + 7000);
    expect(await failureOf(claimOwnership(newcomer, repo))).toBe('IN_USE');
    expect(await stateText(repo)).toBe(ownerState); // nothing of the old owner was touched by the newcomer

    stopping.resume();
    await stop;
    const next = await claimOwnership(newcomer, repo);
    expect(next.generation).toBeGreaterThan(claim.generation);
    await publishState(newcomer, repo, next, { port: 40444, token: 'M'.repeat(43) });
    expect((await readVerifiedState(newcomer, repo)).token).toBe('M'.repeat(43));
  });

  it('old instance paused between state removal and release: the newcomer is still refused; after the release it publishes cleanly', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const owner = processAt(4242, table, T0);
    const repo = await resolveRepo(owner, root);
    const claim = await claimOwnership(owner, repo);
    await publishState(owner, repo, claim, { port: 40001, token: 'O'.repeat(43) });

    const releasing = pause();
    const stop = (async () => {
      await removeOwnState(owner, repo, claim);
      await releaseOwnership(owner, repo, claim, { beforeRelease: releasing.hook });
    })();
    await releasing.reached; // state.json is already gone, ownership not yet released
    await expect(readFile(repo.location.file)).rejects.toThrow();

    const newcomer = processAt(5151, table, T0 + 1000);
    expect(await failureOf(claimOwnership(newcomer, repo))).toBe('IN_USE');

    releasing.resume();
    await stop;
    const next = await claimOwnership(newcomer, repo);
    await publishState(newcomer, repo, next, { port: 40002, token: 'N'.repeat(43) });
    expect((await readVerifiedState(newcomer, repo)).port).toBe(40002);
  });

  it('a STALE old owner whose cleanup runs late (while the new owner is paused before its rename) cannot remove or overwrite anything', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const oldPlatform = processAt(4242, table, T0);
    const repo = await resolveRepo(oldPlatform, root);
    const oldClaim = await claimOwnership(oldPlatform, repo);
    await publishState(oldPlatform, repo, oldClaim, { port: 40001, token: 'O'.repeat(43) });
    table.delete(4242); // it is considered dead (crash / lost the process table entry)

    const fresh = processAt(5151, table, T0 + 1000);
    const claim = await claimOwnership(fresh, repo); // takeover: generation 2
    const publishing = pause();
    const publish = publishState(fresh, repo, claim, { port: 40002, token: 'N'.repeat(43) }, { beforePublishRename: publishing.hook });
    await publishing.reached; // new state is written to its temp file but NOT renamed yet

    // The old instance's late cleanup runs now, in the middle of the new publish.
    expect(await removeOwnState(oldPlatform, repo, oldClaim)).toBe(false);
    await releaseOwnership(oldPlatform, repo, oldClaim);
    table.set(4242, T0); // the old process turns out to be alive after all
    expect(await failureOf(claimOwnership(oldPlatform, repo))).toBe('IN_USE'); // and it cannot reclaim over the live one

    publishing.resume();
    await publish;
    const connection = await readVerifiedState(fresh, repo);
    expect(connection).toMatchObject({ port: 40002, token: 'N'.repeat(43) });
    expect(await readdir(repo.location.dir)).toEqual(['owner.2.lock', 'state.json']);
    // The new owner's own cleanup still works afterwards.
    expect(await removeOwnState(fresh, repo, claim)).toBe(true);
  });

  it('losing the chain between the temp write and the rename aborts the publish and leaves no state', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const owner = processAt(4242, table, T0);
    const repo = await resolveRepo(owner, root);
    const claim = await claimOwnership(owner, repo);
    const taken = pause();
    const publish = publishState(owner, repo, claim, { port: 1, token: 'X'.repeat(43) }, { beforePublishRename: taken.hook });
    await taken.reached;
    // Another instance (we pretend this one went stale) takes the chain over at generation 2.
    table.delete(4242);
    const intruder = processAt(5151, table, T0 + 1000);
    const intruderClaim = await claimOwnership(intruder, repo);
    taken.resume();
    expect(await failureOf(publish)).toBe('LOST_OWNERSHIP');
    await expect(readFile(repo.location.file)).rejects.toThrow();
    expect((await readdir(repo.location.dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(intruderClaim.generation).toBe(2);
  });
});

describe('4. crash, stale owner and PID reuse', () => {
  it('crash after publish: the state is STALE for the tool, the next backend recovers it, and the dead instance can never remove the new state', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const dead = processAt(4242, table, T0);
    const repo = await resolveRepo(dead, root);
    const deadClaim = await claimOwnership(dead, repo);
    await publishState(dead, repo, deadClaim, { port: 40001, token: 'D'.repeat(43) });
    table.delete(4242);

    const reader = processAt(9999, table, T0 + 500);
    expect(await failureOf(readVerifiedState(reader, repo))).toBe('STALE');

    const fresh = processAt(5151, table, T0 + 1000);
    const claim = await claimOwnership(fresh, repo);
    await publishState(fresh, repo, claim, { port: 40002, token: 'N'.repeat(43) });
    expect(await removeOwnState(dead, repo, deadClaim)).toBe(false);
    expect((await readVerifiedState(reader, repo)).token).toBe('N'.repeat(43));
  });

  it('PID reuse: the recorded PID is alive again but it is another process, so the old owner is stale and the tool will not use its state', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const original = processAt(4242, table, T0);
    const repo = await resolveRepo(original, root);
    const claim = await claimOwnership(original, repo);
    await publishState(original, repo, claim, { port: 40001, token: 'D'.repeat(43) });
    table.set(4242, T0 + 777_000); // PID 4242 now belongs to an unrelated, newer process

    const reader = processAt(9999, table, T0 + 500);
    expect(await failureOf(readVerifiedState(reader, repo))).toBe('STALE');
    const fresh = processAt(5151, table, T0 + 1000);
    const next = await claimOwnership(fresh, repo);
    expect(next.generation).toBe(2);
    await publishState(fresh, repo, next, { port: 40002, token: 'N'.repeat(43) });
    expect((await readVerifiedState(reader, repo)).port).toBe(40002);
  });

  it('PID reuse in a real race: two starters recover the same reused-PID owner, one wins', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const original = processAt(4242, table, T0);
    const repo = await resolveRepo(original, root);
    await claimOwnership(original, repo);
    table.set(4242, T0 + 777_000);
    const a = processAt(5151, table, T0 + 1000);
    const b = processAt(6161, table, T0 + 2000);
    const gate = barrier(2);
    const hooks: StateHooks = { beforeClaimCreate: () => gate.wait() };
    const results = await Promise.allSettled([claimOwnership(a, repo, hooks), claimOwnership(b, repo, hooks)]);
    expect(gate.arrived()).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('a live owner is never displaced by a stale-looking check on a platform that cannot read process start times', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const owner = processAt(4242, table, T0);
    const repo = await resolveRepo(owner, root);
    await claimOwnership(owner, repo);
    const blind: Platform = {
      ...processAt(5151, table, T0 + 1000),
      processStartTime: (pid) => (pid === 5151 ? Promise.resolve(T0 + 1000) : Promise.reject(new Error('unknowable'))),
    };
    expect(await failureOf(claimOwnership(blind, repo))).toBe('IN_USE');
  });

  it('the ownership files stay private on disk (0600 files in a 0700 directory) and carry no token', async () => {
    if (!posix) return;
    const root = await repoDir();
    const table = new Map<number, number>();
    const owner = processAt(4242, table, T0);
    const repo = await resolveRepo(owner, root);
    const claim = await claimOwnership(owner, repo);
    await publishState(owner, repo, claim, { port: 40001, token: 'S'.repeat(43) });
    const { lstat } = await import('node:fs/promises');
    expect((await lstat(repo.location.dir)).mode & 0o777).toBe(0o700);
    expect((await lstat(path.join(repo.location.dir, 'owner.1.lock'))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(repo.location.dir, 'owner.1.lock'), 'utf8')).not.toContain('S'.repeat(43));
  });
});
