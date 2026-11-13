import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { gatewayState, M14GatewayProbe } from './m14-gateway-probe';

const VERSION = 'valhalla-3.9.1/motorcycle-shortest-6bc733fe/abc123def456';
const config = { origin: 'https://route.test', timeoutMs: 50 };
const healthy = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

describe('M14 gateway state at startup (P6-1 review round 2, SỬA-6b)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('classifies the /health answer: ready with a valid version is READY; anything else is named', () => {
    expect(gatewayState({ ready: true, routeVersion: VERSION })).toBe('READY');
    expect(gatewayState({ ready: false, routeVersion: VERSION })).toBe('NOT_READY');
    expect(gatewayState({ message: 'starting' })).toBe('NOT_READY');
    expect(gatewayState({ ready: true })).toBe('VERSION_INVALID');
    expect(gatewayState({ ready: true, routeVersion: 'has space' })).toBe('VERSION_INVALID');
    expect(gatewayState({ ready: true, routeVersion: 7 })).toBe('VERSION_INVALID');
    expect(gatewayState(null)).toBe('NOT_READY');
  });

  it('a ready gateway with a valid version logs nothing', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const probe = new M14GatewayProbe(config, healthy({ ready: true, routeVersion: VERSION }));
    await expect(probe.probe()).resolves.toBe('READY');
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a gateway without a valid routeVersion logs ONE error, however many probes run', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const probe = new M14GatewayProbe(config, healthy({ ready: true }));
    await expect(probe.probe()).resolves.toBe('VERSION_INVALID');
    await expect(probe.probe()).resolves.toBe('VERSION_INVALID');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('startup is not blocked: a gateway that never answers does not hold up the backend boot', () => {
    const probe = new M14GatewayProbe(config, () => new Promise(() => undefined));
    const started = Date.now();
    expect(probe.onApplicationBootstrap()).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a gateway that is down is UNREACHABLE and never throws into the boot', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const probe = new M14GatewayProbe(config, async () => { throw new TypeError('fetch failed'); });
    await expect(probe.probe()).resolves.toBe('UNREACHABLE');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('without a routing origin there is nothing to probe', async () => {
    const fetcher = jest.fn(healthy({ ready: true, routeVersion: VERSION }));
    const probe = new M14GatewayProbe(undefined, fetcher);
    await expect(probe.probe()).resolves.toBe('NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
