import 'reflect-metadata';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app.setup';
import { SessionService } from '../auth/session-service';
import { ClientDeviceProofService } from '../client-device/client-device-proof-service';
import { ClientDeviceRepository } from '../client-device/client-device-repository';
import { ClientDeviceTrust } from '../client-device/client-device-trust';
import { requestMessage, sha256Hex } from '../client-device/device-messages';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { TopupRequestService } from './topup-request-service';
import { WalletTopupController } from './wallet-topup.controller';

// Real HTTP parser, session guard and ECDSA verifier. Only session/key storage and the money service are doubles:
// this regression must fail before business code when wallet requests lose their raw JSON body.
describe('native wallet request proof over the HTTP pipeline', () => {
  let app: INestApplication;
  let base: string;
  const keyId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const nonces = new Set<string>();
  const create = jest.fn(async () => ({ request_id: randomUUID(), state: 'PENDING' }));
  const cancel = jest.fn(async () => ({ state: 'CANCELLED' }));

  beforeAll(async () => {
    const transactions = {
      withTransaction: async <T>(work: (context: TransactionContext) => Promise<T>): Promise<T> => work({} as TransactionContext),
    } as unknown as TransactionManager;
    const devices = {
      sessionBinding: async () => ({ keyId, usable: true }),
      findKeyById: async () => ({ keyId, revoked: false, publicKeySpki: key.publicKey.export({ format: 'der', type: 'spki' }) }),
      nowSeconds: async () => Math.floor(Date.now() / 1000),
      insertRequestNonce: async (_context: unknown, _keyId: string, digest: Buffer) => {
        const value = digest.toString('hex');
        if (nonces.has(value)) return false;
        nonces.add(value);
        return true;
      },
    } as unknown as ClientDeviceRepository;
    const proof = new ClientDeviceProofService(transactions, devices, { environment: 'test' } as ClientDeviceTrust);
    const module = await Test.createTestingModule({
      controllers: [WalletTopupController],
      providers: [
        { provide: APP_LOGGER, useValue: new JsonLogger(() => undefined) },
        { provide: SessionService, useValue: { authenticate: async () => ({ userId: randomUUID(), sessionId: randomUUID(), platform: 'ANDROID', app: 'SHIP' }) } },
        { provide: ClientDeviceProofService, useValue: proof },
        { provide: TopupRequestService, useValue: { create, cancel } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => { await app?.close(); });
  beforeEach(() => { nonces.clear(); create.mockClear(); cancel.mockClear(); });

  function headers(path: string, body: string, idempotencyKey: string = randomUUID()): Record<string, string> {
    const time = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(32).toString('base64url');
    const message = requestMessage({ environment: 'test', keyId, time, nonce, method: 'POST', url: path,
      bodySha256Hex: sha256Hex(body), bearerSha256Hex: sha256Hex(token), idempotencyKey });
    return { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': idempotencyKey,
      'x-device-key-id': keyId, 'x-device-time': time, 'x-device-nonce': nonce,
      'x-device-signature': sign('sha256', message, key.privateKey).toString('base64url') };
  }

  const path = '/v1/driver/wallet/topup-requests';
  const body = '{ "amount_vnd": 100000 }';

  it('accepts the exact signed JSON bytes for an Android top-up (including whitespace)', async () => {
    const response = await fetch(base + path, { method: 'POST', headers: headers(path, body), body });
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]).toEqual([expect.objectContaining({ platform: 'ANDROID', app: 'SHIP' }), 100000, expect.any(String), expect.any(String)]);
  });

  it('accepts a signed cancellation under the same wallet prefix', async () => {
    const target = `${path}/${randomUUID()}/cancel`;
    const payload = '{"expected_version":1}';
    const response = await fetch(base + target, { method: 'POST', headers: headers(target, payload), body: payload });
    expect(response.status).toBe(200);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects altered JSON bytes before calling the top-up service', async () => {
    const response = await fetch(base + path, { method: 'POST', headers: headers(path, body), body: '{"amount_vnd":100000}' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_INVALID' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects missing proof before calling the top-up service', async () => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_REQUIRED' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a replayed nonce while a fresh proof with the same intent is accepted', async () => {
    const signed = headers(path, body);
    expect((await fetch(base + path, { method: 'POST', headers: signed, body })).status).toBe(201);
    const replay = await fetch(base + path, { method: 'POST', headers: signed, body });
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ error: { code: 'DEVICE_PROOF_INVALID' } });
    expect(create).toHaveBeenCalledTimes(1);
    const fresh = headers(path, body, signed['idempotency-key']);
    expect((await fetch(base + path, { method: 'POST', headers: fresh, body })).status).toBe(201);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
