#!/usr/bin/env node
// 11Ship — independent external probe (M13.E, design section 6).
//
// It checks the PUBLIC API every 60 seconds from a machine that is NOT the VPS being watched, tells Discord DIRECTLY (it does not use the backend, the database or
// M08), and reports the outage to M13 afterwards, when the VPS answers again. Defaults of the approved design: 3 failures in a row = incident, 2 successes in a row =
// recovery. Pure Node (>= 20), no dependency, no shell, no file outside its own state file. It is NOT activated by being in the repository: it runs only where the
// operator installs it (see ops/runbooks/m13-external-probe-20261018.md). Placing it on the same VPS would not be independent monitoring.
//
// What it says is only what it measured: "the public API could not be reached from outside". It never claims the VPS is down.

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULTS = Object.freeze({ interval_seconds: 60, timeout_seconds: 10, failures_to_alert: 3, successes_to_recover: 2, heartbeat_seconds: 300, environment: 'production' });
const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class ConfigError extends Error {
  constructor(names) {
    super(`Invalid probe configuration: ${names.join(', ')}`);
    this.names = names;
  }
}

/** Validates the configuration. Only the NAMES of bad settings are ever reported; secrets come from files or the environment, never from the JSON. */
export function loadConfig(raw, { readFile = (p) => readFileSync(p, 'utf8'), env = process.env, testMode = false } = {}) {
  const bad = [];
  const cfg = { ...DEFAULTS, ...(raw ?? {}) };
  const urlOk = (value, field) => {
    try {
      const u = new URL(value);
      const loopback = LOOPBACK.has(u.hostname);
      if (!(u.protocol === 'https:' || (u.protocol === 'http:' && loopback && (cfg.allow_http === true || testMode))) || u.username !== '' || u.password !== '') bad.push(field);
    } catch {
      bad.push(field);
    }
  };
  urlOk(cfg.target_url, 'target_url');
  if (cfg.m13_ingest_url !== undefined && cfg.m13_ingest_url !== '') urlOk(cfg.m13_ingest_url, 'm13_ingest_url');
  const num = (field, min, max) => {
    if (!Number.isInteger(cfg[field]) || cfg[field] < min || cfg[field] > max) bad.push(field);
  };
  num('interval_seconds', 10, 3600);
  num('timeout_seconds', 1, 60);
  num('failures_to_alert', 1, 20);
  num('successes_to_recover', 1, 20);
  num('heartbeat_seconds', 60, 3600);
  if (typeof cfg.environment !== 'string' || !/^[a-z][a-z0-9_-]{0,15}$/.test(cfg.environment)) bad.push('environment');
  if (typeof cfg.state_file !== 'string' || cfg.state_file === '' || cfg.state_file.includes('\0')) bad.push('state_file');
  const secret = (field, envName, fileField) => {
    const fromEnv = env[envName];
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
    const file = cfg[fileField];
    if (typeof file === 'string' && file !== '') {
      try {
        const text = readFile(file).trim();
        if (text !== '') return text;
      } catch {
        // reported below
      }
    }
    bad.push(field);
    return undefined;
  };
  const webhook = secret('discord_webhook', 'PROBE_DISCORD_WEBHOOK', 'discord_webhook_file');
  if (webhook !== undefined && !testMode) {
    try {
      const u = new URL(webhook);
      if (u.protocol !== 'https:' || !DISCORD_HOSTS.includes(u.hostname) || !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname) || u.search !== '') bad.push('discord_webhook');
    } catch {
      bad.push('discord_webhook');
    }
  }
  // The M13 link is optional (the probe works and alerts without it); both settings must be given together.
  const hasIngest = (cfg.m13_ingest_url ?? '') !== '';
  const token = hasIngest ? secret('m13_ingest_token', 'PROBE_INGEST_TOKEN', 'm13_ingest_token_file') : undefined;
  if (bad.length > 0) throw new ConfigError([...new Set(bad)]);
  return Object.freeze({ ...cfg, discord_webhook: webhook, m13_ingest_token: token });
}

