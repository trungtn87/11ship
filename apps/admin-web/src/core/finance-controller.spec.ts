import { describe, expect, it } from '@jest/globals';
import { FinanceController, FinanceScreen, isFinanceRoute } from './finance-controller';
import { FinanceLoad, FinanceSource, NOT_WIRED_FINANCE, TopupRow, WalletRow } from './finance';
import { Route } from './routes';

const wallets: WalletRow[] = Array.from({ length: 12 }, (_, index) => ({ id: `w${String(index)}`, code: `SHP${String(index + 1).padStart(3, '0')}`, name: `Shipper ${String(index + 1)}`, phoneMasked: '090• •••• 123', total: 1000 * (index + 1), held: index % 2 === 0 ? 100 : 0, status: 'ACTIVE' }));
const topups: TopupRow[] = [
  { id: 't1', code: 'NP1', createdAt: '2026-10-15T01:00:00.000Z', shipperName: 'A', phoneMasked: '', amount: 100000, bank: 'VCB', status: 'PENDING' },
  { id: 't2', code: 'NP2', createdAt: '2026-10-15T01:00:00.000Z', shipperName: 'B', phoneMasked: '', amount: 100000, bank: 'VCB', status: 'CONFIRMED' },
];

class Fake implements FinanceSource {
  reads = 0;
  hold: Array<(load: FinanceLoad<never>) => void> = [];
  answer: FinanceLoad<readonly WalletRow[]> = { kind: 'ready', data: wallets };
  overview = NOT_WIRED_FINANCE.overview;
  topups = (): Promise<FinanceLoad<readonly TopupRow[]>> => Promise.resolve({ kind: 'ready', data: topups });
  topup = NOT_WIRED_FINANCE.topup;
  withdrawals = NOT_WIRED_FINANCE.withdrawals;
  withdrawal = NOT_WIRED_FINANCE.withdrawal;
  ledger = NOT_WIRED_FINANCE.ledger;
  params = NOT_WIRED_FINANCE.params;
  held = false;
  walletsPending: Array<(load: FinanceLoad<readonly WalletRow[]>) => void> = [];
  wallets = (): Promise<FinanceLoad<readonly WalletRow[]>> => {
    this.reads += 1;
    if (this.held) {
      return new Promise((resolve) => this.walletsPending.push(resolve));
    }
    return Promise.resolve(this.answer);
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(route: Route, source: FinanceSource = new Fake()) {
  const events: FinanceScreen[] = [];
  const lost: string[] = [];
  const controller = new FinanceController({ source, route, onSessionLost: () => lost.push('lost'), onForbidden: () => lost.push('forbidden') });
  controller.subscribe((screen) => events.push(screen));
  return { controller, events, lost };
}

describe('FinanceController', () => {
  it('knows which routes it serves', () => {
    expect(isFinanceRoute({ name: 'finance' })).toBe(true);
    expect(isFinanceRoute({ name: 'wallet-params' })).toBe(true);
    expect(isFinanceRoute({ name: 'users' })).toBe(false);
  });

  it('starts loading, then shows page 1 of the wallets with their totals', async () => {
    const { controller } = setup({ name: 'finance-wallets' });
    expect(controller.screen).toMatchObject({ name: 'wallets', state: { kind: 'loading' } });
    controller.load();
    await tick();
    const screen = controller.screen;
    expect(screen.name).toBe('wallets');
    if (screen.name !== 'wallets' || screen.state.kind !== 'ready') {
      throw new Error('not ready');
    }
    expect(screen.state.data.rows.length).toBe(10);
    expect(screen.state.data.total).toBe(12);
    expect(screen.state.data.pages).toBe(2);
    expect(screen.totals).toEqual({ total: 78000, held: 600, available: 77400 });
    controller.page(2);
    const second = controller.screen;
    expect(second.name === 'wallets' && second.state.kind === 'ready' && second.state.data.rows.length).toBe(2);
  });

  it('a search that matches nothing is "filtered" empty; a list with nothing at all is plain empty', async () => {
    const source = new Fake();
    const { controller } = setup({ name: 'finance-wallets' }, source);
    controller.load();
    await tick();
    controller.search('zzz');
    expect(controller.screen).toMatchObject({ name: 'wallets', state: { kind: 'empty', filtered: true } });
    source.answer = { kind: 'ready', data: [] };
    controller.search('');
    controller.load();
    await tick();
    expect(controller.screen).toMatchObject({ name: 'wallets', state: { kind: 'empty', filtered: false } });
  });

  it('a new search goes back to page 1', async () => {
    const { controller } = setup({ name: 'finance-wallets' });
    controller.load();
    await tick();
    controller.page(2);
    controller.search('Shipper 1');
    const screen = controller.screen;
    expect(screen.name === 'wallets' && screen.state.kind === 'ready' && screen.state.data.page).toBe(1);
  });

  it('top-up tab comes from the route, defaults to the waiting tab, and counts every tab', async () => {
    const { controller } = setup({ name: 'finance-topups' });
    controller.load();
    await tick();
    const screen = controller.screen;
    if (screen.name !== 'topups' || screen.state.kind !== 'ready') {
      throw new Error('not ready');
    }
    expect(screen.tab).toBe('PENDING');
    expect(screen.state.data.rows.map((row) => row.id)).toEqual(['t1']);
    expect(screen.counts).toEqual({ PENDING: 1, DONE: 1, ALL: 2 });
    const done = setup({ name: 'finance-topups', tab: 'DONE' });
    done.controller.load();
    await tick();
    const doneScreen = done.controller.screen;
    expect(doneScreen.name === 'topups' && doneScreen.state.kind === 'ready' && doneScreen.state.data.rows.map((row) => row.id)).toEqual(['t2']);
  });

  it('a late answer of a replaced read is dropped', async () => {
    const source = new Fake();
    source.held = true;
    const { controller } = setup({ name: 'finance-wallets' }, source);
    controller.load();
    controller.load();
    expect(source.walletsPending.length).toBe(2);
    source.walletsPending[1]!({ kind: 'ready', data: wallets.slice(0, 1) });
    await tick();
    source.walletsPending[0]!({ kind: 'ready', data: wallets });
    await tick();
    const screen = controller.screen;
    expect(screen.name === 'wallets' && screen.state.kind === 'ready' && screen.state.data.total).toBe(1);
  });

  it('nothing is delivered after dispose (page left)', async () => {
    const source = new Fake();
    source.held = true;
    const { controller, events } = setup({ name: 'finance-wallets' }, source);
    controller.load();
    const before = events.length;
    controller.dispose();
    source.walletsPending[0]!({ kind: 'ready', data: wallets });
    await tick();
    expect(events.length).toBe(before);
    expect(controller.screen).toMatchObject({ state: { kind: 'loading' } });
  });

  it('401 ends the session and shows nothing; 403 asks to re-read the rights and says so', async () => {
    const source = new Fake();
    source.answer = { kind: 'failed', failure: 'session-expired' };
    const lost = setup({ name: 'finance-wallets' }, source);
    lost.controller.load();
    await tick();
    expect(lost.lost).toEqual(['lost']);
    expect(lost.controller.screen).toMatchObject({ state: { kind: 'loading' } });
    source.answer = { kind: 'failed', failure: 'forbidden' };
    const forbidden = setup({ name: 'finance-wallets' }, source);
    forbidden.controller.load();
    await tick();
    expect(forbidden.lost).toEqual(['forbidden']);
    expect(forbidden.controller.screen).toMatchObject({ state: { kind: 'failed', failure: 'forbidden' } });
  });

  it('the real (not wired) source gives a "not-wired" screen for every page and no data', async () => {
    const routes: Route[] = [{ name: 'finance' }, { name: 'finance-wallets' }, { name: 'finance-topups' }, { name: 'finance-topup', id: 'x' }, { name: 'finance-withdrawals' }, { name: 'finance-withdrawal', id: 'x' }, { name: 'finance-transactions' }, { name: 'finance-reconciliation' }, { name: 'wallet-params' }];
    for (const route of routes) {
      const { controller } = setup(route, NOT_WIRED_FINANCE);
      controller.load();
      await tick();
      expect(controller.screen.state.kind).toBe('not-wired');
    }
  });

  it('the top-up form keeps what was typed and only reports after an attempt', () => {
    const { controller } = setup({ name: 'finance-topup', id: 'x' });
    controller.topupDraft({ actualAmount: '90000', bankReference: '', note: 'ghi chú' });
    const screen = controller.screen;
    expect(screen).toMatchObject({ name: 'topup', draft: { actualAmount: '90000', note: 'ghi chú' }, attempted: undefined });
    controller.attemptTopup('confirm');
    expect(controller.screen).toMatchObject({ attempted: 'confirm' });
  });

  it('the parameters draft starts from what the server said and "Hủy" returns to it', async () => {
    const source: FinanceSource = { ...NOT_WIRED_FINANCE, params: () => Promise.resolve({ kind: 'ready', data: { params: { minTopup: 100000, minWithdraw: 10000, commissionPerOrder: 1000 }, history: [] } }) };
    const { controller } = setup({ name: 'wallet-params' }, source);
    controller.load();
    await tick();
    expect(controller.screen).toMatchObject({ name: 'params', draft: { minTopup: '100000', minWithdraw: '10000', commissionPerOrder: '1000' }, attempted: false });
    controller.paramsDraft({ minTopup: '200000', minWithdraw: '10000', commissionPerOrder: '1000' });
    controller.attemptParams();
    expect(controller.screen).toMatchObject({ draft: { minTopup: '200000' }, attempted: true });
    controller.resetParams();
    expect(controller.screen).toMatchObject({ draft: { minTopup: '100000' }, attempted: false });
  });

  it('opens the ledger already filtered by the shipper of the route', () => {
    const { controller } = setup({ name: 'finance-transactions', shipper: 'Nguyễn Văn A' });
    expect(controller.screen).toMatchObject({ name: 'ledger', mode: 'transactions', filter: { shipper: 'Nguyễn Văn A' } });
    expect(setup({ name: 'finance-reconciliation' }).controller.screen).toMatchObject({ mode: 'reconciliation' });
  });
});
