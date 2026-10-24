import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Pool, PoolClient } from 'pg';
import { AdminApp, adminData, adminErrorCode, sessionCookies, startAdminApp } from './support/admin-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, permission, postAs, purgeGrants, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-F on a REAL PostgreSQL and the real administration pipeline: the audit viewer (rights, filters, cursor, redaction, nothing writes), the backup history with its honest health,
// and SYSTEM's restore requests (only a verified backup, one open request at a time, idempotent, audited; nothing is restored by the application).

const tag = randomBytes(3).toString('hex');
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOUR = 3_600_000;

async function withTriggerLifted<T>(pool: Pool, tables: readonly string[], work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of tables) {
      await client.query(`ALTER TABLE app.${table} DISABLE TRIGGER USER`);
    }
    const result = await work(client);
    for (const table of tables) {
      await client.query(`ALTER TABLE app.${table} ENABLE TRIGGER USER`);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe('M12-F — audit viewer, backup history, restore requests', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let reader: ActivatedAdmin; // audit.read only
  let other: ActivatedAdmin; // no function right
  const mine = `m12f.t${tag}`;

  const clearBackups = (): Promise<void> =>
    withTriggerLifted(admin.pool, ['backup_jobs', 'restore_requests', 'backup_records'], async (client) => {
      await client.query('DELETE FROM app.backup_jobs');
      await client.query('DELETE FROM app.restore_requests');
      await client.query('DELETE FROM app.backup_records');
    });

  const backup = async (spec: { state?: string; startedAgoMs?: number; verified?: boolean; offsite?: boolean; kind?: string; encrypted?: boolean; stage?: string; trigger?: string; error?: string }): Promise<string> => {
    const id = randomUUID();
    const state = spec.state ?? 'SUCCEEDED';
    const ago = spec.startedAgoMs ?? HOUR;
    const verified = spec.verified ?? true;
    await admin.pool.query(
      `INSERT INTO app.backup_records (backup_id, kind, state, started_at, finished_at, size_bytes, sha256, schema_version, encrypted, offsite, verified_at, verify_note, error_code, stage, trigger_kind, offsite_verified_at, failed_stage)
       VALUES ($1::uuid, $2, $3, now() - $4::int * interval '1 millisecond', ${state === 'RUNNING' ? 'NULL' : `now() - $4::int * interval '1 millisecond' + interval '1 minute'`}, ${state === 'SUCCEEDED' ? '123456' : 'NULL'}, ${state === 'SUCCEEDED' ? `repeat('a', 64)` : 'NULL'},
               ${state === 'SUCCEEDED' ? `'1795996800000_create-m12-backup-restore'` : 'NULL'}, $5, $6, ${verified ? `now() - $4::int * interval '1 millisecond' + interval '2 minutes'` : 'NULL'}, 'test', ${state === 'FAILED' ? `'${spec.error ?? 'DUMP_FAILED'}'` : 'NULL'}, $7, $8,
               ${spec.offsite ? `now() - $4::int * interval '1 millisecond' + interval '3 minutes'` : 'NULL'}, ${state === 'FAILED' ? `'${spec.stage ?? 'STARTED'}'` : 'NULL'})`,
      [id, spec.kind ?? 'DAILY', state, ago, spec.encrypted ?? true, spec.offsite ?? false, spec.stage ?? (spec.offsite ? 'VERIFIED' : state === 'SUCCEEDED' ? 'LOCAL' : 'STARTED'), spec.trigger ?? 'TIMER'],
    );
    return id;
  };

  const systemLogin = (): ReturnType<typeof systemLoginOf> => systemLoginOf(system);
  const audit = (who: { cookie: string; csrf: string } | undefined, query = ''): ReturnType<typeof getAs> => getAs(admin, who, `/audit${query}`);
  const health = async (): Promise<Json> => (adminData(await getAs(admin, systemLogin(), '/backups')) as Json).health;

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    reader = await activatedAdmin(admin, system, [permission('DRIVER')], `Đọc nhật ký ${tag}`);
    other = await activatedAdmin(admin, system, [permission('DRIVER')], `Không quyền nhật ký ${tag}`);
    expect((await changeGrant(admin, system, 'grant', reader.userId, 'audit.read', 0)).status).toBe(200);
    await clearBackups();
  });

  afterAll(async () => {
    try {
      await clearBackups();
      await purgeGrants(admin.pool);
    } finally {
      await admin.close();
    }
  });

  it('1. audit rights: no session 401; no audit.read 403 (report.read does not open it); audit.read or SYSTEM 200; the filters are closed', async () => {
    expect((await audit(undefined)).status).toBe(401);
    expect((await audit(other.login)).status).toBe(403);
    expect((await audit(reader.login)).status).toBe(200);
    expect((await audit(systemLogin())).status).toBe(200);
    for (const bad of ['?limit=0', '?limit=101', '?limit=abc', '?outcome=MAYBE', '?from=2026-01-01', '?from=2026-01-02&to=2026-01-01', '?action=Admin.Report', '?action=%25', '?request_id=nope', '?cursor=junk', '?unknown=1', '?from=2026-01-01&to=2026-12-31', '?resource_type=a;b']) {
      expect([bad, (await audit(systemLogin(), bad)).status]).toEqual([bad, 400]);
    }
  });

  it('2. a row is found by every filter; a secret-looking value is never shown; the viewer wrote nothing; the cursor walks the list once', async () => {
    const requestId = randomUUID();
    const insert = (n: number, outcome: string, metadata: Json, actor = `actor-${tag}`): Promise<unknown> =>
      admin.pool.query(
        `INSERT INTO app.audit_logs (audit_id, occurred_at, request_id, actor_type, actor_id, action, resource_type, resource_id, resource_version, outcome, reason_code, metadata)
         VALUES (gen_random_uuid(), now() - $1::int * interval '1 second', $2::uuid, 'ADMIN', $3, $4, 'm12f_probe', $5, 1, $6, $7, $8::jsonb)`,
        [n, requestId, actor, `${mine}.probe.v1`, `res-${tag}`, outcome, outcome === 'SUCCESS' ? null : 'PROBE_REASON', JSON.stringify(metadata)],
      );
    await insert(1, 'SUCCESS', { note: 'ok', api_key: 'sk-live-should-never-show', nested: { password: 'p@ss', fine: 1 }, long: 'x'.repeat(400) });
    await insert(2, 'DENIED', { note: 'denied' });
    await insert(3, 'FAILURE', { note: 'failed' });
    await insert(4, 'SUCCESS', { note: 'other actor' }, `other-${tag}`);
    const countBefore = (await admin.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs WHERE action = $1', [`${mine}.probe.v1`])).rows[0]?.n;

    const byAction = adminData(await audit(systemLogin(), `?action=${mine}.probe&limit=100`)) as Json;
    expect((byAction.items as Json[]).length).toBe(4);
    expect((byAction.items as Json[]).map((item) => item.outcome)).toEqual(['SUCCESS', 'DENIED', 'FAILURE', 'SUCCESS']); // newest first
    const first = (byAction.items as Json[])[0] as Json;
    expect(first.metadata.api_key).toBe('[đã ẩn]');
    expect(first.metadata.nested.password).toBe('[đã ẩn]');
    expect(first.metadata.nested.fine).toBe(1);
    expect(first.metadata.long.length).toBeLessThan(310);
    expect(JSON.stringify(byAction)).not.toContain('sk-live-should-never-show');
    expect(JSON.stringify(byAction)).not.toContain('p@ss');

    const count = async (query: string): Promise<number> => ((adminData(await audit(systemLogin(), `?action=${mine}.probe&limit=100&${query}`)) as Json).items as Json[]).length;
    expect(await count(`actor_id=actor-${tag}`)).toBe(3);
    expect(await count('outcome=DENIED')).toBe(1);
    expect(await count(`resource_type=m12f_probe&resource_id=res-${tag}`)).toBe(4);
    expect(await count(`request_id=${requestId}`)).toBe(4);
    expect(await count(`request_id=${randomUUID()}`)).toBe(0);
    expect(await count('outcome=FAILURE&actor_id=nobody')).toBe(0);
    // A prefix is a prefix: "_" and "%" are literal, never wildcards.
    expect(((adminData(await audit(systemLogin(), `?action=${mine}_probe`)) as Json).items as Json[]).length).toBe(0);

    // The cursor: pages of 2 walk the 4 rows exactly once.
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const page = adminData(await audit(systemLogin(), `?action=${mine}.probe&limit=2${cursor === '' ? '' : `&cursor=${cursor}`}`)) as Json;
      seen.push(...(page.items as Json[]).map((item) => item.audit_id as string));
      if (page.next_cursor === null) {
        break;
      }
      cursor = page.next_cursor as string;
    }
    expect(seen.length).toBe(4);
    expect(new Set(seen).size).toBe(4);

    // Reading changes nothing, and no route edits or deletes the log.
    expect((await admin.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.audit_logs WHERE action = $1', [`${mine}.probe.v1`])).rows[0]?.n).toBe(countBefore);
    for (const method of ['POST', 'DELETE', 'PUT'] as const) {
      const response = await admin.call(method as 'GET' | 'POST', `/audit/${first.audit_id}`, { basePath: '/v1/admin', cookies: sessionCookies(systemLogin()), csrf: systemLogin().csrf });
      expect([method, response.status]).toEqual([method, 404]);
    }
    // The window: yesterday does not contain a row of "now minus seconds" (unless the clock just crossed midnight, then the row is in today instead of yesterday).
    const today = new Date(Date.now() + 7 * HOUR).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + 7 * HOUR - 24 * HOUR).toISOString().slice(0, 10);
    const old = (adminData(await audit(systemLogin(), `?action=${mine}.probe&from=${yesterday}&to=${yesterday}`)) as Json).items as Json[];
    const todays = (adminData(await audit(systemLogin(), `?action=${mine}.probe&from=${today}&to=${today}`)) as Json).items as Json[];
    expect(old.length + todays.length).toBe(4);
  });

  it('3. the backup page is SYSTEM only and its health is honest at every stage', async () => {
    expect((await getAs(admin, reader.login, '/backups')).status).toBe(403); // audit.read does not open backups
    expect((await getAs(admin, undefined, '/backups')).status).toBe(401);
    expect((await getAs(admin, systemLogin(), '/backups?all=1')).status).toBe(400);

    const none = await health();
    expect([none.state, none.last_verified_at]).toEqual(['NONE', null]);
    // Failed, running, unverified and unencrypted backups never count.
    await backup({ state: 'FAILED', verified: false });
    await backup({ state: 'RUNNING', verified: false });
    expect((await health()).state).toBe('NONE');
    const page = adminData(await getAs(admin, systemLogin(), '/backups')) as Json;
    expect((page.items as Json[]).every((item) => item.restorable === false)).toBe(true);
    expect(page.policy).toMatchObject({ keep_daily: 7, keep_weekly: 4, offsite_required: true, encrypted_required: true });

    await backup({ offsite: false });
    expect((await health()).state).toBe('NOT_OFFSITE'); // verified here, but a copy only on the VPS is not safe
    await backup({ offsite: true, startedAgoMs: 40 * HOUR });
    expect((await health()).state).toBe('STALE'); // an off-VPS copy exists but it is old
    await backup({ offsite: true, startedAgoMs: 2 * HOUR });
    const ok = await health();
    expect(ok.state).toBe('OK');
    expect(ok.last_verified_at).toEqual(expect.stringMatching(/Z$/));

    // The database itself refuses a "successful" backup that was not verified, encrypted or measured.
    await expect(admin.pool.query(`INSERT INTO app.backup_records (backup_id, kind, state, started_at, finished_at, size_bytes, sha256, schema_version, encrypted, verified_at) VALUES (gen_random_uuid(), 'DAILY', 'SUCCEEDED', now(), now(), 10, repeat('b', 64), 'x', true, NULL)`)).rejects.toThrow(/backup_records_success_ck/);
    await expect(admin.pool.query(`INSERT INTO app.backup_records (backup_id, kind, state, started_at, finished_at, size_bytes, sha256, schema_version, encrypted, verified_at) VALUES (gen_random_uuid(), 'DAILY', 'SUCCEEDED', now(), now(), 10, repeat('b', 64), 'x', false, now())`)).rejects.toThrow(/backup_records_success_ck/);
    await expect(admin.pool.query('DELETE FROM app.backup_records')).rejects.toThrow(/never deleted/);
  });

  it('4. restore requests: SYSTEM only, a verified backup only, a reason, one open at a time, the same key is the same request, cancel is checked, everything is audited, nothing is restored', async () => {
    await clearBackups();
    const good = await backup({ offsite: true, startedAgoMs: HOUR });
    const unverified = await backup({ verified: false, state: 'FAILED' });
    const reason = `Khôi phục thử nghiệm ${tag}`;
    const request = (who: { cookie: string; csrf: string }, body: Json, key?: string) => postAs(admin, who, '/restore-requests', body, key);

    expect((await request(reader.login, { backup_id: good, reason })).status).toBe(403);
    expect((await request(other.login, { backup_id: good, reason })).status).toBe(403);
    for (const bad of [{}, { backup_id: good }, { backup_id: 'x', reason }, { backup_id: good, reason: 'ngắn' }, { backup_id: good, reason: 'x'.repeat(501) }, { backup_id: good, reason, extra: 1 }, { backup_id: good, reason: `bad\u0000${reason}` }]) {
      expect([JSON.stringify(bad).slice(0, 40), (await request(systemLogin(), bad as Json)).status]).toEqual([JSON.stringify(bad).slice(0, 40), 400]);
    }
    expect(adminErrorCode(await request(systemLogin(), { backup_id: randomUUID(), reason }))).toBe('RESTORE_BACKUP_NOT_FOUND');
    expect(adminErrorCode(await request(systemLogin(), { backup_id: unverified, reason }))).toBe('RESTORE_BACKUP_NOT_USABLE');

    const key = randomUUID();
    const first = await request(systemLogin(), { backup_id: good, reason }, key);
    expect(first.status).toBe(200);
    const firstData = adminData(first) as Json;
    expect([firstData.state, firstData.version, firstData.backup_id]).toEqual(['REQUESTED', 1, good]);
    expect(((adminData(await request(systemLogin(), { backup_id: good, reason }, key))) as Json).request_id).toBe(firstData.request_id); // a lost answer, retried
    const second = await request(systemLogin(), { backup_id: good, reason: `${reason} lần hai` });
    expect([second.status, adminErrorCode(second)]).toEqual([409, 'RESTORE_REQUEST_OPEN']);
    expect((await admin.pool.query<{ n: string }>('SELECT count(*)::text AS n FROM app.restore_requests')).rows[0]?.n).toBe('1');

    // The page shows it; nothing about the data changed (no restore happens in the application).
    const page = adminData(await getAs(admin, systemLogin(), '/backups')) as Json;
    expect((page.restore_requests as Json[])[0]).toMatchObject({ request_id: firstData.request_id, state: 'REQUESTED', reason });
    expect((page.items as Json[]).find((item) => item.backup_id === good)?.restorable).toBe(true);

    // Cancel: only with the version that was seen, only by SYSTEM, once.
    const cancel = (who: { cookie: string; csrf: string }, version: number) => postAs(admin, who, `/restore-requests/${firstData.request_id}/cancel`, { expected_version: version });
    expect((await cancel(reader.login, 1)).status).toBe(403);
    expect(adminErrorCode(await cancel(systemLogin(), 2))).toBe('RESTORE_REQUEST_STATE_CONFLICT');
    expect((await postAs(admin, systemLogin(), `/restore-requests/${randomUUID()}/cancel`, { expected_version: 1 })).status).toBe(404);
    expect((await postAs(admin, systemLogin(), '/restore-requests/nope/cancel', { expected_version: 1 })).status).toBe(400);
    const cancelled = await cancel(systemLogin(), 1);
    expect(cancelled.status).toBe(200);
    expect((adminData(cancelled) as Json).state).toBe('CANCELLED');
    expect(adminErrorCode(await cancel(systemLogin(), 2))).toBe('RESTORE_REQUEST_STATE_CONFLICT'); // already cancelled

    // Two requests at once, different keys: the unique index lets exactly one in.
    const [a, b] = await Promise.all([request(systemLogin(), { backup_id: good, reason: `${reason} A` }), request(systemLogin(), { backup_id: good, reason: `${reason} B` })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const logged = await admin.pool.query<{ action: string }>(`SELECT action FROM app.audit_logs WHERE resource_type = 'restore_request' AND metadata ->> 'backup_id' = $1 ORDER BY action`, [good]);
    expect(logged.rows.map((row) => row.action).filter((value, index, all) => all.indexOf(value) === index)).toEqual(['admin.restore.cancel.v1', 'admin.restore.request.v1']);
    // Never deleted.
    await expect(admin.pool.query('DELETE FROM app.restore_requests')).rejects.toThrow(/never deleted/);
  });

  it('5. "Sao lưu ngay": SYSTEM only, one job at a time, the same key is the same job, a running backup also blocks it, audited, and it starts no process', async () => {
    await clearBackups();
    const run = (who: { cookie: string; csrf: string }, key?: string, body: unknown = {}) => postAs(admin, who, '/backups/run', body, key);
    expect((await run(reader.login)).status).toBe(403);
    expect((await run(other.login)).status).toBe(403);
    expect((await postAs(admin, systemLogin(), '/backups/run', { kind: 'DAILY' })).status).toBe(400); // no input is accepted
    const key = randomUUID();
    const first = await run(systemLogin(), key);
    expect(first.status).toBe(200);
    const job = adminData(first) as Json;
    expect([job.state, job.backup_id]).toEqual(['QUEUED', null]);
    expect(((adminData(await run(systemLogin(), key))) as Json).job_id).toBe(job.job_id); // a lost answer, retried
    const second = await run(systemLogin());
    expect([second.status, adminErrorCode(second)]).toEqual([409, 'BACKUP_RUN_OPEN']);
    const twice = await Promise.all([run(systemLogin()), run(systemLogin())]);
    expect(twice.map((r) => r.status)).toEqual([409, 409]);
    expect((await admin.pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.backup_jobs WHERE state IN ('QUEUED', 'RUNNING')`)).rows[0]?.n).toBe('1');
    const page = adminData(await getAs(admin, systemLogin(), '/backups')) as Json;
    expect(page.job).toMatchObject({ job_id: job.job_id, state: 'QUEUED' });
    expect(page.policy).toMatchObject({ schedule_time: '03:00', schedule_timezone: 'Asia/Ho_Chi_Minh', before_deploy: true });
    expect((await admin.pool.query(`SELECT 1 FROM app.audit_logs WHERE action = 'admin.backup.run.v1' AND resource_id = $1`, [job.job_id])).rowCount).toBe(1);

    // The job runner (the operating team's service, owner role) finishes it; then another may be queued, and a backup that is RUNNING blocks it too.
    await withTriggerLifted(admin.pool, ['backup_jobs'], async (client) => {
      await client.query(`UPDATE app.backup_jobs SET state = 'DONE', finished_at = now() WHERE job_id = $1::uuid`, [job.job_id]);
    });
    await backup({ state: 'RUNNING', verified: false });
    const blocked = await run(systemLogin());
    expect([blocked.status, adminErrorCode(blocked)]).toEqual([409, 'BACKUP_RUN_OPEN']);
    await clearBackups();
    expect((await run(systemLogin())).status).toBe(200);
    // The application role can queue and read a job but never change or delete one.
    await expect(admin.pool.query('DELETE FROM app.backup_jobs')).rejects.toThrow(/never deleted/);
  });

  it('6. the page tells the steps apart: made on the VPS, failed with its cause, verified outside the VPS; the latest of each is named', async () => {
    await clearBackups();
    const offsite = await backup({ offsite: true, startedAgoMs: 30 * HOUR, kind: 'DAILY', trigger: 'TIMER' });
    const localNewer = await backup({ state: 'FAILED', startedAgoMs: 2 * HOUR, verified: true, stage: 'LOCAL', error: 'DRIVE_QUOTA' });
    const page = adminData(await getAs(admin, systemLogin(), '/backups')) as Json;
    const find = (id: string): Json => (page.items as Json[]).find((item) => item.backup_id === id) as Json;
    expect(find(offsite)).toMatchObject({ state: 'SUCCEEDED', stage: 'VERIFIED', offsite: true });
    expect(find(localNewer)).toMatchObject({ state: 'FAILED', stage: 'LOCAL', failed_stage: 'LOCAL', error_code: 'DRIVE_QUOTA', offsite: false });
    expect(page.latest_offsite_at).toEqual(expect.stringMatching(/Z$/));
    expect(Date.parse(page.latest_offsite_at as string)).toBeLessThan(Date.now() - 20 * HOUR);
    expect((await health()).state).toBe('STALE');
    // The database does not let a copy be called "outside the VPS" without the verified step.
    await expect(admin.pool.query(`INSERT INTO app.backup_records (backup_id, kind, state, started_at, finished_at, size_bytes, sha256, schema_version, encrypted, verified_at, offsite, stage) VALUES (gen_random_uuid(), 'DAILY', 'SUCCEEDED', now(), now(), 10, repeat('b', 64), 'x', true, now(), true, 'LOCAL')`)).rejects.toThrow(/backup_records_offsite_ck/);
  });

  it('7. the configuration hub states the fixed backup rules for every administrator and exposes no backup data', async () => {
    const groups = adminData(await getAs(admin, other.login, '/config/groups')) as Json;
    const storage = (groups.groups as Json[]).find((group) => group.key === 'storage_backup') as Json;
    expect(storage.fixed_rules.map((rule: Json) => rule.key)).toEqual(['backup_daily', 'backup_keep_daily', 'backup_keep_weekly', 'backup_pre_migration', 'backup_offsite', 'backup_verified']);
    expect(storage.fixed_rules.find((rule: Json) => rule.key === 'backup_keep_daily').value).toBe(7);
    expect(JSON.stringify(storage)).not.toContain('sha256');
  });
});
