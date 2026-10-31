import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminData, adminErrorCode, AdminResponse } from './support/admin-fixtures';
import { dataOf } from './support/auth-fixtures';
import { AdminLogin, Json, M11World, Shipper } from './support/m11-harness';

// The money side of a commission adjustment on the REAL wallet package (M04): the Administration decides, the wallet package posts. The ledger gets exactly
// one row per decision, a repeat never moves the money twice, a charge never touches the money held for a delivery or makes the wallet negative, and M11
// itself writes nothing to the wallet.

describe('M11 + M04 — commission adjustment posted by the wallet package', () => {
  let w: M11World;
  let system: AdminLogin;
  let shipper: Shipper;

  beforeAll(async () => {
    w = await M11World.start({ admin: true, realFinance: true });
    system = w.systemLogin();
    shipper = await w.newShipper(50_000);
  });
  afterAll(async () => {
    await w.close();
  });

  const data = (r: AdminResponse): Json => {
    expect([r.status, r.text.slice(0, 300)]).toEqual([200, r.text.slice(0, 300)]);
    return adminData(r) as Json;
  };
  const q = (sql: string, values: unknown[] = []): Promise<Json[]> => w.app.pool.query(sql, values).then((r) => r.rows as Json[]);

  async function openMoneyFile(): Promise<{ id: string; version: number }> {
    const deliveryId = await w.completed(shipper);
    const created = await w.asShop('POST', '/shop/me/complaints', { category: 'MONEY_FEE', body: 'Hoa hồng sai', delivery_id: deliveryId });
    expect(created.status).toBe(201);
    const c = (dataOf(created).complaint as Json);
    const id = String(c.complaint_id);
    data(await w.adminPost(system, `/complaints/${id}/actions/receive`, { expected_version: Number(c.version) }));
    const detail = data(await w.adminGet(system, `/complaints/${id}`));
    return { id, version: Number((detail.complaint as Json).version) };
  }
  const adjust = async (file: { id: string }, over: Json = {}, key?: string): Promise<AdminResponse> => {
    const detail = data(await w.adminGet(system, `/complaints/${file.id}`));
    return w.adminPost(system, `/complaints/${file.id}/actions/adjust-commission`, { expected_version: Number((detail.complaint as Json).version), direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, reason: 'Hoàn hoa hồng', history_reviewed: false, ...over }, key);
  };

  it('a refund is posted once: one ledger row, the balance goes up once, a retry with the same key moves nothing', async () => {
    const file = await openMoneyFile();
    const before = await w.wallet(shipper);
    const ledger = await w.ledgerCount(shipper);
    const key = randomUUID();
    const first = await adjust(file, {}, key);
    expect(((data(first).adjustments as Json[])[0] as Json)).toMatchObject({ kind: 'COMMISSION', direction: 'REFUND_TO_SHIPPER', amount_vnd: 1000, status: 'EXECUTED', pending_reason: null });
    expect(await w.wallet(shipper)).toEqual({ balance: before.balance + 1000, held: before.held });
    expect(await w.ledgerCount(shipper)).toBe(ledger + 1);
    const rows = await q(`SELECT l.entry_kind, l.delta_vnd::int AS delta FROM app.wallet_ledger_entries l JOIN app.wallet_adjustments a ON a.adjustment_id = l.adjustment_id WHERE a.wallet_id = $1::uuid ORDER BY l.sequence_no DESC LIMIT 1`, [shipper.walletId]);
    expect(rows[0]).toEqual({ entry_kind: 'ADJUSTMENT_CREDIT', delta: 1000 });
    // The same request again (same key) replays; a different key on the same file is refused by the file's own state: the money moves once either way.
    await adjust(file, {}, key);
    expect(await w.ledgerCount(shipper)).toBe(ledger + 1);
    expect(await w.wallet(shipper)).toEqual({ balance: before.balance + 1000, held: before.held });
    expect(await q('SELECT 1 FROM app.wallet_adjustments WHERE source_id IN (SELECT adjustment_id FROM app.complaint_adjustments WHERE complaint_id = $1::uuid)', [file.id])).toHaveLength(1);
  });

  it('a charge takes only available money: a wallet that cannot pay waits for finance and loses nothing; a charge within the available money is posted', async () => {
    const poor = await w.newShipper(2_000);
    const deliveryId = await w.completed(poor);
    const created = await w.asShop('POST', '/shop/me/complaints', { category: 'MONEY_FEE', body: 'Thu thêm', delivery_id: deliveryId });
    const c = (dataOf(created).complaint as Json);
    const id = String(c.complaint_id);
    data(await w.adminPost(system, `/complaints/${id}/actions/receive`, { expected_version: Number(c.version) }));
    const before = await w.wallet(poor);
    const ledger = await w.ledgerCount(poor);
    const refused = await adjust({ id }, { direction: 'CHARGE_TO_SHIPPER', amount_vnd: before.balance - before.held + 1 });
    expect(((data(refused).adjustments as Json[])[0] as Json)).toMatchObject({ status: 'PENDING_FINANCE', pending_reason: 'INSUFFICIENT_BALANCE' });
    expect(await w.wallet(poor)).toEqual(before);
    expect(await w.ledgerCount(poor)).toBe(ledger);

    const rich = await openMoneyFile();
    const walletBefore = await w.wallet(shipper);
    const charged = await adjust(rich, { direction: 'CHARGE_TO_SHIPPER', amount_vnd: 700 });
    expect(((data(charged).adjustments as Json[])[0] as Json)).toMatchObject({ direction: 'CHARGE_TO_SHIPPER', status: 'EXECUTED' });
    expect(await w.wallet(shipper)).toEqual({ balance: walletBefore.balance - 700, held: walletBefore.held });
  });

  // ---- PENDING_FINANCE: the same adjustment is retried (G11 / #219) --------------------------------------------------------------

  async function pendingCharge(funds: number): Promise<{ shipper: Shipper; id: string; adjustmentId: string; amount: number }> {
    const poor = await w.newShipper(funds);
    const deliveryId = await w.completed(poor);
    const created = await w.asShop('POST', '/shop/me/complaints', { category: 'MONEY_FEE', body: 'Thu thêm', delivery_id: deliveryId });
    const c = dataOf(created).complaint as Json;
    const id = String(c.complaint_id);
    data(await w.adminPost(system, `/complaints/${id}/actions/receive`, { expected_version: Number(c.version) }));
    const wallet = await w.wallet(poor);
    const amount = wallet.balance - wallet.held + 1;
    const refused = data(await adjust({ id }, { direction: 'CHARGE_TO_SHIPPER', amount_vnd: amount }));
    const row = (refused.adjustments as Json[])[0] as Json;
    expect(row).toMatchObject({ status: 'PENDING_FINANCE', pending_reason: 'INSUFFICIENT_BALANCE' });
    expect(refused.can).toContain('retry-commission');
    return { shipper: poor, id, adjustmentId: String(row.adjustment_id), amount };
  }
  const retry = async (id: string, over: Json = {}, key?: string): Promise<AdminResponse> => {
    const detail = data(await w.adminGet(system, `/complaints/${id}`));
    return w.adminPost(system, `/complaints/${id}/actions/retry-commission`, { expected_version: Number((detail.complaint as Json).version), reason: 'Shipper đã nạp thêm', ...over }, key);
  };
  const pendingOf = async (s: Shipper): Promise<number> => Number(((await q(`SELECT count(*)::int AS n FROM app.complaint_adjustments WHERE driver_id = $1::uuid AND status = 'PENDING_FINANCE'`, [s.driverId]))[0] as Json).n);

  it('retry of a charge that is still unpayable keeps the SAME record waiting; once the wallet can pay it executes that record exactly once, even after the file was resolved', async () => {
    const f = await pendingCharge(2_000);
    expect(await pendingOf(f.shipper)).toBe(1);
    const before = await w.wallet(f.shipper);
    const ledger = await w.ledgerCount(f.shipper);

    // Still not enough: the attempt is recorded, nothing moves, the wallet is not negative.
    const again = data(await retry(f.id));
    expect((again.adjustments as Json[])).toHaveLength(1);
    expect(((again.adjustments as Json[])[0] as Json)).toMatchObject({ adjustment_id: f.adjustmentId, status: 'PENDING_FINANCE', pending_reason: 'INSUFFICIENT_BALANCE' });
    expect(await w.wallet(f.shipper)).toEqual(before);
    expect(await w.ledgerCount(f.shipper)).toBe(ledger);
    expect(await pendingOf(f.shipper)).toBe(1);

    // The file is concluded meanwhile: the money obligation stays reachable.
    const detail = data(await w.adminGet(system, `/complaints/${f.id}`));
    const concluded = data(await w.adminPost(system, `/complaints/${f.id}/actions/conclude`, { expected_version: Number((detail.complaint as Json).version), conclusion: 'Đã xem xét' }));
    expect((concluded.complaint as Json).status).toBe('RESOLVED');
    expect(concluded.can).toContain('retry-commission');

    await w.topUp(f.shipper, 10_000);
    const funded = await w.wallet(f.shipper);
    const done = data(await retry(f.id));
    expect((done.complaint as Json).status).toBe('RESOLVED');
    expect((done.adjustments as Json[])).toHaveLength(1);
    expect(((done.adjustments as Json[])[0] as Json)).toMatchObject({ adjustment_id: f.adjustmentId, direction: 'CHARGE_TO_SHIPPER', amount_vnd: f.amount, status: 'EXECUTED', pending_reason: null });
    expect(done.can).not.toContain('retry-commission');
    expect(await w.wallet(f.shipper)).toEqual({ balance: funded.balance - f.amount, held: funded.held });
    expect(await w.ledgerCount(f.shipper)).toBe(ledger + 1 + 1);
    expect(await q('SELECT 1 FROM app.wallet_adjustments WHERE source_type = $2 AND source_id = $1::uuid', [f.adjustmentId, 'COMPLAINT'])).toHaveLength(1);
    expect(await pendingOf(f.shipper)).toBe(0);

    // A third press finds nothing waiting: refused, and the money does not move twice.
    expect(adminErrorCode(await retry(f.id))).toBe('COMPLAINT_STATE_CONFLICT');
    expect(await w.wallet(f.shipper)).toEqual({ balance: funded.balance - f.amount, held: funded.held });
    expect(await w.ledgerCount(f.shipper)).toBe(ledger + 1 + 1);
  });

  it('two administrators pressing retry at the same moment post the money once; the other is refused', async () => {
    const f = await pendingCharge(2_000);
    await w.topUp(f.shipper, 10_000);
    const funded = await w.wallet(f.shipper);
    const ledger = await w.ledgerCount(f.shipper);
    const detail = data(await w.adminGet(system, `/complaints/${f.id}`));
    const version = Number((detail.complaint as Json).version);
    const body = { expected_version: version, reason: 'Hai người cùng bấm' };
    const results = await Promise.all([w.adminPost(system, `/complaints/${f.id}/actions/retry-commission`, body, randomUUID()), w.adminPost(system, `/complaints/${f.id}/actions/retry-commission`, body, randomUUID())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(['VERSION_CONFLICT', 'COMPLAINT_STATE_CONFLICT']).toContain(adminErrorCode(results.find((r) => r.status === 409) as AdminResponse));
    expect(await w.wallet(f.shipper)).toEqual({ balance: funded.balance - f.amount, held: funded.held });
    expect(await w.ledgerCount(f.shipper)).toBe(ledger + 1);
    expect(await q('SELECT 1 FROM app.complaint_adjustments WHERE complaint_id = $1::uuid', [f.id])).toHaveLength(1);
    expect(await q('SELECT 1 FROM app.wallet_adjustments WHERE source_id = $1::uuid', [f.adjustmentId])).toHaveLength(1);
  });

  it('the money right is checked at the moment of the press: it is not offered without it and the call is refused', async () => {
    const f = await pendingCharge(2_000);
    const plain = await w.adminWith('DRIVER', { review: true });
    const detail = data(await w.adminGet(plain, `/complaints/${f.id}`));
    expect(detail.can).not.toContain('retry-commission');
    const refused = await w.adminPost(plain, `/complaints/${f.id}/actions/retry-commission`, { expected_version: Number((detail.complaint as Json).version), reason: 'Không có quyền tiền' });
    expect([refused.status, adminErrorCode(refused)]).toEqual([403, 'ADMIN_FORBIDDEN']);
    expect(await pendingOf(f.shipper)).toBe(1);
  });

  it('the database refuses what the application must never do: a ledger row without its record, a record without its ledger row, and any change to a record', async () => {
    const attempt = async (sql: string, values: unknown[]): Promise<string> => {
      const client = await w.app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql, values);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
        await client.query('ROLLBACK');
        return 'accepted';
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return String((error as { message?: string }).message ?? error).slice(0, 60);
      } finally {
        client.release();
      }
    };
    const last = (await q('SELECT sequence_no::int AS n, balance_after_vnd::int AS balance FROM app.wallet_ledger_entries WHERE wallet_id = $1::uuid ORDER BY sequence_no DESC LIMIT 1', [shipper.walletId]))[0] as Json;
    // No adjustment record at all.
    expect(await attempt(`INSERT INTO app.wallet_ledger_entries (entry_id, wallet_id, sequence_no, entry_kind, delta_vnd, balance_after_vnd, created_at, adjustment_id) VALUES (gen_random_uuid(), $1::uuid, $2, 'ADJUSTMENT_CREDIT', 5, $3, now(), gen_random_uuid())`, [shipper.walletId, Number(last.n) + 1, Number(last.balance) + 5])).toMatch(/WALLET_LEDGER_SOURCE_NOT_AVAILABLE|foreign key/);
    // An adjustment record without its ledger row does not survive COMMIT.
    expect(await attempt(`INSERT INTO app.wallet_adjustments (adjustment_id, wallet_id, source_type, source_id, direction, amount_vnd, posted_by, created_at) VALUES (gen_random_uuid(), $1::uuid, 'COMPLAINT', gen_random_uuid(), 'REFUND_TO_SHIPPER', 5, $2::uuid, now())`, [shipper.walletId, system.userId])).toMatch(/WALLET_INVARIANT_VIOLATION/);
    // The record is append-only.
    expect(await attempt(`UPDATE app.wallet_adjustments SET amount_vnd = amount_vnd + 1`, [])).toMatch(/append-only/);
  });
});
