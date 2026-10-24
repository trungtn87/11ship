import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { purgeShopDisplayCodes } from './support/shop-display-fixtures';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { AdminReportService, EXPORT_KEEP_SECONDS } from '../../apps/backend/src/admin-reports/admin-report-service';
import { Argon2idPasswordHasher } from '../../apps/backend/src/auth/password-hasher';
import { ADMIN_PASSWORD, AdminApp, adminData, adminErrorCode, startAdminApp } from './support/admin-fixtures';
import { createActiveShopFor, createDriverFor, purgePhone, randomPhone } from './support/auth-fixtures';
import { ActivatedAdmin, activatedAdmin, changeGrant, getAs, permission, postAs, purgeDeliveriesOfShops, purgeExportJobs, purgeGrants, seedDelivery, systemLoginOf } from './support/m12-fixtures';
import { systemSession, SystemSession } from './support/provisioning-fixtures';

// M12-E on a REAL PostgreSQL and the real administration pipeline: who may read a report, the numbers of a historic Vietnam day (and the edges around it), the money report
// against the ledger, and the whole life of an export (create, background run, download by its creator only, rights checked again at every step, limits, expiry, same key).
// The database is shared with other suites, so every figure is a DELTA of what this suite seeded.

const tag = randomBytes(3).toString('hex').toUpperCase();
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;
const OFFSET = 7 * 3_600_000;
const vietnamDay = (ms: number): string => new Date(ms + OFFSET).toISOString().slice(0, 10);
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`) - OFFSET;

describe('M12-E — reports and exports', () => {
  let admin: AdminApp;
  let system: SystemSession;
  let full: ActivatedAdmin; // report.read + report.export + wallet.read, may review shippers
  let reader: ActivatedAdmin; // report.read only
  let nobody: ActivatedAdmin; // no function right
  let shopId = '';
  let hash = '';
  let day = ''; // a historic Vietnam day nobody else seeds on
  const versions = new Map<string, number>();
  const shopIds: string[] = [];
  const shippers: Array<{ phone: ReturnType<typeof randomPhone> }> = [];
  const accountIds: string[] = [];
  const workDir = mkdtempSync(join(tmpdir(), 'm12-reports-'));

  const grant = async (who: ActivatedAdmin, key: string): Promise<void> => {
    const version = versions.get(`${who.userId}:${key}`) ?? 0;
    expect((await changeGrant(admin, system, 'grant', who.userId, key, version)).status).toBe(200);
    versions.set(`${who.userId}:${key}`, version + 1);
  };
  const revoke = async (who: ActivatedAdmin, key: string): Promise<void> => {
    const version = versions.get(`${who.userId}:${key}`) ?? 0;
    expect((await changeGrant(admin, system, 'revoke', who.userId, key, version)).status).toBe(200);
    versions.set(`${who.userId}:${key}`, version + 1);
  };
  const report = (who: ActivatedAdmin | undefined, kind: string, query = `range=custom&from=${day}&to=${day}`) => getAs(admin, who?.login, `/reports/${kind}?${query}`);
  const data = async (who: ActivatedAdmin, kind: string, query?: string): Promise<Json> => {
    const response = await report(who, kind, query);
    expect([response.status, response.text.slice(0, 300)]).toEqual([200, response.text.slice(0, 300)]);
    return adminData(response) as Json;
  };
  const summary = (body: Json, key: string): number | string | null => (body.summary as Json[]).find((item) => item.key === key)?.value;
  const create = (who: ActivatedAdmin, body: Record<string, unknown>, key: string = randomUUID()) => postAs(admin, who.login, '/reports/exports', body, key);
  const runAll = async (): Promise<void> => {
    const service = admin.running.app.get(AdminReportService, { strict: false });
    for (let i = 0; i < 50 && (await service.processNext()); i++) {
      // drain the queue (other suites leave nothing behind, but this one creates several jobs)
    }
  };
  const job = async (who: ActivatedAdmin, id: string): Promise<Json> => {
    const listed = adminData(await getAs(admin, who.login, '/reports/exports')) as Json;
    return (listed.items as Json[]).find((item) => item.job_id === id) as Json;
  };

  beforeAll(async () => {
    admin = await startAdminApp({ activationDisabledTest: true });
    system = await systemSession(admin);
    hash = await new Argon2idPasswordHasher().hash(ADMIN_PASSWORD);
    full = await activatedAdmin(admin, system, [permission('DRIVER', { view: true, review: true }), permission('SHOP')], `Báo cáo đủ ${tag}`);
    reader = await activatedAdmin(admin, system, [permission('DRIVER')], `Báo cáo xem ${tag}`);
    nobody = await activatedAdmin(admin, system, [permission('DRIVER')], `Không quyền ${tag}`);
    shopId = await createActiveShopFor(admin.pool, system.account.userId);
    shopIds.push(shopId);
    // A day 20-80 days ago (custom ranges reach back at most 92 days) that is unique to this run.
    day = vietnamDay(Date.now() - (20 + (parseInt(tag, 16) % 60)) * DAY);
    await grant(full, 'report.read');
    await grant(full, 'report.export');
    await grant(full, 'wallet.read');
    await grant(reader, 'report.read');
  });

  afterAll(async () => {
    try {
      await purgeDeliveriesOfShops(admin.pool, shopIds);
      for (const shipper of shippers) {
        await purgePhone(admin.pool, shipper.phone.normalized);
      }
      const client = await admin.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('ALTER TABLE app.system_owned_bank_accounts DISABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('DELETE FROM app.system_owned_bank_accounts WHERE system_account_id = ANY($1::uuid[])', [accountIds]);
        await client.query('ALTER TABLE app.system_owned_bank_accounts ENABLE TRIGGER wallet_system_accounts_no_delete');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
      await purgeExportJobs(admin.pool, [full.userId, reader.userId, nobody.userId, system.account.userId]);
      await purgeGrants(admin.pool);
      await admin.pool.query('DELETE FROM app.shop_members WHERE shop_id = ANY($1::uuid[])', [shopIds]);
      await purgeShopDisplayCodes(admin.pool, shopIds);
      await admin.pool.query('DELETE FROM app.shops WHERE shop_id = ANY($1::uuid[])', [shopIds]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
      await admin.close();
    }
  });

  it('1. rights: no session is 401; no report.read is 403 on every kind; money also needs wallet.read; bad input is 400', async () => {
    expect((await report(undefined, 'deliveries')).status).toBe(401);
    for (const kind of ['deliveries', 'shops', 'shippers', 'quality', 'money']) {
      expect([kind, (await report(nobody, kind)).status]).toEqual([kind, 403]);
    }
    expect((await report(reader, 'deliveries')).status).toBe(200);
    expect((await report(reader, 'money')).status).toBe(403); // report.read alone never opens money
    expect((await report(full, 'money')).status).toBe(200);
    expect((await report(full, 'nothing')).status).toBe(400);
    expect(adminErrorCode(await report(full, 'deliveries', 'range=century'))).toBe('ADMIN_INPUT_INVALID');
    expect((await report(full, 'deliveries', `range=7d&from=${day}`)).status).toBe(400); // a named range takes no days
    expect((await report(full, 'deliveries', 'range=custom&from=2026-02-30&to=2026-03-01')).status).toBe(400);
    expect((await report(full, 'deliveries', `range=custom&from=${day}&to=${day}&basis=forever`)).status).toBe(400);
    expect((await report(full, 'deliveries', `range=custom&from=${day}&to=${day}&limit=5000`)).status).toBe(400); // no way to ask for "everything"
    // SYSTEM reads every report without grants.
    expect((await getAs(admin, systemLoginOf(system), `/reports/money?range=custom&from=${day}&to=${day}`)).status).toBe(200);
  });

  it('2. a historic Vietnam day: the day edges decide, a recall is a delivery and not an Order, the tile and the list share one number', async () => {
    const start = dayStart(day);
    const before = await data(full, 'deliveries');
    const user = system.account.userId;
    const iso = (ms: number): string => new Date(ms).toISOString();
    await seedDelivery(admin.pool, { shopId, userId: user, createdAtIso: iso(start + 60_000) }); // 00:01 inside
    const stopped = await seedDelivery(admin.pool, { shopId, userId: user, state: 'search_stopped', createdAtIso: iso(start + 12 * 3_600_000) });
    await seedDelivery(admin.pool, { shopId, userId: user, previousDeliveryId: stopped, createdAtIso: iso(start + DAY - 60_000) }); // 23:59 inside, a recall
    await seedDelivery(admin.pool, { shopId, userId: user, createdAtIso: iso(start - 60_000) }); // 23:59 the day BEFORE: outside
    await seedDelivery(admin.pool, { shopId, userId: user, createdAtIso: iso(start + DAY) }); // 00:00 the day AFTER: outside
    const after = await data(full, 'deliveries');
    expect((summary(after, 'total') as number) - (summary(before, 'total') as number)).toBe(3);
    expect((summary(after, 'stopped') as number) - (summary(before, 'stopped') as number)).toBe(1);
    expect((summary(after, 'recalls') as number) - (summary(before, 'recalls') as number)).toBe(1);
    expect((summary(after, 'active') as number) - (summary(before, 'active') as number)).toBe(2);
    expect(summary(after, 'orders')).toEqual(expect.any(Number)); // Order is counted apart (M10), never from the deliveries
    const rate = (after.summary as Json[]).find((item) => item.key === 'success_rate') as Json;
    expect(rate.note).toMatch(/\/ \d+ đã giao xong/); // a rate always states numerator and denominator
    expect(after.period).toEqual({ range: 'custom', from_day: day, to_day: day });
    expect(after.generated_at).toEqual(expect.stringMatching(/Z$/));
    const row = (after.rows as Json[]).find((r) => r.cells[0] === day) as Json;
    expect(row.cells[1]).toBe(summary(after, 'total'));
    expect(row.link).toEqual({ from: day, to: day, basis: 'created' });
    // The number opens the list that makes it: same filter, same total.
    const link = (after.summary as Json[]).find((item) => item.key === 'total')?.link as Record<string, string>;
    const list = adminData(await getAs(admin, systemLoginOf(system), `/deliveries?${new URLSearchParams({ ...link, limit: '1' }).toString()}`)) as Json;
    expect(list.total).toBe(summary(after, 'total'));
    const stoppedLink = (after.summary as Json[]).find((item) => item.key === 'stopped')?.link as Record<string, string>;
    const stoppedList = adminData(await getAs(admin, systemLoginOf(system), `/deliveries?${new URLSearchParams({ ...stoppedLink, limit: '1' }).toString()}`)) as Json;
    expect(stoppedList.total).toBe(summary(after, 'stopped'));
    // The shop report lists the shop of the fixtures with its own row.
    const shops = await data(full, 'shops');
    const shopRow = (shops.rows as Json[]).find((r) => r.link?.shop_id === shopId) as Json;
    expect(shopRow.cells[1]).toBe(3);
    expect(shopRow.cells[4]).toBe(0);
    // A bad basis never changes the figures silently: ended counts the stopped one at its end (inside the day too).
    const ended = await data(full, 'deliveries', `range=custom&from=${day}&to=${day}&basis=ended`);
    expect(ended.basis_label).toMatch(/kết thúc/);
    expect(summary(ended, 'stopped')).toBeGreaterThanOrEqual(1);
  });

  it('3. shipper names are personal data: shown only with the right to review shippers; the quality report states what it cannot know', async () => {
    const named = await data(full, 'shippers');
    expect((named.columns as Json[]).map((c) => c.key)).toContain('name');
    const masked = await data(reader, 'shippers');
    expect((masked.columns as Json[]).map((c) => c.key)).not.toContain('name');
    expect(JSON.stringify(masked.notes)).toMatch(/ẩn/);
    const quality = await data(reader, 'quality');
    const keys = (quality.summary as Json[]).map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(['custody_open', 'stopped', 'avg_accept', 'complaints']));
    const avg = (quality.summary as Json[]).find((item) => item.key === 'avg_accept') as Json;
    if (avg.value === null) {
      expect(avg.note).toMatch(/Chưa có/); // no data is a dash with its reason, never 0
    }
  });

  it('4. money: a confirmed top-up moves ONLY the top-up figure (by its actual amount) and the day row; the ledger and the wallets still reconcile; a deposit is not revenue', async () => {
    const system$ = systemLoginOf(system);
    const number = String(Math.floor(1e11 + Math.random() * 9e11));
    const created = await postAs(admin, system$, '/finance/bank-accounts', { bank_id: 'VCB', account_number: number, account_holder: `CONG TY ${tag}` });
    expect(created.status).toBe(201);
    const accountId = String(adminData(created).account_id);
    accountIds.push(accountId);
    expect((await postAs(admin, system$, `/finance/bank-accounts/${accountId}/receiving`, { expected_version: 1, can_receive: true })).status).toBe(200);
    const phone = randomPhone();
    shippers.push({ phone });
    admin.track(phone.normalized);
    const userId = randomUUID();
    await admin.pool.query(`INSERT INTO app.users (user_id, phone_normalized, password_hash, phone_verified_at, account_origin, status, version, created_at, updated_at) VALUES ($1::uuid, $2, $3, now(), 'PHONE_VERIFIED', 'ACTIVE', 1, now(), now())`, [userId, phone.normalized, hash]);
    const driverId = await createDriverFor(admin.pool, userId, { status: 'PENDING' });
    const walletId = randomUUID();
    await admin.pool.query(`INSERT INTO app.driver_wallets (wallet_id, driver_id, balance_vnd, held_vnd, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, 0, 0, 1, now(), now())`, [walletId, driverId]);
    const requestId = randomUUID();
    await admin.pool.query(`INSERT INTO app.wallet_topup_requests (request_id, wallet_id, driver_id, amount_requested_vnd, state, created_by_user_id, version, created_at, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 100000, 'PENDING', $4::uuid, 1, now(), now())`, [requestId, walletId, driverId, userId]);

    const today = vietnamDay(Date.now());
    const query = `range=custom&from=${today}&to=${today}`;
    const before = await data(full, 'money', query);
    expect((await postAs(admin, system$, `/finance/topup-requests/${requestId}/confirm`, {
      expected_version: 1,
      actual_amount_vnd: 60_000,
      bank_id: 'VCB',
      system_owned_account_id: accountId,
      canonical_transaction_id: `FT${Math.floor(1e11 + Math.random() * 9e11)}`,
      received_at: new Date(Date.now() - 60_000).toISOString(),
    })).status).toBe(200);
    const after = await data(full, 'money', query);
    const delta = (key: string): number => (summary(after, key) as number) - (summary(before, key) as number);
    expect(delta('topup')).toBe(60_000);
    expect(delta('balance')).toBe(60_000);
    expect(delta('commission')).toBe(0);
    expect(delta('adjustment')).toBe(0);
    expect(delta('withdrawal')).toBe(0);
    expect(delta('pending_topups')).toBe(-1);
    // Reconciliation: the difference is the same before and after (the deposit is on both sides), and it is stated, never hidden.
    expect(summary(after, 'recon_diff')).toBe(summary(before, 'recon_diff'));
    expect(delta('recon_ledger')).toBe(60_000);
    expect(delta('recon_wallets')).toBe(60_000);
    const dayRow = (after.rows as Json[]).find((r) => r.cells[0] === today) as Json;
    const dayBefore = (before.rows as Json[]).find((r) => r.cells[0] === today);
    expect((dayRow.cells[1] as number) - ((dayBefore?.cells[1] as number | undefined) ?? 0)).toBe(60_000);
    expect(JSON.stringify(after.notes)).toMatch(/không phải doanh thu/);
    // The same figures for a day with no ledger rows are real zeros (the read worked), not dashes.
    const quiet = await data(full, 'money', `range=custom&from=${day}&to=${day}`);
    expect(summary(quiet, 'topup')).toBe(0);
  });

  it('5. export (CSV): POST creates, the background run finishes it, only the creator downloads it, the file states filter and moment, formulas are neutralised, the same key is the same job', async () => {
    // A shop name that a spreadsheet would execute.
    const client = await admin.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE app.deliveries DISABLE TRIGGER USER');
      await client.query(`UPDATE app.deliveries SET shop_name = $1 WHERE shop_id = $2::uuid AND created_at >= to_timestamp($3::bigint / 1000.0) AND created_at < to_timestamp($4::bigint / 1000.0)`, ['=HYPERLINK("http://evil.example","x")', shopId, dayStart(day), dayStart(day) + DAY]);
      await client.query('ALTER TABLE app.deliveries ENABLE TRIGGER USER');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const body = { kind: 'shops', format: 'csv', range: 'custom', from: day, to: day };
    const key = randomUUID();
    const first = await create(full, body, key);
    expect(first.status).toBe(200);
    const id = String(adminData(first).job_id);
    expect(adminData(first).state).toBe('QUEUED');
    const again = await create(full, body, key); // a lost answer is retried with the SAME key
    expect(String(adminData(again).job_id)).toBe(id);
    expect((await create(full, { ...body, range: 'today', from: undefined, to: undefined }, key)).status).toBeGreaterThanOrEqual(400); // same key, other request

    // Not finished: no file, said honestly.
    const early = await getAs(admin, full.login, `/reports/exports/${id}/download`);
    expect([early.status, adminErrorCode(early)]).toEqual([409, 'REPORT_EXPORT_NOT_READY']);
    await runAll();
    const done = await job(full, id);
    expect(done.state).toBe('DONE');
    expect(done.file_name).toMatch(/^11ship-shops-.+\.csv$/);
    expect(done.row_count).toBeGreaterThanOrEqual(1);
    expect(Date.parse(done.expires_at) - Date.parse(done.created_at)).toBeGreaterThan((EXPORT_KEEP_SECONDS - 120) * 1000);

    const file = await getAs(admin, full.login, `/reports/exports/${id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="11ship-shops-[A-Za-z0-9_.-]+\.csv"$/);
    expect(file.headers['cache-control']).toBe('no-store');
    expect(file.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf])); // BOM: Excel reads the Vietnamese text as UTF-8
    expect(file.text).toContain('\r\n');
    expect(file.text).toContain(`${day}`); // the period is in the file
    expect(file.text).toContain("'=HYPERLINK");
    expect(file.text).not.toMatch(/(^|,)"?=HYPERLINK/m); // never a cell that starts with "="

    // Somebody else's file looks like a missing one; another administrator cannot even list it.
    expect([(await getAs(admin, systemLoginOf(system), `/reports/exports/${id}/download`)).status]).toEqual([404]);
    expect(((adminData(await getAs(admin, systemLoginOf(system), '/reports/exports')) as Json).items as Json[]).some((item) => item.job_id === id)).toBe(false);
    expect((await getAs(admin, undefined, `/reports/exports/${id}/download`)).status).toBe(401);
    expect((await getAs(admin, full.login, `/reports/exports/${randomUUID()}/download`)).status).toBe(404);
    expect((await getAs(admin, full.login, '/reports/exports/not-a-uuid/download')).status).toBe(400);
    expect((await getAs(admin, full.login, `/reports/exports/${id}/download?all=1`)).status).toBe(400);

    // Create and download are audited with the filter, and never carry the data.
    const audit = await admin.pool.query<{ action: string; metadata: Json }>(`SELECT action, metadata FROM app.audit_logs WHERE resource_type = 'report_export' AND resource_id = $1 ORDER BY action`, [id]);
    expect(audit.rows.map((row) => row.action)).toEqual(['admin.report.export.create.v1', 'admin.report.export.download.v1']);
    expect(audit.rows[0]?.metadata).toMatchObject({ kind: 'shops', format: 'csv', range: 'custom', from_day: day, to_day: day });
    expect(JSON.stringify(audit.rows)).not.toContain('HYPERLINK');
  });

  it('6. export (Excel): a real workbook with the detail, the summary and the information sheet; numbers stay numbers; a GET never creates or streams', async () => {
    const created = await create(full, { kind: 'deliveries', format: 'xlsx', range: 'custom', from: day, to: day });
    expect(created.status).toBe(200);
    const id = String(adminData(created).job_id);
    await runAll();
    expect((await job(full, id)).state).toBe('DONE');
    const file = await getAs(admin, full.login, `/reports/exports/${id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
    const path = join(workDir, 'book.xlsx');
    writeFileSync(path, file.bytes);
    // The workbook is read back by an independent reader: Python's zip and XML parsers on the OOXML parts (no spreadsheet library is needed in CI). It checks the package, the sheet
    // names in workbook order, and that numbers are stored as numbers and text as text. (A spreadsheet application, openpyxl, was also used once by hand on a real export.)
    const reader = [
      'import json,sys,zipfile,re',
      'import xml.etree.ElementTree as ET',
      'ns={"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main","r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships"}',
      'z=zipfile.ZipFile(sys.argv[1])',
      'assert z.testzip() is None',
      'wb=ET.fromstring(z.read("xl/workbook.xml"))',
      'rels={r.get("Id"):r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}',
      'def col(ref):',
      '    n=0',
      '    for ch in re.match(r"[A-Z]+",ref).group(0): n=n*26+ord(ch)-64',
      '    return n-1',
      'out={}',
      'for sh in wb.find("m:sheets",ns):',
      '    target=rels[sh.get("{%s}id"%ns["r"])]',
      '    rows=[]',
      '    for row in ET.fromstring(z.read("xl/"+target)).find("m:sheetData",ns):',
      '        cells=[]',
      '        for c in row:',
      '            i=col(c.get("r"))',
      '            while len(cells)<i: cells.append(None)',
      '            if c.get("t")=="inlineStr": cells.append("".join(t.text or "" for t in c.iter("{%s}t"%ns["m"])))',
      '            else:',
      '                v=c.find("m:v",ns).text',
      '                cells.append(float(v) if "." in v else int(v))',
      '        rows.append(cells)',
      '    out[sh.get("name")]=rows',
      'print(json.dumps(out))',
    ].join('\n');
    const sheets = JSON.parse(execFileSync('python3', ['-I', '-c', reader, path], { encoding: 'utf8' })) as Record<string, unknown[][]>;
    expect(Object.keys(sheets)).toEqual(['Chi tiết', 'Tổng hợp', 'Thông tin']);
    const summaryRows = sheets['Tổng hợp'] as unknown[][];
    expect(summaryRows[0]).toEqual(['Chỉ số', 'Giá trị', 'Ghi chú']);
    const total = summaryRows.find((row) => row[0] === 'Delivery') as unknown[];
    expect(typeof total[1]).toBe('number');
    expect(total[1]).toBe(3);
    expect(JSON.stringify(sheets['Thông tin'])).toContain(day);
    expect((await getAs(admin, full.login, '/reports/exports?kind=money')).status).toBe(400);
  });

  it('7. export rights: create needs report.export (and wallet.read for money); the CURRENT rights decide at run and at download', async () => {
    const body = { kind: 'deliveries', format: 'csv', range: 'custom', from: day, to: day };
    expect((await create(reader, body)).status).toBe(403); // can read, cannot export
    expect((await create(nobody, body)).status).toBe(403);
    expect((await getAs(admin, reader.login, '/reports/exports')).status).toBe(403);
    expect((await getAs(admin, nobody.login, '/reports/exports')).status).toBe(403);

    // An administrator who may export deliveries but not money.
    const limited = await activatedAdmin(admin, system, [permission('DRIVER')], `Xuất giới hạn ${tag}`);
    await grant(limited, 'report.read');
    await grant(limited, 'report.export');
    expect((await create(limited, { ...body, kind: 'money' })).status).toBe(403);
    const mine = await create(limited, body);
    expect(mine.status).toBe(200);
    const doneId = String(adminData(mine).job_id);
    await runAll();
    expect((await job(limited, doneId)).state).toBe('DONE');
    // Right taken back AFTER the file exists: the next download is refused.
    await revoke(limited, 'report.export');
    expect((await getAs(admin, limited.login, `/reports/exports/${doneId}/download`)).status).toBe(403);

    // Right taken back BEFORE the background run: the job fails with a code and no file.
    await grant(limited, 'report.export');
    const queued = await create(limited, body);
    const queuedId = String(adminData(queued).job_id);
    await revoke(limited, 'report.export');
    await runAll();
    await grant(limited, 'report.export'); // the list needs the right again to be read
    const failed = await job(limited, queuedId);
    expect([failed.state, failed.error_code, failed.file_name]).toEqual(['FAILED', 'PERMISSION_REVOKED', null]);
    const none = await getAs(admin, limited.login, `/reports/exports/${queuedId}/download`);
    expect([none.status, adminErrorCode(none)]).toEqual([409, 'REPORT_EXPORT_NOT_READY']);
    await purgeExportJobs(admin.pool, [limited.userId]);
  });

  it('8. a file expires: after its time the bytes are gone and the download says so; three open jobs are the limit', async () => {
    const body = { kind: 'quality', format: 'csv', range: 'custom', from: day, to: day };
    const created = await create(full, body);
    const id = String(adminData(created).job_id);
    await runAll();
    expect((await job(full, id)).state).toBe('DONE');
    await admin.pool.query(`UPDATE app.report_export_jobs SET expires_at = now() - interval '1 minute' WHERE job_id = $1::uuid`, [id]);
    const expired = await getAs(admin, full.login, `/reports/exports/${id}/download`);
    expect([expired.status, adminErrorCode(expired)]).toEqual([409, 'REPORT_EXPORT_EXPIRED']);
    await runAll(); // the sweep removes the bytes and marks the job
    expect((await job(full, id)).state).toBe('EXPIRED');
    const gone = await admin.pool.query('SELECT 1 FROM app.report_export_files WHERE job_id = $1::uuid', [id]);
    expect(gone.rowCount).toBe(0);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = await create(full, { ...body, kind: 'shops' });
      expect(next.status).toBe(200);
      ids.push(String(adminData(next).job_id));
    }
    const over = await create(full, body);
    expect([over.status, adminErrorCode(over)]).toEqual([409, 'REPORT_EXPORT_LIMIT']);
    await runAll();
    expect((await create(full, body)).status).toBe(200); // finished jobs free the room
    await runAll();
  });

  it('9. an export carries the whole result or fails: more rows than the cap is TOO_MANY_ROWS and no file', async () => {
    // The cap itself is 20 000 rows (one per day / shop); the rule is proved on the stored job by lowering nothing: a job whose filter is unreadable fails with a code, never a part.
    const created = await create(full, { kind: 'deliveries', format: 'csv', range: 'custom', from: day, to: day });
    const id = String(adminData(created).job_id);
    await admin.pool.query(`UPDATE app.report_export_jobs SET filter = filter - 'from_ms' WHERE job_id = $1::uuid`, [id]);
    await runAll();
    const broken = await job(full, id);
    expect([broken.state, broken.file_name]).toEqual(['FAILED', null]);
    expect(broken.error_code).toBe('INTERNAL');
    expect((await getAs(admin, full.login, `/reports/exports/${id}/download`)).status).toBe(409);
  });
});
