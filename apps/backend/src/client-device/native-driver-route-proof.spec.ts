import 'reflect-metadata';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Body, Controller, HttpCode, Post, Put, UseGuards, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app.setup';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionService } from '../auth/session-service';
import { ClientDeviceProofService } from './client-device-proof-service';
import { ClientDeviceRepository } from './client-device-repository';
import { ClientDeviceTrust } from './client-device-trust';
import { requestMessage, sha256Hex } from './device-messages';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

// These paths mirror real native controllers; the probe isolates HTTP parsing and the actual session guard
// from business state, so a missing rawBody hook fails before any domain validation can obscure it.
@UseGuards(SessionAuthGuard)
@Controller()
class SignedNativeRouteProbe {
  @Post('driver/me/accepting')
  @HttpCode(200)
  accepting(@Body() body: unknown) { return { data: body }; }

  @Post('driver/deliveries/:delivery_id/accept')
  @HttpCode(200)
  acceptDelivery(@Body() body: unknown) { return { data: body }; }

  @Put('driver/location')
  location(@Body() body: unknown) { return { data: body }; }

  @Post('driver/complaints')
  @HttpCode(200)
  complaint(@Body() body: unknown) { return { data: body }; }

  @Post('driver/complaints/attachments')
  @HttpCode(200)
  complaintAttachment(@Body() body: unknown) { return { data: body }; }

  @Post('driver/wallet/topup-requests')
  @HttpCode(200)
  topup(@Body() body: unknown) { return { data: body }; }

  @Post('customers/me/orders')
  @HttpCode(200)
  customerOrder(@Body() body: unknown) { return { data: body }; }

  @Post('shop/me/orders/:order_id/confirm')
  @HttpCode(200)
  shopOrder(@Body() body: unknown) { return { data: body }; }

  @Post('notifications/read')
  @HttpCode(200)
  notification(@Body() body: unknown) { return { data: body }; }
}

describe('native signed body preservation on client API route families', () => {
  let app: INestApplication;
  let origin: string;
  const keyId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const nonces = new Set<string>();

  beforeAll(async () => {
    const transactions = {
      withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => work({} as TransactionContext),
    } as unknown as TransactionManager;
    const devices = {
      sessionBinding: async () => ({ keyId, usable: true }),
      findKeyById: async () => ({ keyId, revoked: false, publicKeySpki: key.publicKey.export({ format: 'der', type: 'spki' }) }),
      nowSeconds: async () => Math.floor(Date.now() / 1000),
      insertRequestNonce: async (_context: unknown, _keyId: string, digest: Buffer) => {
        const nonce = digest.toString('hex');
        if (nonces.has(nonce)) return false;
        nonces.add(nonce);
        return true;
      },
    } as unknown as ClientDeviceRepository;
    const proof = new ClientDeviceProofService(transactions, devices, { environment: 'test' } as ClientDeviceTrust);
    const module = await Test.createTestingModule({
      controllers: [SignedNativeRouteProbe],
      providers: [
        { provide: APP_LOGGER, useValue: new JsonLogger(() => undefined) },
        { provide: SessionService, useValue: { authenticate: async () => ({
          userId: randomUUID(), sessionId: randomUUID(), platform: 'ANDROID', app: 'SHIP',
        }) } },
        { provide: ClientDeviceProofService, useValue: proof },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => nonces.clear());

  function headers(path: string, body: string, method = 'POST'): Record<string, string> {
    const idempotencyKey = randomUUID();
    const time = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(32).toString('base64url');
    const message = requestMessage({
      environment: 'test', keyId, time, nonce, method, url: path,
      bodySha256Hex: sha256Hex(body), bearerSha256Hex: sha256Hex(token), idempotencyKey,
    });
    return {
      'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey,
      'x-device-key-id': keyId, 'x-device-time': time, 'x-device-nonce': nonce,
      'x-device-signature': sign('sha256', message, key.privateKey).toString('base64url'),
    };
  }

  it.each([
    ['/v1/driver/me/accepting', 'POST', '{ "accepting": true, "expected_version": 1 }'],
    [`/v1/driver/deliveries/${randomUUID()}/accept`, 'POST', '{}'],
    ['/v1/driver/location', 'PUT', '{ "lat": 22.66, "lon": 106.25 }'],
    ['/v1/driver/complaints', 'POST', '{ "reason": "test" }'],
    ['/v1/driver/wallet/topup-requests', 'POST', '{ "amount_vnd": 100000 }'],
    ['/v1/customers/me/orders', 'POST', '{ "items": [] }'],
    [`/v1/shop/me/orders/${randomUUID()}/confirm`, 'POST', '{ "version": 1 }'],
    ['/v1/notifications/read', 'POST', '{ "ids": [] }'],
  ])('accepts the original signed JSON bytes on %s (%s)', async (path, method, body) => {
    const response = await fetch(origin + path, { method, headers: headers(path, body, method), body });
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toMatchObject({ data: JSON.parse(body) as unknown });
  });

  it('keeps the larger M11 evidence parser before the driver-wide default parser', async () => {
    const path = '/v1/driver/complaints/attachments';
    const body = JSON.stringify({ base64: 'a'.repeat(1_100_000) });
    const response = await fetch(origin + path, { method: 'POST', headers: headers(path, body), body });
    expect(response.status).toBe(200);
  });

  it('still refuses altered signed bytes, absent proof and replay', async () => {
    const path = '/v1/driver/me/accepting';
    const body = '{ "accepting": true }';
    const signed = headers(path, body);
    const altered = await fetch(origin + path, { method: 'POST', headers: signed, body: '{"accepting":true}' });
    expect(altered.status).toBe(403);
    expect(await altered.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_INVALID' } });

    const missing = await fetch(origin + path, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_REQUIRED' } });

    const fresh = headers(path, body);
    expect((await fetch(origin + path, { method: 'POST', headers: fresh, body })).status).toBe(200);
    const replay = await fetch(origin + path, { method: 'POST', headers: fresh, body });
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_INVALID' } });
  });
});
