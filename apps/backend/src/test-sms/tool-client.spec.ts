import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from '@jest/globals';
import { TestSmsInbox } from './test-sms-inbox';
import { startTestSmsListener, RunningTestSmsListener } from './test-sms-listener';
import { ToolClientError, ToolClientErrorKind, createToolClient } from './tool-client';

// TS05/TS07 (tool client): talks to the REAL listener; also checks fail-closed behaviour against hostile servers.

const TOKEN = 'T'.repeat(43);
const PHONE = '+84901234567';
const stoppers: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (stoppers.length > 0) {
    await (stoppers.pop() as () => Promise<void>)();
  }
});

async function realListener(inbox: TestSmsInbox, now?: () => number): Promise<RunningTestSmsListener> {
  const listener = await startTestSmsListener({ inbox, token: TOKEN, ...(now === undefined ? {} : { now }) });
  stoppers.push(() => listener.stop());
  return listener;
}

async function fakeServer(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stoppers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return (server.address() as AddressInfo).port;
}

async function kindOf(promise: Promise<unknown>): Promise<ToolClientErrorKind | 'NO_ERROR'> {
  try {
    await promise;
    return 'NO_ERROR';
  } catch (error) {
    if (error instanceof ToolClientError) {
      return error.kind;
    }
    throw error;
  }
}

describe('tool client against the real listener', () => {
  it('lists newest first and reads one code on purpose', async () => {
    const inbox = new TestSmsInbox();
    const a = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized: PHONE, otp: '222222' });
    const listener = await realListener(inbox);
    const client = createToolClient({ host: listener.host, port: listener.port, token: TOKEN });
    const items = await client.list();
    expect(items.map((i) => i.purpose)).toEqual(['ADMIN_ACTIVATION', 'REGISTER']);
    expect(JSON.stringify(items)).not.toContain('222222');
    expect(JSON.stringify(items)).not.toContain(PHONE);
    const detail = await client.get(a.messageId);
    expect(detail.otp).toBe('111111');
    expect(detail.phoneNormalized).toBe(PHONE);
  });

  it('filters by purpose and phone', async () => {
    const inbox = new TestSmsInbox();
    inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
    inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized: PHONE, otp: '222222' });
    const listener = await realListener(inbox);
    const client = createToolClient({ host: listener.host, port: listener.port, token: TOKEN });
    expect(await client.list({ purpose: 'REGISTER' })).toHaveLength(1);
    expect(await client.list({ phone: PHONE, limit: 1 })).toHaveLength(1);
  });

  it('maps a wrong token to UNAUTHORIZED, an unknown id to NOT_FOUND, a non-UUID to NOT_FOUND without any request', async () => {
    const listener = await realListener(new TestSmsInbox());
    const wrong = createToolClient({ host: listener.host, port: listener.port, token: 'W'.repeat(43) });
    expect(await kindOf(wrong.list())).toBe('UNAUTHORIZED');
    const client = createToolClient({ host: listener.host, port: listener.port, token: TOKEN });
    expect(await kindOf(client.get('11111111-2222-4333-8444-555555555555'))).toBe('NOT_FOUND');
    expect(await kindOf(client.get('../../etc/passwd'))).toBe('NOT_FOUND');
  });

  it('maps the read quota to RATE_LIMITED with Retry-After', async () => {
    const listener = await realListener(new TestSmsInbox(), () => 1_000);
    const client = createToolClient({ host: listener.host, port: listener.port, token: TOKEN });
    let limited: ToolClientError | undefined;
    for (let i = 0; i < 15; i += 1) {
      try {
        await client.list();
      } catch (error) {
        limited = error as ToolClientError;
        break;
      }
    }
    expect(limited?.kind).toBe('RATE_LIMITED');
    expect(limited?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('a closed port is UNREACHABLE', async () => {
    const listener = await realListener(new TestSmsInbox());
    const { port } = listener;
    await listener.stop();
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port, token: TOKEN }).list())).toBe('UNREACHABLE');
  });
});

describe('tool client against hostile or broken servers (fail closed)', () => {
  const send = (status: number, body: string, headers: Record<string, string> = {}) =>
    (_req: unknown, res: { writeHead(s: number, h: Record<string, string>): void; end(b: string): void }) => {
      res.writeHead(status, headers);
      res.end(body);
    };

  it('refuses a non-loopback host or an invalid port at construction', () => {
    expect(() => createToolClient({ host: '0.0.0.0', port: 1000, token: TOKEN })).toThrow(ToolClientError);
    expect(() => createToolClient({ host: 'localhost', port: 1000, token: TOKEN })).toThrow(ToolClientError);
    expect(() => createToolClient({ host: '127.0.0.1', port: 0, token: TOKEN })).toThrow(ToolClientError);
  });

  it('a redirect, a 500 and non-JSON are BAD_RESPONSE; a redirect is never followed', async () => {
    const redirect = await fakeServer(send(302, '', { Location: 'http://127.0.0.1:1/x' }));
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: redirect, token: TOKEN }).list())).toBe('BAD_RESPONSE');
    const boom = await fakeServer(send(500, '{}'));
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: boom, token: TOKEN }).list())).toBe('BAD_RESPONSE');
    const junk = await fakeServer(send(200, 'not json'));
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: junk, token: TOKEN }).list())).toBe('BAD_RESPONSE');
  });

  it('wrong shapes are BAD_RESPONSE (missing data, unknown purpose, bad id, bad otp, too many items)', async () => {
    const cases: unknown[] = [
      {},
      { data: {} },
      { data: { items: [{ message_id: 'x', purpose: 'REGISTER', phone_masked: '***', received_at: 't' }] } },
      { data: { items: [{ message_id: '11111111-2222-4333-8444-555555555555', purpose: 'EVIL', phone_masked: '***', received_at: 't' }] } },
      { data: { items: new Array(101).fill(null) } },
    ];
    for (const body of cases) {
      const port = await fakeServer(send(200, JSON.stringify(body)));
      expect(await kindOf(createToolClient({ host: '127.0.0.1', port, token: TOKEN }).list())).toBe('BAD_RESPONSE');
    }
    const badOtp = await fakeServer(
      send(200, JSON.stringify({ data: { message_id: '11111111-2222-4333-8444-555555555555', purpose: 'REGISTER', phone_normalized: PHONE, otp: '12', received_at: 't' } })),
    );
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: badOtp, token: TOKEN }).get('11111111-2222-4333-8444-555555555555'))).toBe('BAD_RESPONSE');
  });

  it('an oversized response is BAD_RESPONSE and a silent server is TIMEOUT', async () => {
    const big = await fakeServer(send(200, 'x'.repeat(200_000)));
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: big, token: TOKEN }).list())).toBe('BAD_RESPONSE');
    const silent = await fakeServer(() => undefined);
    expect(await kindOf(createToolClient({ host: '127.0.0.1', port: silent, token: TOKEN, timeoutMs: 150 }).list())).toBe('TIMEOUT');
  });

  it('only GET is ever sent, to the two read routes, with the token in the Authorization header only', async () => {
    const seen: { method?: string; url?: string; auth?: string }[] = [];
    const port = await fakeServer((req, res) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { items: [] } }));
    });
    const client = createToolClient({ host: '127.0.0.1', port, token: TOKEN });
    await client.list({ purpose: 'REGISTER' });
    expect(seen).toEqual([{ method: 'GET', url: '/messages?purpose=REGISTER', auth: `Bearer ${TOKEN}` }]);
    expect(seen[0]?.url).not.toContain(TOKEN);
  });
});
