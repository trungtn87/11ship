import { describe, expect, it } from '@jest/globals';
import {
  availableOf,
  draftOf,
  filterLedger,
  filterTopups,
  filterWallets,
  filterWithdrawals,
  formatVnd,
  formatVndSigned,
  EMPTY_LEDGER_FILTER,
  LedgerRow,
  movesBalance,
  NOT_WIRED_FINANCE,
  paginate,
  parseVnd,
  reconciliationDifference,
  TopupRow,
  validateTopupDecision,
  validateWalletParams,
  WALLET_PARAM_DEFAULTS,
  WalletRow,
  WithdrawalRow,
  withdrawalActions,
  topupCounts,
  withdrawalCounts,
} from './finance';

describe('money', () => {
  it('formats whole dong with Vietnamese grouping', () => {
    expect(formatVnd(100000)).toBe('100.000đ');
    expect(formatVnd(0)).toBe('0đ');
    expect(formatVnd(999)).toBe('999đ');
    expect(formatVnd(1234567)).toBe('1.234.567đ');
    expect(formatVnd(-1000)).toBe('-1.000đ');
    expect(formatVnd(Number.NaN)).toBe('0đ');
    expect(formatVndSigned(150000)).toBe('+150.000đ');
    expect(formatVndSigned(-1000)).toBe('-1.000đ');
    expect(formatVndSigned(0)).toBe('0đ');
  });

  it('reads only whole numbers of dong', () => {
    expect(parseVnd('100000')).toBe(100000);
    expect(parseVnd('100.000')).toBe(100000);
    expect(parseVnd(' 1 000 ')).toBe(1000);
    expect(parseVnd('')).toBeUndefined();
    expect(parseVnd('12,5')).toBeUndefined();
    expect(parseVnd('-5')).toBeUndefined();
    expect(parseVnd('abc')).toBeUndefined();
    expect(parseVnd('1'.repeat(13))).toBeUndefined();
  });

  it('available is total minus held, computed in one place', () => {
    expect(availableOf({ total: 150000, held: 2000 })).toBe(148000);
    expect(availableOf({ total: 0, held: 0 })).toBe(0);
  });

  it('the reference defaults are the Owner values', () => {
    expect(WALLET_PARAM_DEFAULTS).toEqual({ minTopup: 100000, minWithdraw: 10000, commissionPerOrder: 1000 });
  });
});

describe('top-up decision form', () => {
  const blank = { actualAmount: '', bankReference: '', note: '' };

  it('confirm needs the real amount and the bank reference', () => {
    const result = validateTopupDecision(blank, 100000, 'confirm');
    expect(result.errors.actualAmount).toBeDefined();
    expect(result.errors.bankReference).toBeDefined();
    expect(validateTopupDecision({ actualAmount: '0', bankReference: 'FT1', note: '' }, 100000, 'confirm').errors.actualAmount).toBeDefined();
    expect(validateTopupDecision({ actualAmount: '100.000', bankReference: 'FT1', note: '' }, 100000, 'confirm')).toEqual({ errors: {}, mismatch: false });
  });

  it('a different amount is a warning, not an error: the wallet gets what the bank received', () => {
    const result = validateTopupDecision({ actualAmount: '90000', bankReference: 'FT1', note: '' }, 100000, 'confirm');
    expect(result.errors).toEqual({});
    expect(result.mismatch).toBe(true);
  });

  it('reject needs a reason and nothing else', () => {
    expect(validateTopupDecision(blank, 100000, 'reject').errors.note).toBeDefined();
    expect(validateTopupDecision({ ...blank, note: 'Không thấy giao dịch' }, 100000, 'reject')).toEqual({ errors: {}, mismatch: false });
  });

  it('limits the note and the bank reference', () => {
    expect(validateTopupDecision({ actualAmount: '1000', bankReference: 'x'.repeat(65), note: '' }, 1000, 'confirm').errors.bankReference).toBeDefined();
    expect(validateTopupDecision({ actualAmount: '1000', bankReference: 'x', note: 'n'.repeat(501) }, 1000, 'confirm').errors.note).toBeDefined();
  });
});

