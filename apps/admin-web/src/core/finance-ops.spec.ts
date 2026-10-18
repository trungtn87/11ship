import { describe, expect, it } from '@jest/globals';
import { Transport, TransportRequest, TransportResponse } from './api';
import { checkEvidence, EvidenceDraft, SourceAccount } from './finance-ops';
import { AdminFinanceOpsApi, createFinanceOpsSource, parseCheckResult, parseCommissionPolicy, parseLedgerPage, parseOverview, parseReconciliation, parseSourceAccounts, parseWalletPage, parseWithdrawalDetail, parseWithdrawalPage } from './finance-ops-api';

// The operating finance model and its HTTP client (M04-C): the transfer-evidence form, the strict parsers (a body that is not the contract is "no usable answer"),
// the EXACT body, path and key of every command, and the closed outcome mapping (a lost answer is UNKNOWN: the page resends the same command, never another).

const ID = '11111111-1111-4111-8111-111111111111';
const ACC = '22222222-2222-4222-8222-222222222222';
const DRV = '33333333-3333-4333-8333-333333333333';
const reply = (status: number, body: unknown, headers: Record<string, string> = {}): TransportResponse => ({ status, header: (name) => headers[name.toLowerCase()] ?? null, json: () => Promise.resolve(body) });
const err = (code: string) => ({ error: { code, message: 'x', request_id: 'r', details: {} } });

function scripted(...answers: (TransportResponse | 'throw')[]): { transport: Transport; requests: TransportRequest[] } {
  const requests: TransportRequest[] = [];
  const queue = [...answers];
  const transport: Transport = (request) => {
    requests.push(request);
    const next = queue.shift();
    return next === 'throw' || next === undefined ? Promise.reject(new Error('down')) : Promise.resolve(next);
  };
  return { transport, requests };
}
const session = (csrf: string | null = 'csrf-1') => ({ csrf: () => csrf ?? undefined, refresh: () => Promise.resolve(true) });

const shipper = { code: 'SH000001', name_masked: 'N*** V*** A***', phone_masked: '*******678', status: 'ACTIVE' };
const withdrawal = (over: Record<string, unknown> = {}) => ({
  withdrawal_id: ID,
  request_code: '11111111',
  driver_id: DRV,
  shipper,
  amount_vnd: 50000,
  state: 'PENDING',
  version: 1,
  created_at: '2026-10-18T03:00:00.000Z',
  resolved_at: null,
  destination_bank: 'Vietcombank',
  destination_masked: '****1098',
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...withdrawal(),
  destination: { bank_code: 'VCB', bank_name: 'Vietcombank', account_number_masked: '****1098', account_holder_masked: 'N*** V*** A', full: false },
  snapshot_current: true,
  processing: null,
  reconciliation: null,
  outgoing: null,
  paid_at: null,
  outcome: null,
  events: [{ kind: 'CREATED', from_state: null, to_state: 'PENDING', reason_code: null, at: '2026-10-18T03:00:00.000Z', by_me: false }],
  rights: { can_process: true, can_confirm: false, can_report: false, can_reconcile: false },
  ...over,
});
const accounts: readonly SourceAccount[] = [{ accountId: ACC, bankId: 'VCB', numberMasked: '****6789' }];
const NOW = Date.parse('2026-10-18T10:00:00.000Z');
const draft = (over: Partial<EvidenceDraft> = {}): EvidenceDraft => ({ actual: '50000', transactionId: '000AbC', paidAt: '2026-10-18T09:30', accountId: ACC, destinationChecked: true, ...over });

