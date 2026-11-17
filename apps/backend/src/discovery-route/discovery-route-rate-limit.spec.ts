import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { OtpClientIp } from '../auth/otp-client-ip';
import { AppConfig } from '../config/app-config';
import { PUBLIC_TRACKING_MAX_IDENTITIES, PublicTrackingRateLimiter } from '../delivery/public-tracking-rate-limiter';
import { DiscoveryRouteController, ROUTE_DISTANCES_LIMIT_PER_MINUTE } from './discovery-route.controller';
import { DiscoveryRouteService } from './discovery-route-service';

const PROXY = '10.20.30.40';
const SHOP = '11111111-1111-4111-8111-111111111111';
const BODY = { origin: { lat: 22.66, lng: 106.25 }, shop_ids: [SHOP] };
const res = { setHeader: (): void => undefined };

function controller(): DiscoveryRouteController {
  const config = { adminAuth: { trustedProxyIps: [PROXY] } } as unknown as AppConfig;
  const service = { distances: async () => ({ routing_available: true, distances: [] }) } as unknown as DiscoveryRouteService;
  return new DiscoveryRouteController(service, new OtpClientIp(config));
}

const request = (remote: string, forwardedFor?: string) => ({
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  socket: { remoteAddress: remote },
});

/** The HTTP status the call would produce: 200, the HttpException status, or 500 for anything else. */
async function hit(c: DiscoveryRouteController, req: ReturnType<typeof request>): Promise<number> {
  try {
    await c.distances(BODY, req, res);
    return 200;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
}

async function exhaust(c: DiscoveryRouteController, make: () => ReturnType<typeof request>): Promise<void> {
  for (let i = 0; i < ROUTE_DISTANCES_LIMIT_PER_MINUTE; i += 1) {
    expect(await hit(c, make())).toBe(200);
  }
  expect(await hit(c, make())).toBe(429);
}

describe('route-distances per-address limit (P5-7c)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('serves up to the limit from one address and refuses the next call with 429', async () => {
    const c = controller();
    await exhaust(c, () => request('198.51.100.7'));
  });

  it('refuses with the same error shape as public tracking: HttpException 429 "Too Many Requests"', async () => {
    const c = controller();
    for (let i = 0; i < ROUTE_DISTANCES_LIMIT_PER_MINUTE; i += 1) {
      await hit(c, request('198.51.100.11'));
    }
    const error = await c.distances(BODY, request('198.51.100.11'), res).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toBe('Too Many Requests');
  });

  it('a different address is not affected by an exhausted one', async () => {
    const c = controller();
    await exhaust(c, () => request('198.51.100.20'));
    expect(await hit(c, request('198.51.100.21'))).toBe(200);
  });

  it('behind a trusted proxy the forwarded client is the address: two clients do not share the quota', async () => {
    const c = controller();
    await exhaust(c, () => request(PROXY, '203.0.113.50'));
    expect(await hit(c, request(PROXY, '203.0.113.51'))).toBe(200);
  });

  it('an untrusted source cannot escape its quota by forging X-Forwarded-For', async () => {
    const c = controller();
    let seq = 0;
    await exhaust(c, () => request('198.51.100.30', `203.0.113.${(seq += 1)}`));
  });

  it('a trusted proxy without exactly one forwarded address is refused (400), not counted under the proxy', async () => {
    const c = controller();
    expect(await hit(c, request(PROXY))).toBe(400);
  });

  it('the window ends: the same address is served again after one minute', async () => {
    const c = controller();
    await exhaust(c, () => request('198.51.100.40'));
    jest.setSystemTime(60_001);
    expect(await hit(c, request('198.51.100.40'))).toBe(200);
  });

  it('memory stays at the hard cap when many distinct addresses call', async () => {
    const c = controller();
    for (let i = 0; i < PUBLIC_TRACKING_MAX_IDENTITIES + 500; i += 1) {
      expect(await hit(c, request(`198.18.${Math.floor(i / 250)}.${i % 250}`))).toBe(200);
    }
    const limiter = (c as unknown as { limiter: PublicTrackingRateLimiter }).limiter;
    expect(limiter.size).toBeLessThanOrEqual(PUBLIC_TRACKING_MAX_IDENTITIES);
  });
});
