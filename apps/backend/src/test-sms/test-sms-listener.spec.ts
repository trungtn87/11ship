import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it } from '@jest/globals';
import { TestSmsInbox } from './test-sms-inbox';
import { RunningTestSmsListener, maskPhone, startTestSmsListener } from './test-sms-listener';

// TS06: missing/wrong token, Origin, extra queries/methods, quota, purge/cap, and no OTP in the list or anywhere else.
// Real HTTP against the real listener on 127.0.0.1; the clock is injected so the quota is deterministic.

const PHONE = '+84901234567';
const OTHER = '+84912345678';

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
  readonly json: { data?: Record<string, unknown>; error?: { code: string; message: string; details: object } };
}

function request(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Reply['json'] = {};
          try {
            json = JSON.parse(text) as Reply['json'];
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('TestSmsListener', () => {
  const running: RunningTestSmsListener[] = [];
  afterEach(async () => {
    while (running.length > 0) {
      await running.pop()?.stop();
    }
  });

  async function boot(
    configure: (inbox: TestSmsInbox) => void = () => undefined,
  ): Promise<{ port: number; token: string; inbox: TestSmsInbox; time: { now: number }; auth: Record<string, string> }> {
    const time = { now: 1_800_000_000_000 };
    const inbox = new TestSmsInbox({ now: () => time.now });
    configure(inbox);
    const token = randomBytes(32).toString('base64url');
    const listener = await startTestSmsListener({ inbox, token, now: () => time.now });
    running.push(listener);
    return { port: listener.port, token, inbox, time, auth: { Authorization: `Bearer ${token}` } };
  }

  it('binds to 127.0.0.1 on an OS-assigned port', async () => {
    const { port } = await boot();
    expect(port).toBeGreaterThan(1023);
    const probe = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        resolve('connected');
        socket.destroy();
      });
      socket.on('error', reject);
    });
    expect(probe).toBe('connected');
  });

  it('lists metadata newest first: never the code and never the unmasked phone', async () => {
    const { port, auth } = await boot((inbox) => {
      inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
      inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized: OTHER, otp: '222222' });
    });
    const reply = await request(port, { path: '/messages', headers: auth });
    expect(reply.status).toBe(200);
    const items = (reply.json.data as { items: Record<string, string>[] }).items;
    expect(items.map((item) => item.purpose)).toEqual(['ADMIN_ACTIVATION', 'REGISTER']);
    expect(Object.keys(items[0] as object).sort()).toEqual(['channel', 'message_id', 'phone_masked', 'purpose', 'received_at']);
    expect(items[0]?.phone_masked).toBe('*********678');
    expect(items[0]?.channel).toBe('SIMULATED_SMS');
    expect(reply.text).not.toContain('222222');
    expect(reply.text).not.toContain('111111');
    expect(reply.text).not.toContain('912345678');
    expect(reply.text).not.toContain('phone_normalized');
    expect(reply.text).not.toContain('otp');
  });

  it('returns the code only from the detail route, with the normalized phone', async () => {
    let id = '';
    const { port, auth } = await boot((inbox) => {
      id = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '135790' }).messageId;
    });
    const reply = await request(port, { path: `/messages/${id}`, headers: auth });
    expect(reply.status).toBe(200);
    expect(reply.json.data).toEqual({
      message_id: id,
      purpose: 'REGISTER',
      phone_normalized: PHONE,
      otp: '135790',
      received_at: new Date(1_800_000_000_000).toISOString(),
      channel: 'SIMULATED_SMS',
    });
  });

  it('filters by purpose, by phone (VN normalizer) and limit', async () => {
    const { port, auth } = await boot((inbox) => {
      inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '111111' });
      inbox.append({ purpose: 'ADMIN_ACTIVATION', phoneNormalized: PHONE, otp: '222222' });
      inbox.append({ purpose: 'REGISTER', phoneNormalized: OTHER, otp: '333333' });
    });
    const byPurpose = await request(port, { path: '/messages?purpose=REGISTER', headers: auth });
    expect((byPurpose.json.data as { items: unknown[] }).items).toHaveLength(2);
    const byPhone = await request(port, { path: `/messages?phone=${encodeURIComponent('0901234567')}`, headers: auth });
    expect((byPhone.json.data as { items: unknown[] }).items).toHaveLength(2);
    const plusPhone = await request(port, { path: `/messages?phone=${encodeURIComponent(OTHER)}`, headers: auth });
    expect((plusPhone.json.data as { items: unknown[] }).items).toHaveLength(1);
    const limited = await request(port, { path: '/messages?limit=1', headers: auth });
    expect((limited.json.data as { items: unknown[] }).items).toHaveLength(1);
    const both = await request(port, { path: `/messages?purpose=ADMIN_ACTIVATION&phone=${encodeURIComponent(PHONE)}&limit=20`, headers: auth });
    expect((both.json.data as { items: unknown[] }).items).toHaveLength(1);
  });

  it('answers 401 for a missing, malformed or wrong token and reveals nothing about resources before auth', async () => {
    const { port, token, time } = await boot();
    const wrong = randomBytes(32).toString('base64url');
    for (const headers of [
      {},
      { Authorization: 'Bearer' },
      { Authorization: `Bearer ${wrong}` },
      { Authorization: `Basic ${token}` },
      { Authorization: `bearer ${token}` },
      { Authorization: `Bearer ${token}x` },
      { Authorization: `Bearer ${token.slice(0, 42)}` },
    ] as Record<string, string>[]) {
      const reply = await request(port, { path: '/messages', headers });
      expect([reply.status, reply.json.error?.code]).toEqual([401, 'UNAUTHORIZED']);
    }
    // An unknown path or a bad id without a token is still 401, not 404/400: nothing leaks before auth.
    time.now += 60_000; // refill the small unauthenticated budget
    expect((await request(port, { path: '/nothing' })).status).toBe(401);
    expect((await request(port, { path: '/messages/not-a-uuid' })).status).toBe(401);
    expect((await request(port, { path: '/messages?bad=1' })).status).toBe(401);
  });

  it('refuses ANY request with an Origin header (a browser, including "null"), even with the valid token', async () => {
    const { port, auth } = await boot();
    for (const origin of ['https://evil.example', 'http://127.0.0.1:3000', 'null', '']) {
      const reply = await request(port, { path: '/messages', headers: { ...auth, Origin: origin } });
      expect([reply.status, reply.json.error?.code]).toEqual([403, 'FORBIDDEN']);
      expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    }
    const noToken = await request(port, { path: '/messages', headers: { Origin: 'null' } });
    expect(noToken.status).toBe(403);
  });

  it('answers a CORS preflight with 403 and never sets a CORS header', async () => {
    const { port } = await boot();
    const reply = await request(port, {
      method: 'OPTIONS',
      path: '/messages',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    expect(reply.status).toBe(403);
    expect(Object.keys(reply.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });

  it('allows GET only: every other method is 405 with Allow: GET (after the token proved)', async () => {
    const { port, auth } = await boot();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const reply = await request(port, { method, path: '/messages', headers: auth });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe('GET');
    }
  });

  it('has no purge, delete, send or mutation route: those paths are not found', async () => {
    const { port, auth, time } = await boot();
    for (const path of ['/messages/purge', '/purge', '/send', '/messages/send', '/clear', '/', '/messages/', '/messages/../messages', '/v1/messages']) {
      time.now += 1000;
      const reply = await request(port, { path, headers: auth });
      expect([400, 404]).toContain(reply.status);
      expect(reply.status === 200).toBe(false);
    }
    time.now += 1000;
    const sendLike = await request(port, { method: 'POST', path: '/send', headers: auth, body: '{}' });
    expect(sendLike.status).toBe(405);
  });

  it('rejects extra, duplicate, empty and malformed query parameters with 400', async () => {
    const { port, auth, time } = await boot();
    const bad = [
      '/messages?foo=1',
      '/messages?limit=1&limit=2',
      '/messages?purpose=REGISTER&purpose=REGISTER',
      '/messages?limit=0',
      '/messages?limit=21',
      '/messages?limit=-1',
      '/messages?limit=01',
      '/messages?limit=1.5',
      '/messages?limit=',
      '/messages?limit=abc',
      '/messages?purpose=LOGIN',
      '/messages?purpose=register',
      '/messages?purpose=',
      '/messages?phone=123',
      '/messages?phone=%2B1555',
      '/messages?phone=',
      '/messages?phone=%E0%A4%A',
      '/messages?&',
      '/messages?=1',
      '/messages?limit=1&',
      '/messages?limit',
    ];
    for (const path of bad) {
      time.now += 1000;
      const reply = await request(port, { path, headers: auth });
      expect([path, reply.status, reply.json.error?.code]).toEqual([path, 400, 'BAD_REQUEST']);
    }
    time.now += 1000;
    expect((await request(port, { path: '/messages?', headers: auth })).status).toBe(200);
    time.now += 1000;
    expect((await request(port, { path: '/messages?limit=20', headers: auth })).status).toBe(200);
  });

  it('validates the message id: canonical lower-case UUID, no query, 404 for unknown, 400 for malformed', async () => {
    let id = '';
    const { port, auth, time } = await boot((inbox) => {
      id = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '123456' }).messageId;
    });
    expect((await request(port, { path: `/messages/${id}`, headers: auth })).status).toBe(200);
    time.now += 5000;
    expect((await request(port, { path: `/messages/${id}?x=1`, headers: auth })).status).toBe(400);
    expect((await request(port, { path: `/messages/${id}?`, headers: auth })).status).toBe(400);
    expect((await request(port, { path: `/messages/${id.toUpperCase()}`, headers: auth })).status).toBe(400);
    expect((await request(port, { path: '/messages/12345', headers: auth })).status).toBe(400);
    expect((await request(port, { path: `/messages/${id}/extra`, headers: auth })).status).toBe(400);
    const unknown = await request(port, { path: '/messages/00000000-0000-4000-8000-000000000000', headers: auth });
    expect([unknown.status, unknown.json.error?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('answers 404 once the message was purged by retention, and never lists it again', async () => {
    let id = '';
    const { port, auth, time } = await boot((inbox) => {
      id = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '123456' }).messageId;
    });
    expect((await request(port, { path: `/messages/${id}`, headers: auth })).status).toBe(200);
    time.now += 10 * 60 * 1000;
    expect((await request(port, { path: `/messages/${id}`, headers: auth })).status).toBe(404);
    const list = await request(port, { path: '/messages', headers: auth });
    expect((list.json.data as { items: unknown[] }).items).toHaveLength(0);
  });

  it('never lists more than 20 and respects the 100 message cap', async () => {
    const { port, auth, inbox } = await boot((target) => {
      for (let index = 0; index < 130; index += 1) {
        target.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: String(100000 + index) });
      }
    });
    expect(inbox.size()).toBe(100);
    const reply = await request(port, { path: '/messages', headers: auth });
    expect((reply.json.data as { items: unknown[] }).items).toHaveLength(20);
  });

  it('rejects any request body on GET (content-length or chunked)', async () => {
    const { port, auth } = await boot();
    const withBody = await request(port, { path: '/messages', headers: { ...auth, 'Content-Length': '2' }, body: '{}' });
    expect(withBody.status).toBe(400);
    const chunked = await request(port, { path: '/messages', headers: { ...auth, 'Transfer-Encoding': 'chunked' }, body: '{}' });
    expect(chunked.status).toBe(400);
  });

  it('bounds the URL: an over-long URL is 400, never unlimited input', async () => {
    const { port, auth } = await boot();
    const reply = await request(port, { path: `/messages?phone=${'1'.repeat(3000)}`, headers: auth });
    expect(reply.status).toBe(400);
  });

  it('applies the read quota: burst of 10, then 429 with a typed Retry-After, and tokens come back at 1/second', async () => {
    const { port, auth, time } = await boot();
    for (let index = 0; index < 10; index += 1) {
      expect((await request(port, { path: '/messages', headers: auth })).status).toBe(200);
    }
    const limited = await request(port, { path: '/messages', headers: auth });
    expect([limited.status, limited.json.error?.code]).toEqual([429, 'TOO_MANY_REQUESTS']);
    expect(limited.headers['retry-after']).toBe('1');
    time.now += 1000;
    expect((await request(port, { path: '/messages', headers: auth })).status).toBe(200);
    expect((await request(port, { path: '/messages', headers: auth })).status).toBe(429);
  });

  it('bounds unauthenticated abuse separately: invalid tokens get 429 after a small budget and never use the token quota', async () => {
    const { port, auth } = await boot();
    const wrong = { Authorization: `Bearer ${randomBytes(32).toString('base64url')}` };
    const statuses: number[] = [];
    for (let index = 0; index < 14; index += 1) {
      statuses.push((await request(port, { path: '/messages', headers: wrong })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10).every((status) => status === 429)).toBe(true);
    // The flood did not spend the valid token's own quota.
    expect((await request(port, { path: '/messages', headers: auth })).status).toBe(200);
  });

  it('sets no-store on every response and closes the connection; never redirects', async () => {
    const { port, auth } = await boot();
    for (const reply of [
      await request(port, { path: '/messages', headers: auth }),
      await request(port, { path: '/messages' }),
      await request(port, { path: '/messages?x=1', headers: auth }),
      await request(port, { method: 'POST', path: '/messages', headers: auth }),
      await request(port, { path: '/nothing', headers: auth }),
    ]) {
      expect(reply.headers['cache-control']).toBe('no-store, no-cache');
      expect(reply.headers.pragma).toBe('no-cache');
      expect(reply.headers['content-type']).toContain('application/json');
      expect(reply.headers.connection).toBe('close');
      expect(reply.status >= 300 && reply.status < 400).toBe(false);
      expect(reply.headers.location).toBeUndefined();
    }
  });

  it('never echoes the token, the Authorization header or an OTP in an error body', async () => {
    let id = '';
    const { port, token } = await boot((inbox) => {
      id = inbox.append({ purpose: 'REGISTER', phoneNormalized: PHONE, otp: '246810' }).messageId;
    });
    const replies = [
      await request(port, { path: '/messages', headers: { Authorization: `Bearer ${token}x` } }),
      await request(port, { path: `/messages/${id}`, headers: { Authorization: `Bearer ${randomBytes(32).toString('base64url')}` } }),
      await request(port, { path: '/messages', headers: { Origin: 'null', Authorization: `Bearer ${token}` } }),
    ];
    for (const reply of replies) {
      expect(reply.text).not.toContain(token);
      expect(reply.text).not.toContain('246810');
      expect(reply.text).not.toContain('Bearer');
      expect(Object.keys(reply.json)).toEqual(['error']);
      expect(Object.keys(reply.json.error ?? {}).sort()).toEqual(['code', 'details', 'message']);
    }
  });

  it('stops listening on stop(): the port refuses connections afterwards', async () => {
    const { port } = await boot();
    const listener = running.pop() as RunningTestSmsListener;
    await listener.stop();
    const outcome = await new Promise<string>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.on('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
    });
    expect(outcome).toBe('ECONNREFUSED');
  });
});

describe('maskPhone', () => {
  it('keeps only the last three characters and masks the rest with *', () => {
    expect(maskPhone('+84901234567')).toBe('*********567');
    expect(maskPhone('+84901234567')).toHaveLength('+84901234567'.length);
  });
});
