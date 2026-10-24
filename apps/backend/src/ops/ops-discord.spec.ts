import { createServer, IncomingMessage, Server } from 'node:http';
import { afterEach, describe, expect, it } from '@jest/globals';
import { buildDiscordBody, FetchDiscordClient, vnTime } from './ops-discord';
import { isValidDiscordWebhook } from './ops-settings-service';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

describe('M13 Discord message and client', () => {
  it('validates the webhook shape and refuses every other host or form', () => {
    expect(isValidDiscordWebhook(HOOK)).toBe(true);
    for (const bad of ['http://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://evil.example/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', `${HOOK}?x=1`, 'https://user:pw@discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://discord.com.evil.example/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'https://discord.com/api/webhooks/abc/def', '', 'x'])
      expect(isValidDiscordWebhook(bad)).toBe(false);
  });

  it('builds the message from the stored content: severity, source, impact, time, code, link; no mention can fire', () => {
    const body = buildDiscordBody({ kind: 'OPEN', severity: 'CRITICAL', content: { title: 'Gateway mất liên lạc', source: 'SMS Gateway', impact: 'OTP chậm', at: '2026-10-18T06:50:00.000Z', code: 'SC-013', occurrences: 3, link: 'https://admin.example/system-ops/incidents/SC-013' } }, 'production');
    const e = body.embeds[0]!;
    expect(e.title).toContain('[SC-013] Gateway mất liên lạc');
    expect(e.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['Mức độ', 'Nguồn', 'Thời điểm', 'Ảnh hưởng', 'Số lần', 'Mã sự cố', 'Mở sự cố (cần đăng nhập Admin)']));
    expect(e.fields.find((f) => f.name === 'Thời điểm')?.value).toBe('13:50 18/10/2026');
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(vnTime('garbage')).toBe('-');
  });

  it('a recovery message says so and is not red', () => {
    const body = buildDiscordBody({ kind: 'RECOVERY', severity: 'INFO', content: { title: 'Gateway mất liên lạc', source: 'SMS Gateway', at: '2026-10-18T07:00:00.000Z', code: 'SC-013' } }, 'production');
    expect(body.embeds[0]!.fields[0]!.value).toBe('Đã phục hồi');
    expect(body.embeds[0]!.color).not.toBe(0xd92d20);
  });

  describe('FetchDiscordClient against a local stand-in (the only host it will talk to besides Discord)', () => {
    let server: Server | undefined;
    afterEach(() => new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve()))));
    const serve = async (handler: (request: IncomingMessage) => { status: number; headers?: Record<string, string> }): Promise<string> => {
      server = createServer((request, response) => {
        const out = handler(request);
        response.writeHead(out.status, out.headers);
        response.end('{}');
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as { port: number }).port}/api/webhooks/1/x`;
    };
    const body = buildDiscordBody({ kind: 'TEST', severity: 'INFO', content: { title: 't' } }, 'test');
    const client = new FetchDiscordClient({ allowLoopbackHttp: true, timeoutMs: 500 });

    it('maps 2xx, 429 (with Retry-After), 5xx and 4xx to ok / rate limit / transient / permanent', async () => {
      expect(await client.post(await serve(() => ({ status: 204 })), body)).toEqual({ ok: true, status: 204 });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      expect(await client.post(await serve(() => ({ status: 429, headers: { 'retry-after': '7' } })), body)).toMatchObject({ ok: false, code: 'RATE_LIMITED', retryAfterSeconds: 7, permanent: false });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      expect(await client.post(await serve(() => ({ status: 503 })), body)).toMatchObject({ ok: false, code: 'HTTP_503', permanent: false });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      expect(await client.post(await serve(() => ({ status: 404 })), body)).toMatchObject({ ok: false, code: 'HTTP_404', permanent: true });
    });

    it('a dead port is a transient network failure, a redirect is refused, and a non-Discord host is never contacted', async () => {
      expect(await client.post('http://127.0.0.1:9/api/webhooks/1/x', body)).toMatchObject({ ok: false, permanent: false });
      expect(await client.post(await serve(() => ({ status: 302, headers: { location: 'https://evil.example/' } })), body)).toMatchObject({ ok: false });
      expect(await new FetchDiscordClient().post('http://127.0.0.1:1/api/webhooks/1/x', body)).toMatchObject({ ok: false, code: 'URL_INVALID', permanent: true });
      expect(await new FetchDiscordClient().post('https://evil.example/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', body)).toMatchObject({ code: 'URL_INVALID' });
    });
  });
});