describe('transfer evidence form (M04-C)', () => {
  it('a valid form is ready with exactly what would be sent; the code is kept as typed (only the edges trimmed), the dot is only a thousands separator', () => {
    const checked = checkEvidence(draft({ actual: '50.000', transactionId: '  000AbC  ' }), 50000, accounts, NOW, true);
    expect(checked.ready).toMatchObject({ actualVnd: 50000, bankId: 'VCB', accountId: ACC, transactionId: '000AbC' });
    expect(checked.mismatch).toBe(false);
    expect(checkEvidence(draft({ actual: '50000.5' }), 50000, accounts, NOW, true).errors.actual).toBeDefined();
    expect(checkEvidence(draft({ actual: '5.0000' }), 50000, accounts, NOW, true).ready).toBeUndefined();
  });
  it('every missing piece is its own error and nothing is sent: amount, code, time (never in the future, never defaulted), account, destination statement', () => {
    const bad = checkEvidence(draft({ actual: '', transactionId: ' ', paidAt: '', accountId: '', destinationChecked: false }), 50000, accounts, NOW, true);
    expect(Object.keys(bad.errors).sort()).toEqual(['accountId', 'actual', 'destinationChecked', 'paidAt', 'transactionId']);
    expect(bad.ready).toBeUndefined();
    expect(checkEvidence(draft({ paidAt: '2026-10-19T09:30' }), 50000, accounts, NOW, true).errors.paidAt).toBeDefined();
    expect(checkEvidence(draft({ accountId: 'unknown' }), 50000, accounts, NOW, true).errors.accountId).toBeDefined();
    // The destination statement is only required where the transfer is claimed to be complete.
    expect(checkEvidence(draft({ destinationChecked: false }), 50000, accounts, NOW, false).ready).toBeDefined();
  });
  it('a different amount is flagged as a mismatch (the page reports instead of recording PAID)', () => {
    const checked = checkEvidence(draft({ actual: '45000' }), 50000, accounts, NOW, true);
    expect(checked.mismatch).toBe(true);
    expect(checked.ready?.actualVnd).toBe(45000);
  });
});

