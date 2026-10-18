import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { channelId, FcmPushProvider, PushMessage } from './push-provider';

// The real FCM client against a local HTTP server that speaks the two Google endpoints (OAuth token, messages:send): the request shape, the OAuth JWT, the
// refresh on 401 and the closed mapping of every answer. It proves the client, not a phone and not Google's acceptance of a real project.

const message: PushMessage = {
  token: 'tok-aaaaaaaaaaaaaaaaaaaa',
  title: 'Có đơn giao hàng mới',
  body: 'Xem danh sách đơn có thể nhận.',
  notificationId: '11111111-1111-4111-8111-111111111111',
  kind: 'NEW_OFFERS',
  targetType: 'DELIVERY_LIST',
  targetId: null,
  sound: false,
  vibrate: true,
  ttlSeconds: 90,
  collapseKey: 'new_offers',
  highPriority: true,
};

describe('FcmPushProvider', () => {
  let server: http.Server;
  let origin = '';
  let file = '';
  const sends: { auth: string | undefined; body: Record<string, any> }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const oauth: { assertion: string }[] = [];
  const plan: number[] = [];
  let tokenStatus = 200;

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (c: Buffer) => chunks.push(c));
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        response.setHeader('content-type', 'application/json');
        if (request.url === '/token') {
          oauth.push({ assertion: new URLSearchParams(raw).get('assertion') ?? '' });
          response.statusCode = tokenStatus;
          response.end(JSON.stringify(tokenStatus === 200 ? { access_token: `access-${String(oauth.length)}`, expires_in: 3600 } : {}));
          return;
        }
        sends.push({ auth: request.headers.authorization, body: JSON.parse(raw) });
        const status = plan.shift() ?? 200;
        response.statusCode = status;
        response.end(JSON.stringify(status === 200 ? { name: 'projects/p/messages/1' } : status === 404 ? { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } : status === 400 ? { error: { status: 'INVALID_ARGUMENT' } } : { error: { status: 'UNAVAILABLE' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    file = path.join(mkdtempSync(path.join(os.tmpdir(), 'fcm-spec-')), 'sa.json');
    writeFileSync(file, JSON.stringify({ client_email: 'push@p.iam.example', private_key: privateKey, token_uri: `${origin}/token` }));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const provider = (): FcmPushProvider => new FcmPushProvider({ projectId: 'eleven-ship-test', serviceAccountFile: file, apiOrigin: origin });
  const signal = (): AbortSignal => new AbortController().signal;

  it('signs an RS256 JWT for the FCM scope and sends the contract message with the account\'s sound/vibration channel; the token is reused', async () => {
    const p = provider();
    expect(await p.send(message, signal())).toEqual({ kind: 'SENT' });
    expect(await p.send(message, signal())).toEqual({ kind: 'SENT' });
    expect(oauth).toHaveLength(1);
    const [header, claims] = (oauth[0] as { assertion: string }).assertion.split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>);
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toMatchObject({ iss: 'push@p.iam.example', scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: `${origin}/token` });
    const sent = sends.at(-1) as (typeof sends)[number];
    expect(sent.auth).toBe('Bearer access-1');
    expect(sent.body.message).toMatchObject({
      token: message.token,
      notification: { title: message.title, body: message.body },
      data: { notification_id: message.notificationId, kind: 'NEW_OFFERS', target_type: 'DELIVERY_LIST' },
      android: { priority: 'HIGH', ttl: '90s', collapse_key: 'new_offers', notification: { channel_id: 'n11_qv' } },
    });
    expect(Object.keys(sent.body.message.data)).not.toContain('target_id');
  });

  it('maps the answers: unregistered or invalid token = INVALID_TOKEN, 5xx/429 = retryable, other 4xx = rejected; no evidence carries the token', async () => {
    const p = provider();
    for (const [status, kind] of [[404, 'INVALID_TOKEN'], [400, 'INVALID_TOKEN'], [503, 'RETRYABLE'], [429, 'RETRYABLE'], [403, 'REJECTED']] as const) {
      plan.push(status);
      const result = await p.send(message, signal());
      expect([status, result.kind]).toEqual([status, kind]);
      expect(JSON.stringify(result)).not.toContain(message.token);
    }
  });

  it('a 401 refreshes the access token once and retries; a second 401 is a retryable authentication failure', async () => {
    const p = provider();
    const before = oauth.length;
    plan.push(401);
    expect(await p.send(message, signal())).toEqual({ kind: 'SENT' });
    expect(oauth.length).toBe(before + 2); // the first token, then one refresh after the 401
    plan.push(401, 401);
    expect(await p.send(message, signal())).toMatchObject({ kind: 'RETRYABLE', code: 'PROVIDER_AUTH' });
  });

  it('an unreadable credential file or a refused OAuth exchange is retryable and says which, never what the file holds', async () => {
    const missing = new FcmPushProvider({ projectId: 'eleven-ship-test', serviceAccountFile: '/nonexistent/sa.json', apiOrigin: origin });
    expect(await missing.send(message, signal())).toMatchObject({ kind: 'RETRYABLE', code: 'CREDENTIAL_UNAVAILABLE' });
    tokenStatus = 400;
    expect(await provider().send(message, signal())).toMatchObject({ kind: 'RETRYABLE', code: 'PROVIDER_AUTH' });
    tokenStatus = 200;
  });

  it('check(): validates the credential, the project and the FCM permission with validate_only, delivering nothing', async () => {
    const p = provider();
    sends.length = 0;
    expect(await p.check(signal())).toEqual({ ok: true });
    expect(sends.at(-1)?.body).toMatchObject({ validate_only: true, message: { topic: 'n11-config-check' } });
    plan.push(404);
    expect(await p.check(signal())).toMatchObject({ ok: false, code: 'PROJECT_NOT_FOUND' });
    plan.push(403);
    expect(await p.check(signal())).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await new FcmPushProvider({ projectId: 'x-project', serviceAccountFile: '/nonexistent/sa.json', apiOrigin: origin }).check(signal())).toMatchObject({ ok: false, code: 'CREDENTIAL_UNAVAILABLE' });
  });

  it('the Android channel id follows sound and vibration (silent still shows the notification)', () => {
    expect([channelId(true, true), channelId(true, false), channelId(false, true), channelId(false, false)]).toEqual(['n11_sv', 'n11_sn', 'n11_qv', 'n11_qn']);
  });
});
