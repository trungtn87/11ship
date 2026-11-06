import { describe, expect, it, jest } from '@jest/globals';
import { AppConfig } from '../config/app-config';
import { IdempotencyCleanup } from './idempotency-cleanup';
import {
  IDEMPOTENCY_CLEANUP_EVERY_MS,
  IDEMPOTENCY_CLEANUP_MAX_BATCHES,
  IdempotencyCleanupRuntime,
} from './idempotency-cleanup-runtime';

function runtimeWith(runOnce: jest.Mock<IdempotencyCleanup['runOnce']>, collectorEnabled = true) {
  const config = { ops: { collectorEnabled, diskPaths: [], backendVersion: 'test' } } as unknown as AppConfig;
  return new IdempotencyCleanupRuntime({ runOnce } as unknown as IdempotencyCleanup, config);
}

describe('IdempotencyCleanupRuntime', () => {
  it('runs once a day', () => {
    expect(IDEMPOTENCY_CLEANUP_EVERY_MS).toBe(86_400_000);
  });

  it('stops after the first partial batch', async () => {
    const runOnce = jest.fn<IdempotencyCleanup['runOnce']>().mockResolvedValue({ replayCleared: 3, recordsDeleted: 2 });
    const result = await runtimeWith(runOnce).tick();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ replayCleared: 3, recordsDeleted: 2 });
  });

  it('keeps draining while a phase returns a full batch, bounded per tick', async () => {
    const runOnce = jest.fn<IdempotencyCleanup['runOnce']>().mockResolvedValue({ replayCleared: 100, recordsDeleted: 0 });
    await runtimeWith(runOnce).tick();
    expect(runOnce).toHaveBeenCalledTimes(IDEMPOTENCY_CLEANUP_MAX_BATCHES);
  });

  it('survives a failing pass and allows the next tick', async () => {
    const runOnce = jest
      .fn<IdempotencyCleanup['runOnce']>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ replayCleared: 0, recordsDeleted: 0 });
    const runtime = runtimeWith(runOnce);
    expect(await runtime.tick()).toBeUndefined();
    expect(await runtime.tick()).toEqual({ replayCleared: 0, recordsDeleted: 0 });
  });

  it('does not overlap two ticks', async () => {
    let release: () => void = () => undefined;
    const runOnce = jest.fn<IdempotencyCleanup['runOnce']>().mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ replayCleared: 0, recordsDeleted: 0 }); }),
    );
    const runtime = runtimeWith(runOnce);
    const first = runtime.tick();
    expect(await runtime.tick()).toBeUndefined();
    release();
    await first;
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('starts no timer when the collector is disabled', () => {
    const spy = jest.spyOn(global, 'setInterval');
    runtimeWith(jest.fn<IdempotencyCleanup['runOnce']>(), false).onApplicationBootstrap();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('schedules a daily timer when the collector is enabled and clears it on shutdown', () => {
    const runtime = runtimeWith(jest.fn<IdempotencyCleanup['runOnce']>());
    const spy = jest.spyOn(global, 'setInterval');
    runtime.onApplicationBootstrap();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), IDEMPOTENCY_CLEANUP_EVERY_MS);
    runtime.onApplicationShutdown();
    spy.mockRestore();
  });
});
