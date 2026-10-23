import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, Probe, alertBody, loadConfig } from '../../ops/external-probe/probe.mjs';

// M13.E — the independent probe. Everything runs on loopback stand-ins (the monitored API, Discord, the M13 ingest endpoint) that can be switched on and off, so
// "the API / database / backend are down" is a scripted state, never a real outage. The probe needs none of the backend to alert.

const SECRET_WEBHOOK = 'WEBHOOK-SECRET-VALUE-9f8e7d';
const SECRET_TOKEN = 'INGEST-TOKEN-SECRET-VALUE-1a2b3c';

function stub(handler) {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (c) => (body += c));
    request.on('end', () => {
      const out = handler(request, body);
      if (typeof out?.then === 'function') return; // a stand-in that never answers
      response.writeHead(out.status, out.headers);
      response.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

describe('external probe', () => {
  let dir;
  let api;
  let discord;
  let m13;
  const calls = { discord: [], m13: [] };
  const mode = { api: 200, discord: 204, m13: 200 };
  let clock;
  let n = 0;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'probe-'));
    api = await stub(() => ({ status: mode.api }));
    discord = await stub((request, body) => {
      calls.discord.push(JSON.parse(body));
      return { status: mode.discord };
    });
    m13 = await stub((request, body) => {
      calls.m13.push({ auth: request.headers.authorization, body: JSON.parse(body) });
      return { status: mode.m13 };
    });
  });
  after(() => {
    for (const s of [api, discord, m13]) s.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const fresh = (over = {}) => {
    n += 1;
    calls.discord.length = 0;
    calls.m13.length = 0;
    Object.assign(mode, { api: 200, discord: 204, m13: 200 });
    clock = 1_800_000_000_000;
    const config = loadConfig(
      { target_url: `${api.url}/v1/health/ready`, state_file: join(dir, `state-${n}.json`), m13_ingest_url: `${m13.url}/v1/ops/ingest/probe`, timeout_seconds: 2, ...over },
      { env: { PROBE_DISCORD_WEBHOOK: `${discord.url}/api/webhooks/1/${SECRET_WEBHOOK}`, PROBE_INGEST_TOKEN: SECRET_TOKEN }, testMode: true },
    );
    const logs = [];
    const probe = new Probe(config, { now: () => clock, log: (line) => logs.push(line) });
    const tick = async (advanceMs = 60_000) => {
      clock += advanceMs;
      return probe.tick();
    };
    return { config, probe, tick, logs };
  };

  it('3 failures in a row open one outage and ONE direct Discord message; more failures add nothing; the text names no cause', async () => {
    const { tick } = fresh();
    mode.api = 503;
    await tick();
    await tick();
    assert.equal(calls.discord.length, 0);
    await tick();
    assert.equal(calls.discord.length, 1);
    const e = calls.discord[0].embeds[0];
    assert.match(e.title, /Không truy cập được hệ thống từ bên ngoài/);
    assert.deepEqual(calls.discord[0].allowed_mentions, { parse: [] });
    assert.ok(!/VPS (đã )?(chết|hỏng|tắt)|hết pin|mất điện/i.test(JSON.stringify(e)));
    assert.match(e.description, /chưa phải kết luận VPS đã ngừng/);
    await tick();
    await tick();
    assert.equal(calls.discord.length, 1);
  });

  it('2 successes in a row recover it with ONE message; a single success between failures does not', async () => {
    const { tick, probe } = fresh();
    mode.api = 500;
    for (let i = 0; i < 3; i += 1) await tick();
    mode.api = 200;
    await tick();
    assert.equal(probe.state.status, 'DOWN');
    assert.equal(calls.discord.length, 1);
    mode.api = 500;
    await tick();
    mode.api = 200;
    await tick();
    assert.equal(probe.state.status, 'DOWN');
    await tick();
    assert.equal(probe.state.status, 'UP');
    assert.equal(calls.discord.length, 2);
    assert.match(calls.discord[1].embeds[0].title, /Đã truy cập lại/);
    await tick();
    assert.equal(calls.discord.length, 2);
  });

  it('works with the API refusing connections, the database "down" and the whole backend unreachable: Discord is told, the report waits and is delivered afterwards with the real times', async () => {
    const { tick, probe } = fresh({ target_url: 'http://127.0.0.1:9/v1/health/ready', m13_ingest_url: 'http://127.0.0.1:9/v1/ops/ingest/probe' });
    const first = clock + 60_000;
    for (let i = 0; i < 3; i += 1) await tick();
    assert.equal(calls.discord.length, 1, 'Discord needs nothing from the backend');
    assert.equal(probe.state.outbox.length, 1, 'the outage waits to be reported to M13');
    assert.equal(calls.m13.length, 0);
    // The VPS is back (same probe, same state file): it answers, then M13 is told.
    const config = loadConfig({ target_url: `${api.url}/v1/health/ready`, state_file: probe.config.state_file, m13_ingest_url: `${m13.url}/v1/ops/ingest/probe`, timeout_seconds: 2 }, { env: { PROBE_DISCORD_WEBHOOK: `${discord.url}/api/webhooks/1/${SECRET_WEBHOOK}`, PROBE_INGEST_TOKEN: SECRET_TOKEN }, testMode: true });
    const revived = new Probe(config, { now: () => (clock += 60_000), log: () => undefined });
    await revived.tick();
    await revived.tick();
    const reports = calls.m13.flatMap((c) => c.body.reports ?? []);
    const finished = reports.find((r) => r.recovered_at !== undefined);
    assert.ok(finished, 'the finished outage reached M13');
    assert.equal(finished.notified, true);
    assert.equal(Date.parse(finished.first_failed_at), first);
    assert.ok(finished.failures >= 3);
    assert.match(finished.episode_id, /^ep-/);
    assert.equal(calls.m13[0].auth, `Bearer ${SECRET_TOKEN}`);
    assert.equal(revived.state.outbox.length, 0, 'delivered reports are not sent again');
    assert.equal(calls.discord.length, 2);
  });

  it('a Discord failure does not lose the alert: it is retried, reported to M13 as "not notified" until it works, and never duplicated', async () => {
    const { tick, probe } = fresh();
    mode.api = 503;
    mode.discord = 500;
    for (let i = 0; i < 3; i += 1) await tick();
    assert.equal(probe.state.episode.notified, false);
    assert.equal(calls.m13.at(-1).body.reports[0].notified, false);
    const before = calls.discord.length;
    mode.discord = 204;
    await tick();
    assert.equal(calls.discord.length, before + 1);
    assert.equal(probe.state.episode.notified, true);
    await tick();
    assert.equal(calls.discord.length, before + 1);
  });

  it('restarting does not reset the count or forget an open outage', async () => {
    const { tick, probe, config } = fresh();
    mode.api = 503;
    await tick();
    await tick();
    const again = new Probe(config, { now: () => (clock += 60_000), log: () => undefined });
    assert.equal(again.state.failures, 2);
    await again.tick();
    assert.equal(calls.discord.length, 1);
    const afterRestart = new Probe(config, { now: () => (clock += 60_000), log: () => undefined });
    assert.equal(afterRestart.state.status, 'DOWN');
    await afterRestart.tick();
    assert.equal(calls.discord.length, 1, 'no second alert for the same outage');
    void probe;
  });

  it('only HTTP 200 is success: redirects, 4xx, 5xx and timeouts are failures', async () => {
    const { probe } = fresh();
    for (const status of [301, 302, 401, 404, 500, 503]) {
      mode.api = status;
      assert.deepEqual(await probe.check(), { ok: false, code: `HTTP_${status}` });
    }
    mode.api = 200;
    assert.deepEqual(await probe.check(), { ok: true, code: 'OK' });
    const slow = await stub(() => new Promise(() => undefined));
    const p2 = new Probe(loadConfig({ target_url: `${slow.url}/x`, state_file: join(dir, 'slow.json'), timeout_seconds: 1 }, { env: { PROBE_DISCORD_WEBHOOK: `${discord.url}/api/webhooks/1/x` }, testMode: true }), { log: () => undefined });
    assert.deepEqual(await p2.check(), { ok: false, code: 'TIMEOUT' });
    slow.server.closeAllConnections();
    slow.server.close();
  });

  it('heartbeats M13 at most every interval while the API answers', async () => {
    const { tick } = fresh({ heartbeat_seconds: 300 });
    await tick();
    assert.equal(calls.m13.length, 1);
    assert.deepEqual(calls.m13[0].body.reports, []);
    await tick(60_000);
    await tick(60_000);
    assert.equal(calls.m13.length, 1);
    await tick(240_000);
    assert.equal(calls.m13.length, 2);
  });

  it('is configured safely: https only (loopback only for tests), names of bad settings only, secrets from files or the environment, a Discord-only webhook', () => {
    const base = { target_url: 'https://x.example/v1/health/ready', state_file: '/tmp/s.json', discord_webhook_file: '/w' };
    const ok = (text) => ({ readFile: () => text, env: {} });
    assert.ok(loadConfig(base, ok('https://discord.com/api/webhooks/123/abcDEF_-')));
    for (const [over, name] of [[{ target_url: 'http://x.example/' }, 'target_url'], [{ interval_seconds: 1 }, 'interval_seconds'], [{ failures_to_alert: 0 }, 'failures_to_alert'], [{ state_file: '' }, 'state_file'], [{ environment: 'Prod Env' }, 'environment']]) {
      assert.throws(() => loadConfig({ ...base, ...over }, ok('https://discord.com/api/webhooks/123/abc')), (e) => e instanceof ConfigError && e.names.includes(name));
    }
    assert.throws(() => loadConfig(base, ok('https://evil.example/api/webhooks/123/abc')), (e) => e.names.includes('discord_webhook'));
    assert.throws(() => loadConfig(base, { readFile: () => { throw new Error('nope'); }, env: {} }), (e) => e.names.includes('discord_webhook'));
    assert.throws(() => loadConfig({ ...base, m13_ingest_url: 'https://x.example/ingest' }, ok('https://discord.com/api/webhooks/123/abc')), (e) => e.names.includes('m13_ingest_token'));
    try {
      loadConfig(base, ok('https://evil.example/SECRETVALUE'));
    } catch (e) {
      assert.ok(!e.message.includes('SECRETVALUE'));
    }
  });

  it('never writes the webhook or the token to its log or to its state file', async () => {
    const { tick, logs, config } = fresh();
    mode.api = 503;
    for (let i = 0; i < 4; i += 1) await tick();
    mode.api = 200;
    await tick();
    await tick();
    const everything = JSON.stringify(logs) + readFileSync(config.state_file, 'utf8');
    assert.ok(!everything.includes(SECRET_WEBHOOK));
    assert.ok(!everything.includes(SECRET_TOKEN));
    assert.ok(logs.some((l) => l.event === 'down') && logs.some((l) => l.event === 'recovered'));
  });

  it('the message body is built from measured facts only', () => {
    const body = alertBody('DOWN', { at: 1_800_000_000_000, failures: 3, code: 'TIMEOUT', firstFailedAt: 1_799_999_820_000, episodeId: 'ep-1', environment: 'production' });
    const text = JSON.stringify(body);
    assert.ok(text.includes('TIMEOUT') && text.includes('production') && text.includes('ep-1'));
    assert.deepEqual(body.allowed_mentions, { parse: [] });
    assert.ok(!/token|password|otp/i.test(text));
    writeFileSync(join(dir, 'x'), '');
  });
});
