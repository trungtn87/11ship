import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { OtpClientIp } from '../auth/otp-client-ip';
import { PublicRateLimitedError } from '../http/public-rate-limited-error';
import { AppConfig } from '../config/app-config';
import { DeliveryCustomerService } from './delivery-customer-service';
import { DeliveryTrackingPublicController } from './delivery-tracking-public.controller';

const PROXY = '10.20.30.40';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const LIMIT = 60;

function controller(): DeliveryTrackingPublicController {
  const config = { adminAuth: { trustedProxyIps: [PROXY] } } as unknown as AppConfig;
  const customer = { publicTrack: async () => ({ status: 'ACTIVE' }) } as unknown as DeliveryCustomerService;
  return new DeliveryTrackingPublicController(customer, new OtpClientIp(config));
}

const res = { setHeader: (): void => undefined };
const request = (remote: string, forwardedFor?: string) => ({
  // Express `ip` stays the socket address (trust proxy is off); the controller must not read it.
  ip: remote,
  headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  socket: { remoteAddress: remote },
});

async function hit(c: DeliveryTrackingPublicController, req: ReturnType<typeof request>): Promise<number> {
  try {
    await c.getStatus(TOKEN, req, res);
    return 200;
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 500;
  }
}

async function exhaust(c: DeliveryTrackingPublicController, make: () => ReturnType<typeof request>): Promise<void> {
  for (let i = 0; i < LIMIT; i += 1) {
    expect(await hit(c, make())).toBe(200);
  }
  expect(await hit(c, make())).toBe(429);
}

describe('public tracking limiter identity (P5-7b)', () => {
  it('an untrusted source cannot pick its bucket with X-Forwarded-For', async () => {
    const c = controller();
    // Same socket, a new forged address on each request: still one bucket, so it is limited.
    let seq = 0;
    await exhaust(c, () => request('198.51.100.7', `203.0.113.${(seq += 1)}`));
  });

  it('an untrusted source cannot spend another client\'s bucket by forging its address', async () => {
    const c = controller();
    await exhaust(c, () => request('198.51.100.8', '203.0.113.99'));
    // The forged victim address was never charged.
    expect(await hit(c, request('198.51.100.9'))).toBe(200);
    expect(await hit(c, request(PROXY, '203.0.113.99'))).toBe(200);
  });

  it('behind a trusted proxy the forwarded address is the client, and two clients do not share a bucket', async () => {
    const c = controller();
    await exhaust(c, () => request(PROXY, '203.0.113.50'));
    expect(await hit(c, request(PROXY, '203.0.113.51'))).toBe(200);
    expect(await hit(c, request(PROXY, '203.0.113.50'))).toBe(429);
  });

  it('a trusted proxy without exactly one forwarded address is refused rather than counted under the proxy', async () => {
    const c = controller();
    expect(await hit(c, request(PROXY))).toBe(400);
  });
});

describe('public tracking limiter memory bound (P5-7b, overflow bucket)', () => {
  it('(a) after 10 000 sources, new sources share one overflow bucket of 10 x 60 and then get 429', async () => {
    const c = controller();
    for (let i = 0; i < 10_000; i += 1) {
      expect(await hit(c, request(`198.18.${Math.floor(i / 250)}.${i % 250}`))).toBe(200);
    }
    for (let i = 0; i < LIMIT * 10; i += 1) {
      expect(await hit(c, request(`203.0.${Math.floor(i / 250)}.${i % 250}`))).toBe(200);
    }
    expect(await hit(c, request('203.0.200.1'))).toBe(429);
    expect(await hit(c, request('203.0.200.2'))).toBe(429); // a different new source is in the same spent bucket
  });

  it('(b) a source already in the table keeps its own 60/min quota while the overflow bucket is spent', async () => {
    const c = controller();
    for (let i = 0; i < 10_000; i += 1) {
      await hit(c, request(`198.18.${Math.floor(i / 250)}.${i % 250}`));
    }
    for (let i = 0; i < LIMIT * 10; i += 1) {
      await hit(c, request(`203.0.${Math.floor(i / 250)}.${i % 250}`));
    }
    expect(await hit(c, request('203.0.200.3'))).toBe(429);
    // Resident source 198.18.0.0 used 1 of 60 above; it still has its own quota.
    for (let i = 0; i < LIMIT - 1; i += 1) expect(await hit(c, request('198.18.0.0'))).toBe(200);
    expect(await hit(c, request('198.18.0.0'))).toBe(429);
  });

  it('(c) the overflow refusal is a PublicRateLimitedError with Retry-After seconds of the overflow window', async () => {
    jest.useFakeTimers({ now: 0 });
    try {
      const c = controller();
      for (let i = 0; i < 10_000; i += 1) {
        await hit(c, request(`198.18.${Math.floor(i / 250)}.${i % 250}`));
      }
      for (let i = 0; i < LIMIT * 10; i += 1) {
        await hit(c, request(`203.0.${Math.floor(i / 250)}.${i % 250}`));
      }
      jest.setSystemTime(15_000); // 15 s into the overflow window: 45 s left
      const error = await c.getStatus(TOKEN, request('203.0.200.4'), res).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PublicRateLimitedError);
      expect((error as PublicRateLimitedError).getStatus()).toBe(429);
      expect((error as PublicRateLimitedError).retryAfterSeconds).toBe(45);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('public tracking 429 carries Retry-After seconds (P5-7b)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('the refusal is a PublicRateLimitedError (still an HttpException 429) with the seconds left in the window', async () => {
    const c = controller();
    for (let i = 0; i < LIMIT; i += 1) expect(await hit(c, request('198.51.100.60'))).toBe(200);
    jest.setSystemTime(10_000); // 10 s into the window: 50 s left
    const error = await c.getStatus(TOKEN, request('198.51.100.60'), res).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublicRateLimitedError);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as PublicRateLimitedError).retryAfterSeconds).toBe(50);
  });
});