const vn = (ms) => {
  const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hour12: false }).formatToParts(new Date(ms));
  const g = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('hour')}:${g('minute')} ${g('day')}/${g('month')}/${g('year')}`;
};

export function alertBody(kind, o) {
  const down = kind === 'DOWN';
  return {
    username: '11Ship giám sát ngoài',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: down ? '🔴 Không truy cập được hệ thống từ bên ngoài' : '🟢 Đã truy cập lại được hệ thống từ bên ngoài',
        description: down ? 'Giám sát ngoài VPS không gọi được API công khai. Đây chưa phải kết luận VPS đã ngừng.' : 'API công khai đã trả lời bình thường trở lại.',
        color: down ? 0xd92d20 : 0x12b76a,
        fields: [
          { name: 'Mức độ', value: down ? 'Nghiêm trọng' : 'Đã phục hồi', inline: true },
          { name: 'Nguồn', value: 'Giám sát ngoài VPS', inline: true },
          { name: 'Thời điểm', value: vn(o.at), inline: true },
          { name: down ? 'Ảnh hưởng' : 'Thời gian gián đoạn', value: down ? `App và Web Admin có thể không dùng được từ Internet (${o.failures} lần kiểm tra liên tiếp thất bại, mã ${o.code}).` : `Từ ${vn(o.firstFailedAt)} đến ${vn(o.at)}.`, inline: false },
          { name: 'Môi trường', value: o.environment, inline: true },
        ],
        timestamp: new Date(o.at).toISOString(),
        footer: { text: `11Ship • ${o.environment} • ${o.episodeId}` },
      },
    ],
  };
}

const emptyState = () => ({ status: 'UP', failures: 0, successes: 0, streakStartedAt: null, episode: null, outbox: [], lastHeartbeatAt: 0 });

/**
 * The probe. Every effect is injected (fetch, clock, file access, log) so the tests drive it without a network, a real clock or a real Discord.
 */
export class Probe {
  #state;
  constructor(config, { fetchFn = fetch, now = () => Date.now(), readFile = (p) => readFileSync(p, 'utf8'), writeFile = writeAtomic, log = (line) => process.stdout.write(`${JSON.stringify(line)}\n`) } = {}) {
    this.config = config;
    this.fetchFn = fetchFn;
    this.now = now;
    this.log = log;
    this.writeFile = writeFile;
    this.#state = emptyState();
    try {
      const saved = JSON.parse(readFile(config.state_file));
      if (saved && typeof saved === 'object' && (saved.status === 'UP' || saved.status === 'DOWN') && Array.isArray(saved.outbox)) this.#state = { ...emptyState(), ...saved };
    } catch {
      // first start, or an unreadable file: start clean (a probe that cannot trust its state must not invent an outage)
    }
  }

  get state() {
    return JSON.parse(JSON.stringify(this.#state));
  }

  #save() {
    this.writeFile(this.config.state_file, JSON.stringify(this.#state));
  }

  async #request(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout_seconds * 1000);
    try {
      return await this.fetchFn(url, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** One check of the public API. Only HTTP 200 is success: a timeout, a refused connection, a 3xx, a 4xx and a 5xx are all "not reachable as expected". */
  async check() {
    try {
      const response = await this.#request(this.config.target_url, { method: 'GET' });
      return response.status === 200 ? { ok: true, code: 'OK' } : { ok: false, code: `HTTP_${response.status}` };
    } catch (error) {
      return { ok: false, code: error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' };
    }
  }

  async #discord(kind, ep, at) {
    try {
      const response = await this.#request(this.config.discord_webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alertBody(kind, { at, failures: ep.failures, code: ep.code, firstFailedAt: ep.firstFailedAt, episodeId: ep.id, environment: this.config.environment })),
      });
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  async tick() {
    const s = this.#state;
    const at = this.now();
    const result = await this.check();
    if (result.ok) {
      s.successes += 1;
      if (s.status === 'UP') {
        s.failures = 0;
        s.streakStartedAt = null;
      } else if (s.successes >= this.config.successes_to_recover && s.episode !== null) {
        s.status = 'UP';
        s.failures = 0;
        s.episode.recoveredAt = s.recoveryStartedAt ?? at;
        s.episode.recoveredNotified = await this.#discord('UP', s.episode, at);
        this.log({ event: 'recovered', episode: s.episode.id, notified: s.episode.recoveredNotified });
        this.#queue(s.episode);
        s.episode = null;
        s.recoveryStartedAt = null;
      } else if (s.successes === 1) {
        s.recoveryStartedAt = at;
      }
    } else {
      s.successes = 0;
      s.recoveryStartedAt = null;
      s.failures += 1;
      if (s.streakStartedAt === null) s.streakStartedAt = at;
      if (s.status === 'UP' && s.failures >= this.config.failures_to_alert) {
        s.status = 'DOWN';
        s.episode = { id: `ep-${at}-${randomBytes(3).toString('hex')}`, firstFailedAt: s.streakStartedAt, failures: s.failures, code: result.code, notified: false, recoveredAt: null, recoveredNotified: false };
        s.episode.notified = await this.#discord('DOWN', s.episode, at);
        this.log({ event: 'down', episode: s.episode.id, notified: s.episode.notified });
        this.#queue(s.episode);
      } else if (s.status === 'DOWN' && s.episode !== null) {
        s.episode.failures = s.failures;
        s.episode.code = result.code;
        // One message per outage: if the first one did not reach Discord, it is tried again (no other message is ever added).
        if (!s.episode.notified) s.episode.notified = await this.#discord('DOWN', s.episode, at);
      }
    }
    this.#save();
    await this.#sync(result.ok, at);
    this.#save();
    return { ok: result.ok, status: s.status };
  }

  #queue(episode) {
    const s = this.#state;
    s.outbox = s.outbox.filter((e) => e.id !== episode.id);
    s.outbox.push({ ...episode });
  }

  /** Tells M13 about finished (and the running) outage when the VPS answers; a failed sync is normal while the VPS is down and is simply tried again. */
  async #sync(reachable, at) {
    const c = this.config;
    if (!c.m13_ingest_url) return;
    const s = this.#state;
    // The running outage is refreshed in the outbox so a sync after a long outage carries the latest count.
    if (s.episode !== null) this.#queue(s.episode);
    const due = at - s.lastHeartbeatAt >= c.heartbeat_seconds * 1000;
    if (s.outbox.length === 0 && !(reachable && due)) return;
    const body = {
      reported_at: new Date(at).toISOString(),
      reports: s.outbox.map((e) => ({ episode_id: e.id, first_failed_at: new Date(e.firstFailedAt).toISOString(), failures: Math.max(1, e.failures), code: String(e.code).replace(/[^A-Z0-9_]/g, '_').slice(0, 32) || 'UNKNOWN', notified: e.notified === true && (e.recoveredAt === null || e.recoveredNotified === true), ...(e.recoveredAt === null ? {} : { recovered_at: new Date(e.recoveredAt).toISOString() }) })),
    };
    try {
      const response = await this.#request(c.m13_ingest_url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.m13_ingest_token}` }, body: JSON.stringify(body) });
      if (response.status === 200) {
        s.lastHeartbeatAt = at;
        // Finished outages are now in M13; the running one stays until it recovers.
        s.outbox = s.outbox.filter((e) => e.recoveredAt === null);
        this.log({ event: 'synced', reports: body.reports.length });
      } else {
        this.log({ event: 'sync_refused', status: response.status });
      }
    } catch {
      // expected while the VPS is down
    }
  }
}

function writeAtomic(path, text) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
}

async function main(argv) {
  const at = argv.indexOf('--config');
  const path = at === -1 ? undefined : argv[at + 1];
  if (path === undefined) {
    process.stderr.write('Usage: node probe.mjs --config <config.json> [--once] [--check-config]\n');
    return 2;
  }
  let config;
  try {
    config = loadConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch (error) {
    process.stderr.write(`${error instanceof ConfigError ? error.message : 'Configuration file unreadable'}\n`);
    return 1;
  }
  if (argv.includes('--check-config')) {
    process.stdout.write('configuration ok\n');
    return 0;
  }
  const probe = new Probe(config);
  if (argv.includes('--once')) {
    const r = await probe.tick();
    return r.ok ? 0 : 3;
  }
  let stop = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => (stop = true));
  while (!stop) {
    const started = Date.now();
    await probe.tick().catch(() => undefined);
    const wait = Math.max(1000, config.interval_seconds * 1000 - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