describe('finance ops parsers (M04-C)', () => {
  it('overview: every figure must be a whole number; a missing block is refused', () => {
    const ok = {
      wallets: 3,
      total_balance_vnd: 300000,
      total_held_vnd: 20000,
      total_available_vnd: 280000,
      topup_pending: { count: 1, amount_vnd: 100000 },
      withdrawal_pending: { count: 2, amount_vnd: 60000 },
      withdrawal_processing: { count: 1 },
      withdrawal_reconciliation: { count: 0, amount_vnd: 0 },
      last_24h: { topup: { count: 1, amount_vnd: 1 }, withdrawal_paid: { count: 0, amount_vnd: 0 }, commission: { count: 2, amount_vnd: 2000 } },
      drift: { wallets: 0, withdrawals: 0 },
      commission_vnd: 1000,
    };
    expect(parseOverview(ok)).toMatchObject({ wallets: 3, totalAvailableVnd: 280000, withdrawalProcessing: 1, commissionVnd: 1000, driftWallets: 0 });
    expect(parseOverview({ ...ok, total_balance_vnd: 1.5 })).toBeUndefined();
    expect(parseOverview({ ...ok, drift: undefined })).toBeUndefined();
    expect(parseOverview({ ...ok, topup_pending: { count: 1 } })).toBeUndefined();
  });
  it('withdrawals: the list carries a MASKED destination; the detail knows whether the destination is whole; an unknown state is refused', () => {
    expect(parseWithdrawalPage({ items: [withdrawal()], next_cursor: null })?.items[0]).toMatchObject({ withdrawalId: ID, requestCode: '11111111', destinationMasked: '****1098', state: 'PENDING' });
    expect(parseWithdrawalPage({ items: [withdrawal({ state: 'DONE' })], next_cursor: null })).toBeUndefined();
    expect(parseWithdrawalPage({ items: [withdrawal({ amount_vnd: 0 })], next_cursor: null })).toBeUndefined();
    const masked = parseWithdrawalDetail(detail());
    expect(masked?.destination).toMatchObject({ full: false, accountNumberMasked: '****1098' });
    const whole = parseWithdrawalDetail(
      detail({
        state: 'PROCESSING',
        destination: { bank_code: 'VCB', bank_name: 'Vietcombank', account_number: '0123456789', account_holder: 'NGUYEN VAN A', full: true },
        processing: { started_at: '2026-10-18T04:00:00.000Z', is_owner: true },
        rights: { can_process: false, can_confirm: true, can_report: true, can_reconcile: false },
      }),
    );
    expect(whole?.destination).toMatchObject({ full: true, accountNumber: '0123456789' });
    expect(whole?.processing).toEqual({ startedAt: '2026-10-18T04:00:00.000Z', isOwner: true });
    expect(parseWithdrawalDetail(detail({ destination: { bank_code: 'VCB', bank_name: 'x', full: true } }))).toBeUndefined();
    expect(parseWithdrawalDetail(detail({ rights: { can_process: true } }))).toBeUndefined();
    expect(parseWithdrawalDetail(detail({ events: [{ kind: 'X', from_state: 'NOPE', to_state: 'PENDING', reason_code: null, at: '2026-10-18T03:00:00.000Z', by_me: false }] }))).toBeUndefined();
  });
  it('wallets, ledger, reconciliation, commission and accounts', () => {
    const wallet = { wallet_id: ID, driver_id: DRV, shipper, balance_vnd: 100000, held_vnd: 1000, available_vnd: 99000, updated_at: '2026-10-18T03:00:00.000Z' };
    expect(parseWalletPage({ items: [wallet], next_cursor: 'c' })).toMatchObject({ items: [{ balanceVnd: 100000, availableVnd: 99000 }], nextCursor: 'c' });
    expect(parseWalletPage({ items: [{ ...wallet, held_vnd: -1 }], next_cursor: null })).toBeUndefined();
    const row = { id: 'L:1', kind: 'COMMISSION_DEBIT', amount_vnd: -1000, balance_after_vnd: 99000, hold_status: null, order_ref: 'G-1', source_id: ID, at: '2026-10-18T03:00:00.000Z', driver_id: DRV, shipper };
    expect(parseLedgerPage({ items: [row], next_cursor: null })?.items[0]).toMatchObject({ kind: 'COMMISSION_DEBIT', amountVnd: -1000, orderRef: 'G-1' });
    expect(parseLedgerPage({ items: [{ ...row, kind: 'GIFT' }], next_cursor: null })).toBeUndefined();
    expect(parseLedgerPage({ items: [{ ...row, kind: 'HOLD_COMMISSION', amount_vnd: 1000, balance_after_vnd: null, hold_status: 'ACTIVE' }], next_cursor: null })?.items[0]).toMatchObject({ holdStatus: 'ACTIVE', balanceAfterVnd: null });
    expect(parseReconciliation({ checked_wallets: 3, drift_wallets: 1, drift_withdrawals: 0, withdrawals_in_reconciliation: 2, drift: [{ wallet_id: ID, driver_id: DRV, shipper, balance_vnd: 5, held_vnd: 0, ledger_sum_vnd: 4, last_balance_after_vnd: 4, active_holds_vnd: 0 }] })?.drift).toHaveLength(1);
    expect(parseReconciliation({ checked_wallets: 3 })).toBeUndefined();
    expect(parseCommissionPolicy({ current: { version: 2, commission_vnd: 2000, created_at: '2026-10-18T03:00:00.000Z' }, history: [{ version: 2, commission_vnd: 2000, created_at: '2026-10-18T03:00:00.000Z' }, { version: 1, commission_vnd: 1000, created_at: '2026-10-17T03:00:00.000Z' }] })?.history).toHaveLength(2);
    expect(parseCommissionPolicy({ current: { version: 0, commission_vnd: 1, created_at: '2026-10-18T03:00:00.000Z' }, history: [] })).toBeUndefined();
    expect(parseSourceAccounts({ accounts: [{ account_id: ACC, bank_id: 'VCB', account_number_masked: '****6789' }] })).toEqual([{ accountId: ACC, bankId: 'VCB', numberMasked: '****6789' }]);
    expect(parseSourceAccounts({ accounts: [{ account_id: ACC, bank_id: 'VCB' }] })).toBeUndefined();
    expect(parseCheckResult({ checked_wallets: 1, drift_wallets: 0, drift_withdrawals: 0, recorded: false })).toEqual({ checkedWallets: 1, driftWallets: 0, driftWithdrawals: 0, recorded: false });
  });
});

