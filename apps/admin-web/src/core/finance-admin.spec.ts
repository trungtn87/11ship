import { describe, expect, it } from '@jest/globals';
import { checkAccount, checkConfirm, formatVndAmount, messageOf, parseActualVnd, receivedAtFrom, ReceivingAccount, FINANCE_GENERIC_MESSAGE } from './finance-admin';
import { formatRoute, parseRoute } from './routes';
import { canOpenRoute, visibleMenu } from './menu';

const ACCOUNT: ReceivingAccount = { accountId: '11111111-1111-4111-8111-111111111111', bankId: 'VCB', numberMasked: '****6789', canReceive: true };
const OFF: ReceivingAccount = { ...ACCOUNT, accountId: '22222222-2222-4222-8222-222222222222', canReceive: false };
const NOW = Date.parse('2026-10-18T10:00:00.000Z');
const draft = (over: Record<string, string> = {}) => ({ actual: '60.000', transactionId: '000AbC', receivedAt: '2026-10-16T08:30', accountId: ACCOUNT.accountId, ...over });

describe('finance (B3a) - money and time', () => {
  it('reads whole positive VND only and prints it with grouping', () => {
    expect(parseActualVnd('60.000')).toBe(60000);
    expect(parseActualVnd(' 100000 ')).toBe(100000);
    for (const bad of ['', '0', '-5', '1,5', '1.5e3', '60000.5', 'abc', '1234567890123']) {
      expect(parseActualVnd(bad)).toBeUndefined();
    }
    expect(formatVndAmount(1500000)).toBe('1.500.000đ');
  });
  it('a received time must be typed, valid and not in the future (5 minutes of tolerance)', () => {
    expect(receivedAtFrom('', NOW)).toBeUndefined();
    expect(receivedAtFrom('yesterday', NOW)).toBeUndefined();
    expect(receivedAtFrom('2027-01-01T00:00', NOW)).toBeUndefined();
    expect(receivedAtFrom('2020-01-01T08:00', NOW)).toMatch(/Z$/);
  });
});

describe('finance (B3a) - confirmation form', () => {
  it('is ready only with every field valid, keeps the code EXACTLY (case, leading zeros) and the actual amount, not the requested one', () => {
    const checked = checkConfirm(draft({ transactionId: '  000AbC ' }), 100000, [ACCOUNT, OFF], NOW);
    expect(checked.errors).toEqual({});
    expect(checked.ready).toMatchObject({ actualVnd: 60000, transactionId: '000AbC', account: ACCOUNT });
    expect(checked.mismatch).toBe(true);
    expect(checkConfirm(draft({ actual: '100000' }), 100000, [ACCOUNT], NOW).mismatch).toBe(false);
  });
  it('refuses a missing amount, code, time and a disabled or unknown account, and sends nothing', () => {
    for (const [over, field] of [
      [{ actual: '' }, 'actual'],
      [{ transactionId: '   ' }, 'transactionId'],
      [{ transactionId: 'a'.repeat(129) }, 'transactionId'],
      [{ receivedAt: '' }, 'receivedAt'],
      [{ accountId: OFF.accountId }, 'accountId'],
      [{ accountId: '' }, 'accountId'],
    ] as const) {
      const checked = checkConfirm(draft(over), 100000, [ACCOUNT, OFF], NOW);
      expect(checked.ready).toBeUndefined();
      expect(Object.keys(checked.errors)).toContain(field);
    }
  });
  it('never defaults the amount to the requested one or the time to now', () => {
    const checked = checkConfirm({ actual: '', transactionId: 'X', receivedAt: '', accountId: ACCOUNT.accountId }, 100000, [ACCOUNT], NOW);
    expect(checked.ready).toBeUndefined();
    expect(checked.errors.actual).toBeDefined();
    expect(checked.errors.receivedAt).toBeDefined();
  });
});

describe('finance (B3a) - new receiving account and words', () => {
  it('keeps the number as text (leading zeros) and shapes bank and holder like the server', () => {
    expect(checkAccount({ bankId: ' vcb ', accountNumber: '0123 456-789', accountHolder: '  CONG  TY ' }).ready).toEqual({ bankId: 'VCB', accountNumber: '0123456789', accountHolder: 'CONG TY' });
    const bad = checkAccount({ bankId: 'V', accountNumber: '12ab', accountHolder: '' });
    expect(Object.keys(bad.errors).sort()).toEqual(['accountHolder', 'accountNumber', 'bankId']);
  });
  it('never echoes a server string: unknown codes get the generic sentence', () => {
    expect(messageOf('BANK_TRANSACTION_ALREADY_RECORDED')).toContain('đã được ghi nhận');
    expect(messageOf('SOMETHING_ELSE <b>')).toBe(FINANCE_GENERIC_MESSAGE);
  });
});

describe('finance (B3a) - routes and menu', () => {
  it('parses the server states of the top-up list and the receiving accounts route; the old ?tab= still reads', () => {
    expect(parseRoute('/finance/topups', '?status=CONFIRMED')).toEqual({ name: 'finance-topups', status: 'CONFIRMED' });
    expect(parseRoute('/finance/topups', '?status=NOPE')).toEqual({ name: 'finance-topups' });
    expect(parseRoute('/finance/topups', '?tab=DONE')).toEqual({ name: 'finance-topups', tab: 'DONE' });
    expect(parseRoute('/finance/bank-accounts')).toEqual({ name: 'finance-bank-accounts' });
    expect(formatRoute({ name: 'finance-topups', status: 'REJECTED' })).toBe('/finance/topups?status=REJECTED');
    expect(formatRoute({ name: 'finance-bank-accounts' })).toBe('/finance/bank-accounts');
  });
  it('the finance READ right opens only the top-up pages; the receiving accounts are SYSTEM only; application rights open nothing of finance', () => {
    const read = new Set(['topups'] as const);
    expect(canOpenRoute('ADMIN', read, { name: 'finance-topups' })).toBe(true);
    expect(canOpenRoute('ADMIN', read, { name: 'finance-bank-accounts' })).toBe(false);
    expect(canOpenRoute('ADMIN', read, { name: 'finance-withdrawals' })).toBe(false);
    expect(canOpenRoute('ADMIN', new Set(['users', 'shops', 'drivers'] as const), { name: 'finance-topups' })).toBe(false);
    expect(visibleMenu('ADMIN', read).flatMap((g) => g.items.map((i) => i.id))).toContain('finance');
  });
});
