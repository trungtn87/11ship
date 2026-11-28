import { describe, expect, it, jest } from '@jest/globals';
import { OpsEngine } from './ops-engine';
import { OpsIngestService, backupNoticeContent, formatBytes } from './ops-ingest-service';
import { parseBackupBody } from './ops-validation';

// M12-F: a successful off-VPS backup run is announced once on Discord (kind BACKUP_OK, INFO). The notice is keyed by the run, so a repeated report of the same run
// sends nothing; discord off or maintenance on the backup source skips it; a failure keeps the incident path and sends no success notice. The database is a stand-in
// that enforces the same unique dedupe key as app.ops_notifications; nothing is sent to Discord here.

const RUN = '0b7c2f1e-5a2d-4c9e-9f10-1a2b3c4d5e6f';
type Row = { kind: string; severity: string; status: string; skipReason?: string; dedupeKey: string; content: Record<string, unknown> };

function build(o: { discordEnabled?: boolean; webhookConfigured?: boolean; maintenance?: string[][] } = {}) {
  const rows: Row[] = [];
  const keys = new Set<string>();
  const context = { query: async () => ({ rows: [], rowCount: 0 }) };
  const transactions = { withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn(context) };
  const settings = {
    load: async () => ({
      settings: {},
      discordEnabled: o.discordEnabled ?? true,
      discordMinSeverity: 'WARNING',
      webhookConfigured: o.webhookConfigured ?? true,
      row: {},
    }),
  };
  const incidents = {
    activeMaintenance: async () => (o.maintenance ?? []).map((scopes) => ({ scopes, endsAtMs: Date.now() + 3_600_000 })),
    enqueue: async (_c: unknown, n: { kind: string; severity: string; dedupeKey: string; content: Record<string, unknown>; skipReason?: string }) => {
      if (keys.has(n.dedupeKey)) return undefined; // ON CONFLICT (dedupe_key) DO NOTHING
      keys.add(n.dedupeKey);
      const row: Row = { kind: n.kind, severity: n.severity, status: n.skipReason === undefined ? 'PENDING' : 'SKIPPED', dedupeKey: n.dedupeKey, content: n.content, ...(n.skipReason === undefined ? {} : { skipReason: n.skipReason }) };
      rows.push(row);
      return row as never;
    },
  };
  const engine = new OpsEngine({} as never, incidents as never, settings as never, { appEnv: 'test' } as never);
  const observe = jest.spyOn(engine, 'observe').mockResolvedValue(undefined as never);
  const releases = {
    insertBackupReport: async () => undefined,
    backupSummary: async () => ({ latest: null, lastOkAtMs: null, lastOkSizeBytes: null }),
  };
  const repo = { insertEvent: async () => undefined };
  const ingest = new OpsIngestService(transactions as never, repo as never, releases as never, engine, settings as never, { appEnv: 'test' } as never);
  return { ingest, rows, observe };
}

const success = (over: Partial<Parameters<OpsIngestService['backup']>[0]> = {}) => ({
  kind: 'BACKUP' as const,
  ok: true,
  finishedAtMs: Date.parse('2026-11-28T03:10:00Z'),
  sizeBytes: 1536,
  detailCode: null,
  runId: RUN,
  backupKind: 'DAILY' as const,
  ...over,
});

describe('M12-F success notice on Discord', () => {
  it('a verified run sends exactly one INFO notice with time, kind, size and the off-VPS statement', async () => {
    const t = build();
    await t.ingest.backup(success());
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ kind: 'BACKUP_OK', severity: 'INFO', status: 'PENDING', dedupeKey: `backup-ok:${RUN}` });
    expect(t.rows[0]!.content).toMatchObject({ title: 'Sao lưu DAILY thành công', source: 'Sao lưu', at: '2026-11-28T03:10:00.000Z' });
    expect(String(t.rows[0]!.content.detail)).toContain('Dung lượng: 1,5 KB');
    expect(String(t.rows[0]!.content.detail)).toContain('Đã lưu ngoài VPS');
    // no path, no secret, no key in the message
    expect(JSON.stringify(t.rows[0]!.content)).not.toMatch(/\/|passphrase|token|password/i);
  });

  it('the same run reported again sends nothing more', async () => {
    const t = build();
    await t.ingest.backup(success());
    await t.ingest.backup(success());
    expect(t.rows).toHaveLength(1);
  });

  it('with Discord switched off the notice is recorded as skipped (DISABLED), not sent', async () => {
    const t = build({ discordEnabled: false });
    await t.ingest.backup(success());
    expect(t.rows).toEqual([expect.objectContaining({ kind: 'BACKUP_OK', status: 'SKIPPED', skipReason: 'DISABLED' })]);
  });

  it('a webhook that is not configured is skipped the same way as other notices', async () => {
    const t = build({ webhookConfigured: false });
    await t.ingest.backup(success());
    expect(t.rows[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'NOT_CONFIGURED' });
  });

  it('maintenance on the backup source skips the notice', async () => {
    const t = build({ maintenance: [['BACKUP']] });
    await t.ingest.backup(success());
    expect(t.rows[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'MAINTENANCE' });
  });

  it('a failed run sends no success notice and keeps the incident path (engine.observe still runs)', async () => {
    const t = build();
    await t.ingest.backup(success({ ok: false, detailCode: 'DRIVE_QUOTA', sizeBytes: null }));
    expect(t.rows).toHaveLength(0);
    expect(t.observe).toHaveBeenCalledTimes(1);
  });

  it('a restore-test result is never announced as a backup success', async () => {
    const t = build();
    await t.ingest.backup(success({ kind: 'RESTORE_TEST' as never, backupKind: null }));
    expect(t.rows).toHaveLength(0);
  });

  it('a report without a run id is keyed by its own report id, and still gets one notice', async () => {
    const t = build();
    await t.ingest.backup(success({ runId: null, backupKind: null }));
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]!.dedupeKey).toMatch(/^backup-ok:[0-9a-f-]{36}$/);
    expect(t.rows[0]!.content.title).toBe('Sao lưu thành công');
  });
});

describe('M12-F notice helpers and body validation', () => {
  it('sizes read as Vietnamese decimals; an unknown size says so', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
    expect(backupNoticeContent({ finishedAtMs: 0, sizeBytes: null, backupKind: 'WEEKLY' })).toMatchObject({ detail: expect.stringContaining('Dung lượng: không rõ') });
  });

  it('accepts a body without run_id or backup_kind (older reporter) and a valid pair', () => {
    expect(parseBackupBody({ kind: 'BACKUP', ok: true, finished_at: new Date().toISOString() })).toMatchObject({ runId: null, backupKind: null });
    expect(parseBackupBody({ kind: 'BACKUP', ok: true, finished_at: new Date().toISOString(), run_id: RUN, backup_kind: 'WEEKLY' })).toMatchObject({ runId: RUN, backupKind: 'WEEKLY' });
  });

  it('refuses a malformed run id or an unknown backup kind', () => {
    const base = { kind: 'BACKUP', ok: true, finished_at: new Date().toISOString() };
    expect(() => parseBackupBody({ ...base, run_id: 'not-a-uuid' })).toThrow();
    expect(() => parseBackupBody({ ...base, backup_kind: 'WHENEVER' })).toThrow();
  });
});
