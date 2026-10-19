import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { adminData, AdminResponse } from './support/admin-fixtures';
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
