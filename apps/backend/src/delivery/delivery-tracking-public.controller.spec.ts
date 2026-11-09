import { describe, expect, it } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { OtpClientIp } from '../auth/otp-client-ip';
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
