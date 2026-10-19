import { describe, expect, it } from '@jest/globals';
import { OpsCollector } from './ops-collector';
import { DiscordBody, DiscordClient, DiscordResult } from './ops-discord';
import { defaultSettings } from './ops-settings';
import { OpsSystemProbe } from './ops-system-probe';

// The database outage path of the collector (design section 5: "DB lỗi không báo thành công giả"). The database is a scripted stand-in that can be switched off;
// no real outage is ever created. While it is off nothing can be recorded, so the outage lives in memory, the channel is told DIRECTLY once the configured
// number of consecutive failures is reached, and the whole outage is written as ONE incident with its real start when the database answers again.

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

function build(o: { enabled?: boolean; url?: string | undefined; maintenance?: { scopes: string[]; endsAtMs: number }[] } = {}) {
  const state = { down: false };
  const recorded: Record<string, unknown>[] = [];
  const observed: string[] = [];
  const posts: { url: string; body: DiscordBody }[] = [];
  const logs: string[] = [];
  const context = { query: async () => ({ rows: [], rowCount: 0 }) };
  const transactions = {
    withTransaction: async (fn: (c: unknown) => Promise<unknown>) => {
      if (state.down) throw new Error('connection refused');
      return fn(context);
    },
  };
  const engine = {
    observe: async (_c: unknown, r: { checkKey: string }) => {
      observed.push(r.checkKey);
      return { action: 'NONE' };
    },
    recordOutage: async (_c: unknown, r: Record<string, unknown>) => {
      recorded.push(r);
      return { created: true };
    },
  };
  const settings = {
    load: async () => ({ row: {}, settings: defaultSettings(), discordEnabled: o.enabled ?? true, discordMinSeverity: 'WARNING', webhookConfigured: true }),
    webhookUrl: () => ('url' in o ? o.url : HOOK),
  };
  const repo = { insertMetric: async () => undefined };
  const incidents = { activeMaintenance: async () => (o.maintenance ?? []).map((m) => ({ scopes: m.scopes, endsAtMs: m.endsAtMs })) };
  const discord: DiscordClient = {
    post: async (url, body): Promise<DiscordResult> => {
      posts.push({ url, body });
      return { ok: true, status: 204 };
    },
  };
  const probe = {} as OpsSystemProbe;
  const collector = new OpsCollector(
    transactions as never,
    engine as never,
    repo as never,
    incidents as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { configured: false } as never,
    probe,
    discord,
    { appEnv: 'production', host: '127.0.0.1', port: 1 } as never,
    { log: (_level: string, event: string) => logs.push(event) } as never,
  );
  return { collector, state, recorded, observed, posts, logs };
}

describe('collector: a database outage is never shown as healthy and is recorded with its real start', () => {
  it('announces directly once after three consecutive failures, then writes one incident when the database returns', async () => {
    const t = build();
    await t.collector.collectOnce();
    expect(t.observed).toContain('database');
    t.state.down = true;
    const started = Date.now();
    await t.collector.collectOnce();
    await t.collector.collectOnce();
    expect(t.posts).toHaveLength(0);
    expect(t.collector.outageInMemory).toBe(true);
    await t.collector.collectOnce();
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.url).toBe(HOOK);
    expect(t.posts[0]!.body.embeds[0]!.title).toContain('Database không phản hồi');
    expect(JSON.stringify(t.posts[0]!.body)).not.toContain('SECRET');
    await t.collector.collectOnce();
    expect(t.posts).toHaveLength(1);
    t.observed.length = 0;
    t.state.down = false;
    await t.collector.collectOnce();
    expect(t.collector.outageInMemory).toBe(false);
    expect(t.recorded).toHaveLength(1);
    expect(t.recorded[0]).toMatchObject({ checkKey: 'database', source: 'DATABASE', detectedBy: 'INTERNAL', notifiedBy: 'DIRECT', failures: 4, evidenceCode: 'DB_UNREACHABLE' });
    expect(Math.abs((t.recorded[0]!.firstFailedAtMs as number) - started)).toBeLessThan(2000);
    expect(String(t.recorded[0]!.episodeId)).toMatch(/^db-\d+$/);
    // The check reports OK only after the database answered, never during the outage.
    expect(t.observed).toContain('database');
  });

  it('says nothing to the channel when it is off, has no webhook, or a maintenance window covers the database; the incident is still written', async () => {
    for (const o of [{ enabled: false }, { url: undefined }, { maintenance: [{ scopes: ['DATABASE'], endsAtMs: Date.now() + 60_000 }] }]) {
      const t = build(o);
      await t.collector.collectOnce();
      t.state.down = true;
      for (let i = 0; i < 4; i += 1) await t.collector.collectOnce();
      expect(t.posts).toHaveLength(0);
      t.state.down = false;
      await t.collector.collectOnce();
      expect(t.recorded[0]).toMatchObject({ notifiedBy: null });
    }
  });

  it('a short blip below the threshold leaves no incident and no message', async () => {
    const t = build();
    await t.collector.collectOnce();
    t.state.down = true;
    await t.collector.collectOnce();
    t.state.down = false;
    await t.collector.collectOnce();
    expect(t.posts).toHaveLength(0);
    expect(t.recorded).toHaveLength(0);
  });
});