describe('finance ops client (M04-C)', () => {
  it('lists with ONE status, the page size and the cursor; ALL sends no status; the ledger sends kind and driver', async () => {
    const { transport, requests } = scripted(
      reply(200, { data: { items: [], next_cursor: null } }),
      reply(200, { data: { items: [], next_cursor: null } }),
      reply(200, { data: { items: [], next_cursor: null } }),
    );
    const api = new AdminFinanceOpsApi(transport);
    await api.withdrawals('RECONCILIATION', null);
    await api.withdrawals('ALL', 'abc def');
    await api.ledger({ kind: 'TOPUP', driverId: DRV }, null);
    expect(requests.map((r) => r.path)).toEqual([
      '/admin/finance/withdrawals?status=RECONCILIATION&limit=20',
      '/admin/finance/withdrawals?limit=20&cursor=abc%20def',
      `/admin/finance/transactions?kind=TOPUP&driver_id=${DRV}&limit=20`,
    ]);
  });
  it('start, mark-paid, report and reconcile send EXACTLY the documented body, path, key and token (the code is not changed)', async () => {
    const { transport, requests } = scripted(reply(200, { data: detail() }), reply(200, { data: detail() }), reply(200, { data: detail() }), reply(200, { data: detail() }), reply(200, { data: detail() }));
    const source = createFinanceOpsSource(new AdminFinanceOpsApi(transport), session());
    const evidence = { actualVnd: 50000, bankId: 'VCB', accountId: ACC, transactionId: '000AbC', paidAt: '2026-10-18T09:30:00.000Z' };
    expect(await source.startProcessing({ key: 'k1', withdrawalId: ID, version: 1 })).toEqual({ kind: 'ok' });
    expect(await source.markPaid({ key: 'k2', withdrawalId: ID, version: 2, evidence })).toEqual({ kind: 'ok' });
    expect(await source.reportReconciliation({ key: 'k3', withdrawalId: ID, version: 2, reason: 'AMOUNT_MISMATCH', evidence })).toEqual({ kind: 'ok' });
    expect(await source.reconcile({ key: 'k4', withdrawalId: ID, version: 3, outcome: 'CONFIRMED_NOT_SENT_FINAL', reasonCode: 'BANK_CONFIRMED_NOT_SENT' })).toEqual({ kind: 'ok' });
    expect(await source.reconcile({ key: 'k5', withdrawalId: ID, version: 3, outcome: 'CONFIRMED_PAID', reasonCode: 'STATEMENT_CONFIRMED', evidence })).toEqual({ kind: 'ok' });
    const sent = requests.map((r) => ({ path: r.path, key: r.idempotencyKey, csrf: r.csrf, body: r.body }));
    const wire = { actual_amount_vnd: 50000, bank_id: 'VCB', system_owned_account_id: ACC, canonical_transaction_id: '000AbC', paid_at: '2026-10-18T09:30:00.000Z' };
    expect(sent).toEqual([
      { path: `/admin/finance/withdrawals/${ID}/start-processing`, key: 'k1', csrf: 'csrf-1', body: { expected_version: 1 } },
      { path: `/admin/finance/withdrawals/${ID}/mark-paid`, key: 'k2', csrf: 'csrf-1', body: { expected_version: 2, destination_checked: true, ...wire } },
      { path: `/admin/finance/withdrawals/${ID}/report-reconciliation`, key: 'k3', csrf: 'csrf-1', body: { expected_version: 2, reason_code: 'AMOUNT_MISMATCH', evidence: wire } },
      { path: `/admin/finance/withdrawals/${ID}/reconcile`, key: 'k4', csrf: 'csrf-1', body: { expected_version: 3, outcome: 'CONFIRMED_NOT_SENT_FINAL', reason_code: 'BANK_CONFIRMED_NOT_SENT', bank_confirmed_not_sent: true } },
      { path: `/admin/finance/withdrawals/${ID}/reconcile`, key: 'k5', csrf: 'csrf-1', body: { expected_version: 3, outcome: 'CONFIRMED_PAID', reason_code: 'STATEMENT_CONFIRMED', destination_checked: true, evidence: wire } },
    ]);
  });
  it('the commission change and the audited check carry their keys; the check returns its result', async () => {
    const { transport, requests } = scripted(reply(200, { data: { current: { version: 2, commission_vnd: 2000, created_at: '2026-10-18T03:00:00.000Z' } } }), reply(200, { data: { checked_wallets: 4, drift_wallets: 1, drift_withdrawals: 0, recorded: true } }));
    const source = createFinanceOpsSource(new AdminFinanceOpsApi(transport), session());
    expect(await source.changeCommission({ key: 'c1', version: 1, commissionVnd: 2000 })).toEqual({ kind: 'ok' });
    const check = await source.runCheck({ key: 'c2' });
    expect(check).toMatchObject({ kind: 'ok', result: { driftWallets: 1, recorded: true } });
    expect(requests.map((r) => [r.path, r.idempotencyKey, JSON.stringify(r.body)])).toEqual([
      ['/admin/finance/commission-policy', 'c1', '{"expected_version":1,"commission_vnd":2000}'],
      ['/admin/finance/reconciliation/check', 'c2', '{}'],
    ]);
  });
  it('maps the outcomes: a lost answer or a 5xx is UNKNOWN (same key is kept by the page), the withdrawal conflicts keep their code, a refusal says refused, no token means the session is gone', async () => {
    const run = async (answer: TransportResponse | 'throw', csrf: string | null = 'c') => {
      const { transport, requests } = scripted(answer);
      const outcome = await createFinanceOpsSource(new AdminFinanceOpsApi(transport), session(csrf)).startProcessing({ key: 'k', withdrawalId: ID, version: 1 });
      return { outcome, sent: requests.length };
    };
    expect((await run('throw')).outcome).toEqual({ kind: 'unknown' });
    expect((await run(reply(503, err('TRANSACTION_OUTCOME_UNKNOWN')))).outcome).toEqual({ kind: 'unknown' });
    expect((await run(reply(409, err('WITHDRAWAL_STATE_CONFLICT')))).outcome).toEqual({ kind: 'conflict', code: 'WITHDRAWAL_STATE_CONFLICT' });
    expect((await run(reply(409, err('BANK_SNAPSHOT_STALE')))).outcome).toEqual({ kind: 'conflict', code: 'BANK_SNAPSHOT_STALE' });
    expect((await run(reply(403, err('WITHDRAWAL_NOT_OWNER')))).outcome).toEqual({ kind: 'refused', code: 'WITHDRAWAL_NOT_OWNER' });
    expect((await run(reply(409, err('WITHDRAWAL_EVIDENCE_MISMATCH')))).outcome).toEqual({ kind: 'refused', code: 'WITHDRAWAL_EVIDENCE_MISMATCH' });
    expect((await run(reply(403, err('ADMIN_FORBIDDEN')))).outcome).toEqual({ kind: 'forbidden' });
    expect((await run(reply(401, err('ADMIN_SESSION_INVALID')))).outcome).toEqual({ kind: 'session-expired' });
    expect(await run(reply(200, { data: {} }), null)).toMatchObject({ outcome: { kind: 'session-expired' }, sent: 0 });
  });
  it('reads: 404 is not-found, 403 forbidden, a bad body is offline', async () => {
    const read = async (answer: TransportResponse | 'throw') => createFinanceOpsSource(new AdminFinanceOpsApi(scripted(answer).transport), session()).withdrawal(ID);
    expect(await read(reply(404, err('WITHDRAWAL_NOT_FOUND')))).toEqual({ kind: 'not-found' });
    expect(await read(reply(403, err('ADMIN_FORBIDDEN')))).toEqual({ kind: 'failed', failure: 'forbidden' });
    expect(await read(reply(200, { data: { withdrawal_id: 'x' } }))).toEqual({ kind: 'failed', failure: 'offline' });
  });
});