describe('withdrawal steps', () => {
  it('offers only the next honest step; money stays held until PAID', () => {
    expect(withdrawalActions('PENDING')).toEqual(['START']);
    expect(withdrawalActions('PROCESSING')).toEqual(['MARK_PAID', 'MARK_RECONCILE']);
    expect(withdrawalActions('NEEDS_RECONCILE')).toEqual(['RECONCILE']);
    expect(withdrawalActions('COMPLETED')).toEqual([]);
    expect(withdrawalActions('CANCELLED')).toEqual([]);
  });
});

describe('wallet parameters', () => {
  it('accepts the defaults and rejects out-of-range or non-numeric values', () => {
    expect(validateWalletParams(draftOf(WALLET_PARAM_DEFAULTS))).toEqual({});
    const errors = validateWalletParams({ minTopup: '0', minWithdraw: 'abc', commissionPerOrder: '-1' });
    expect(Object.keys(errors).sort()).toEqual(['commissionPerOrder', 'minTopup', 'minWithdraw']);
    expect(validateWalletParams({ minTopup: '100000', minWithdraw: '10000', commissionPerOrder: '0' })).toEqual({});
  });
});

const wallet = (code: string, name: string, phone: string): WalletRow => ({ id: code, code, name, phoneMasked: phone, total: 1000, held: 0, status: 'ACTIVE' });
const topup = (id: string, status: TopupRow['status'], name = 'Nguyễn Văn A'): TopupRow => ({ id, code: `NP${id}`, createdAt: '2026-10-15T02:00:00.000Z', shipperName: name, phoneMasked: '098• •••• 321', amount: 100000, bank: 'VCB', status });
const withdrawal = (id: string, status: WithdrawalRow['status']): WithdrawalRow => ({ id, code: `RT${id}`, createdAt: '2026-10-15T02:00:00.000Z', shipperName: 'Trần Thị B', phoneMasked: '091• •••• 678', amount: 50000, status });

