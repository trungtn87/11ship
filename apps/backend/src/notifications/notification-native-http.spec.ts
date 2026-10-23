import 'reflect-metadata';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app.setup';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionService } from '../auth/session-service';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { ClientDeviceRepository } from '../client-device/client-device-repository';
import { ClientDeviceTrust } from '../client-device/client-device-trust';
import { requestMessage, sha256Hex } from '../client-device/device-messages';
import { AppError } from '../common/app-errors';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionManager } from '../transaction/transaction-manager';
import { NotificationController } from './notification.controller';
import { NotificationInboxService } from './notification-inbox-service';

// Real Nest parsers, session guard and cryptographic verifier. Only persistence and inbox business data are fixtures.
// This specifically covers the Android path that WEB-only M08 integration fixtures cannot exercise.
describe('M08 native HTTP body proof (#151)', () => {
  let app: INestApplication;
  let origin: string;
  const token = randomBytes(32).toString('base64url');
  const keyId = randomUUID();
  const notificationId = randomUUID();
  const orderId = randomUUID();
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const nonces = new Set<string>();
  const sessions = { authenticate: jest.fn(async () => ({ userId: randomUUID(), sessionId: 'fixture-session', activeRole: 'SHOP', phoneNormalized: '', platform: 'ANDROID', app: 'FOOD' })) };
  const inbox = {
    list: jest.fn(async () => ({ items: [{ notification_id: notificationId, target: { type: 'ORDER', id: orderId } }] })),
    open: jest.fn(async () => ({ notification_id: notificationId, outcome: 'OK', target: { type: 'ORDER', id: orderId } })),
    markRead: jest.fn(async () => ({ unread_count: 0 })),
    updateSettings: jest.fn(async () => ({ orders: true })),
  };

  beforeAll(async () => {
    const proof = new ClientDeviceProofService(
      { withTransaction: async (fn: (ctx: object) => Promise<unknown>) => fn({}) } as unknown as TransactionManager,
      {
        sessionBinding: async () => ({ keyId, usable: true }),
        findKeyById: async () => ({ keyId, revoked: false, publicKeySpki: key.publicKey.export({ type: 'spki', format: 'der' }) }),
        nowSeconds: async () => Math.floor(Date.now() / 1000),
        insertRequestNonce: async (_ctx: unknown, _keyId: string, nonce: Buffer) => {
          const id = nonce.toString('hex');
          if (nonces.has(id)) return false;
          nonces.add(id);
          return true;
        },
      } as unknown as ClientDeviceRepository,
      { environment: 'fixture-env' } as ClientDeviceTrust,
    );
    const module = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        SessionAuthGuard,
        { provide: SessionService, useValue: sessions },
        { provide: ClientDeviceProofService, useValue: proof },
        { provide: NotificationInboxService, useValue: inbox },
        { provide: APP_LOGGER, useValue: new JsonLogger(() => undefined) },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app?.close(); });

  async function call(method: string, path: string, body?: string, signedBody = body, headersOverride: Record<string, string> = {}) {
    const time = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(32).toString('base64url');
    const message = requestMessage({ environment: 'fixture-env', keyId, time, nonce, method, url: path, bodySha256Hex: sha256Hex(signedBody ?? ''), bearerSha256Hex: sha256Hex(token), idempotencyKey: '' });
    return fetch(`${origin}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8', 'x-device-key-id': keyId, 'x-device-time': time, 'x-device-nonce': nonce, 'x-device-signature': sign('sha256', message, key.privateKey).toString('base64url'), ...headersOverride },
      ...(body === undefined ? {} : { body }),
    });
  }

  it('GET list -> signed POST {} open returns the server ORDER id, with private transport headers', async () => {
    expect((await call('GET', '/v1/notifications')).status).toBe(200);
    const response = await call('POST', `/v1/notifications/${notificationId}/open`, '{}');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ data: { outcome: 'OK', target: { type: 'ORDER', id: orderId } } });
    expect(inbox.open).toHaveBeenCalledTimes(1);
  });

  it('preserves exact bytes, including whitespace, for other M08 writes', async () => {
    expect((await call('POST', '/v1/notifications/read', `{ "ids": ["${notificationId}"] }`)).status).toBe(200);
    expect((await call('POST', '/v1/notifications/read-all', '{ }')).status).toBe(200);
    expect((await call('PUT', '/v1/notifications/settings', '{ "orders": true }')).status).toBe(200);
  });

  it('a changed body or missing proof stays 403 and never opens/marks the notification', async () => {
    const opened = inbox.open.mock.calls.length;
    for (const response of [
      await call('POST', `/v1/notifications/${notificationId}/open`, '{ }', '{}'),
      await fetch(`${origin}/v1/notifications/${notificationId}/open`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: expect.stringMatching(/^DEVICE_PROOF_(INVALID|REQUIRED)$/), request_id: expect.any(String) } });
    }
    expect(inbox.open).toHaveBeenCalledTimes(opened);
  });

  it('an ended session stays 401 without reaching the inbox', async () => {
    const opened = inbox.open.mock.calls.length;
    sessions.authenticate.mockRejectedValueOnce(new AppError('SESSION_INVALID'));
    const response = await call('POST', `/v1/notifications/${notificationId}/open`, '{}');
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'SESSION_INVALID', request_id: expect.any(String) } });
    expect(inbox.open).toHaveBeenCalledTimes(opened);
  });
});