describe('filters', () => {
  it('searches wallets by name without accents, by code and by phone digits', () => {
    const rows = [wallet('SHP001', 'Nguyễn Văn A', '098• •••• 321'), wallet('SHP002', 'Đặng Thị B', '091• •••• 678')];
    expect(filterWallets(rows, '').length).toBe(2);
    expect(filterWallets(rows, 'nguyen').map((row) => row.code)).toEqual(['SHP001']);
    expect(filterWallets(rows, 'dang').map((row) => row.code)).toEqual(['SHP002']);
    expect(filterWallets(rows, 'shp002').map((row) => row.code)).toEqual(['SHP002']);
    expect(filterWallets(rows, '678').map((row) => row.code)).toEqual(['SHP002']);
    expect(filterWallets(rows, 'không có')).toEqual([]);
  });

  it('top-up tabs: waiting, decided, all', () => {
    const rows = [topup('1', 'PENDING'), topup('2', 'CONFIRMED'), topup('3', 'REJECTED'), topup('4', 'CANCELLED'), topup('5', 'PENDING', 'Trần Thị B')];
    expect(filterTopups(rows, 'PENDING', '').map((row) => row.id)).toEqual(['1', '5']);
    expect(filterTopups(rows, 'DONE', '').map((row) => row.id)).toEqual(['2', '3', '4']);
    expect(filterTopups(rows, 'ALL', '').length).toBe(5);
    expect(filterTopups(rows, 'PENDING', 'tran').map((row) => row.id)).toEqual(['5']);
    expect(topupCounts(rows)).toEqual({ PENDING: 2, DONE: 3, ALL: 5 });
  });

  it('withdrawal tabs keep "cần đối soát" as its own branch', () => {
    const rows = [withdrawal('1', 'PENDING'), withdrawal('2', 'PROCESSING'), withdrawal('3', 'NEEDS_RECONCILE'), withdrawal('4', 'COMPLETED'), withdrawal('5', 'CANCELLED')];
    expect(filterWithdrawals(rows, 'NEEDS_RECONCILE', '').map((row) => row.id)).toEqual(['3']);
    expect(filterWithdrawals(rows, 'COMPLETED', '').map((row) => row.id)).toEqual(['4']);
    expect(filterWithdrawals(rows, 'ALL', '').length).toBe(5);
    expect(withdrawalCounts(rows)).toEqual({ PENDING: 1, PROCESSING: 1, COMPLETED: 1, NEEDS_RECONCILE: 1, ALL: 5 });
  });

  it('ledger filters by date, type, status and shipper', () => {
    const row = (id: string, at: string, type: LedgerRow['type'], status: LedgerRow['status'], shipperName = 'Nguyễn Văn A'): LedgerRow => ({ id, at, type, status, shipperName, reference: id, amount: 1, balanceAfter: 1 });
    const rows = [row('1', '2026-10-14T05:00:00.000Z', 'TOPUP', 'SUCCESS'), row('2', '2026-10-15T05:00:00.000Z', 'WITHDRAW', 'PENDING', 'Trần Thị B'), row('3', '2026-10-16T05:00:00.000Z', 'COMMISSION', 'FAILED')];
    expect(filterLedger(rows, EMPTY_LEDGER_FILTER).length).toBe(3);
    expect(filterLedger(rows, { ...EMPTY_LEDGER_FILTER, from: '2026-10-15' }).map((r) => r.id)).toEqual(['2', '3']);
    expect(filterLedger(rows, { ...EMPTY_LEDGER_FILTER, to: '2026-10-15' }).map((r) => r.id)).toEqual(['1', '2']);
    expect(filterLedger(rows, { ...EMPTY_LEDGER_FILTER, type: 'WITHDRAW' }).map((r) => r.id)).toEqual(['2']);
    expect(filterLedger(rows, { ...EMPTY_LEDGER_FILTER, status: 'FAILED' }).map((r) => r.id)).toEqual(['3']);
    expect(filterLedger(rows, { ...EMPTY_LEDGER_FILTER, shipper: 'tran' }).map((r) => r.id)).toEqual(['2']);
  });

  it('hold and release do not move the balance', () => {
    expect(movesBalance('HOLD')).toBe(false);
    expect(movesBalance('RELEASE')).toBe(false);
    expect(movesBalance('TOPUP')).toBe(true);
    expect(movesBalance('COMMISSION')).toBe(true);
  });

  it('reconciliation shows the difference as it is', () => {
    expect(reconciliationDifference({ ledgerTotal: 100, walletTotal: 100, heldTotal: 0, pendingWithdrawals: 0 })).toBe(0);
    expect(reconciliationDifference({ ledgerTotal: 100, walletTotal: 102, heldTotal: 0, pendingWithdrawals: 0 })).toBe(2);
    expect(reconciliationDifference({ ledgerTotal: 100, walletTotal: 90, heldTotal: 0, pendingWithdrawals: 0 })).toBe(-10);
  });

  it('paginates and clamps the page', () => {
    const rows = Array.from({ length: 23 }, (_, index) => index);
    expect(paginate(rows, 1, 10)).toEqual({ rows: rows.slice(0, 10), pages: 3, page: 1 });
    expect(paginate(rows, 3, 10).rows.length).toBe(3);
    expect(paginate(rows, 99, 10).page).toBe(3);
    expect(paginate(rows, -4, 10).page).toBe(1);
    expect(paginate([], 1, 10)).toEqual({ rows: [], pages: 1, page: 1 });
  });
});

describe('the real source in the UI phase', () => {
  it('answers "not wired" to every read and invents nothing', async () => {
    for (const read of [NOT_WIRED_FINANCE.overview(), NOT_WIRED_FINANCE.wallets(), NOT_WIRED_FINANCE.topups(), NOT_WIRED_FINANCE.topup('x'), NOT_WIRED_FINANCE.withdrawals(), NOT_WIRED_FINANCE.withdrawal('x'), NOT_WIRED_FINANCE.ledger(), NOT_WIRED_FINANCE.params()]) {
      const answer = await read;
      expect(answer.kind).toBe('not-wired');
      expect(JSON.stringify(answer)).not.toMatch(/\d{3}\.\d{3}đ/);
    }
  });
});
