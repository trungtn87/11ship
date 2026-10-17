// Controller of the finance pages (M04, UI phase). It owns what one page needs between renders (filter, tab, page, the drafts of the two
// forms) and the one read in flight, and NOTHING else: no row outlives the page (`dispose`), and there is no write at all in this phase.
// The buttons that would change money (confirm / reject a top-up, process a withdrawal, save the parameters) are drawn by the view and
// stay disabled until a later package connects them; this controller has no method that could move money.
//
// Rules pinned by finance-controller.spec.ts:
//  * a late answer of a page that was left, or of a read that was replaced, is dropped;
//  * 401 ends the session (onSessionLost), 403 re-reads the administrator's rights (onForbidden);
//  * a list that is empty because of the filter says so ("filtered"), a list that is empty without a filter says nothing exists;
//  * typing never rewrites the draft: validation only reports (errors appear after a first attempt).

import {
  availableOf,
  EMPTY_LEDGER_FILTER,
  FINANCE_PAGE_SIZE,
  filterLedger,
  filterTopups,
  filterWallets,
  filterWithdrawals,
  FinanceLoad,
  FinanceOverview,
  FinanceSource,
  LedgerData,
  LedgerFilter,
  LedgerRow,
  paginate,
  ReconciliationSummary,
  TOPUP_EMPTY_DRAFT,
  TopupDecisionDraft,
  TopupDetail,
  TopupRow,
  TopupTab,
  WalletParamsData,
  WalletParamsDraft,
  WalletRow,
  WithdrawalDetail,
  WithdrawalRow,
  WithdrawalTab,
  draftOf,
  topupCounts,
  withdrawalCounts,
} from './finance.js';
import { Route } from './routes.js';

/** One page of a filtered list. `total` counts the rows that match, not the rows on the page. */
export interface ListView<Row> {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly page: number;
  readonly pages: number;
}

export type FinanceScreen =
  | { readonly name: 'overview'; readonly state: FinanceLoad<FinanceOverview> }
  | { readonly name: 'wallets'; readonly query: string; readonly state: FinanceLoad<ListView<WalletRow>>; readonly totals?: { readonly total: number; readonly held: number; readonly available: number } }
  | { readonly name: 'topups'; readonly tab: TopupTab; readonly query: string; readonly counts?: Record<TopupTab, number>; readonly state: FinanceLoad<ListView<TopupRow>> }
  | { readonly name: 'topup'; readonly state: FinanceLoad<TopupDetail>; readonly draft: TopupDecisionDraft; readonly attempted: 'confirm' | 'reject' | undefined }
  | { readonly name: 'withdrawals'; readonly tab: WithdrawalTab; readonly query: string; readonly counts?: Record<WithdrawalTab, number>; readonly state: FinanceLoad<ListView<WithdrawalRow>> }
  | { readonly name: 'withdrawal'; readonly state: FinanceLoad<WithdrawalDetail> }
  | { readonly name: 'ledger'; readonly mode: 'transactions' | 'reconciliation'; readonly filter: LedgerFilter; readonly summary?: ReconciliationSummary; readonly state: FinanceLoad<ListView<LedgerRow>> }
  | { readonly name: 'params'; readonly state: FinanceLoad<WalletParamsData>; readonly draft: WalletParamsDraft | undefined; readonly attempted: boolean };

export interface FinanceDeps {
  readonly source: FinanceSource;
  readonly route: Route;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
}

type Listener = (screen: FinanceScreen) => void;

/** The routes this controller serves. */
export type FinanceRoute = Extract<
  Route,
  | { name: 'finance' }
  | { name: 'finance-wallets' }
  | { name: 'finance-topups' }
  | { name: 'finance-topup' }
  | { name: 'finance-withdrawals' }
  | { name: 'finance-withdrawal' }
  | { name: 'finance-transactions' }
  | { name: 'finance-reconciliation' }
  | { name: 'wallet-params' }
>;

export function isFinanceRoute(route: Route): route is FinanceRoute {
  return route.name.startsWith('finance') || route.name === 'wallet-params';
}

type Raw =
  | { readonly kind: 'overview'; readonly load: FinanceLoad<FinanceOverview> }
  | { readonly kind: 'wallets'; readonly load: FinanceLoad<readonly WalletRow[]> }
  | { readonly kind: 'topups'; readonly load: FinanceLoad<readonly TopupRow[]> }
  | { readonly kind: 'topup'; readonly load: FinanceLoad<TopupDetail> }
  | { readonly kind: 'withdrawals'; readonly load: FinanceLoad<readonly WithdrawalRow[]> }
  | { readonly kind: 'withdrawal'; readonly load: FinanceLoad<WithdrawalDetail> }
  | { readonly kind: 'ledger'; readonly load: FinanceLoad<LedgerData> }
  | { readonly kind: 'params'; readonly load: FinanceLoad<WalletParamsData> };

const LOADING = { kind: 'loading' } as const;

export class FinanceController {
  readonly #listeners = new Set<Listener>();
  #raw: Raw;
  #query = '';
  #page = 1;
  #ledgerFilter: LedgerFilter = EMPTY_LEDGER_FILTER;
  #topupDraft: TopupDecisionDraft = TOPUP_EMPTY_DRAFT;
  #attempted: 'confirm' | 'reject' | undefined;
  #paramsDraft: WalletParamsDraft | undefined;
  #paramsAttempted = false;
  #latest = 0;
  #disposed = false;

  constructor(private readonly deps: FinanceDeps) {
    this.#raw = this.#initial();
    // "Xem giao dịch" of a wallet opens the ledger already filtered by that shipper.
    if (deps.route.name === 'finance-transactions' && deps.route.shipper !== undefined) {
      this.#ledgerFilter = { ...EMPTY_LEDGER_FILTER, shipper: deps.route.shipper };
    }
  }

  #route(): FinanceRoute {
    return this.deps.route as FinanceRoute;
  }

  #initial(): Raw {
    switch (this.#route().name) {
      case 'finance':
        return { kind: 'overview', load: LOADING };
      case 'finance-wallets':
        return { kind: 'wallets', load: LOADING };
      case 'finance-topups':
        return { kind: 'topups', load: LOADING };
      case 'finance-topup':
        return { kind: 'topup', load: LOADING };
      case 'finance-withdrawals':
        return { kind: 'withdrawals', load: LOADING };
      case 'finance-withdrawal':
        return { kind: 'withdrawal', load: LOADING };
      case 'finance-transactions':
      case 'finance-reconciliation':
        return { kind: 'ledger', load: LOADING };
      case 'wallet-params':
        return { kind: 'params', load: LOADING };
    }
  }

  get screen(): FinanceScreen {
    const raw = this.#raw;
    const route = this.#route();
    switch (raw.kind) {
      case 'overview':
        return { name: 'overview', state: raw.load };
      case 'wallets': {
        const view = this.#list(raw.load, (rows) => filterWallets(rows, this.#query));
        const rows = raw.load.kind === 'ready' ? raw.load.data : [];
        const totals = raw.load.kind === 'ready' ? { total: sum(rows.map((row) => row.total)), held: sum(rows.map((row) => row.held)), available: sum(rows.map(availableOf)) } : undefined;
        return { name: 'wallets', query: this.#query, state: view, ...(totals === undefined ? {} : { totals }) };
      }
      case 'topups': {
        const tab = route.name === 'finance-topups' ? (route.tab ?? 'PENDING') : 'PENDING';
        const counts = raw.load.kind === 'ready' ? topupCounts(raw.load.data) : undefined;
        return { name: 'topups', tab, query: this.#query, state: this.#list(raw.load, (rows) => filterTopups(rows, tab, this.#query)), ...(counts === undefined ? {} : { counts }) };
      }
      case 'topup':
        return { name: 'topup', state: raw.load, draft: this.#topupDraft, attempted: this.#attempted };
      case 'withdrawals': {
        const tab = route.name === 'finance-withdrawals' ? (route.tab ?? 'PENDING') : 'PENDING';
        const counts = raw.load.kind === 'ready' ? withdrawalCounts(raw.load.data) : undefined;
        return { name: 'withdrawals', tab, query: this.#query, state: this.#list(raw.load, (rows) => filterWithdrawals(rows, tab, this.#query)), ...(counts === undefined ? {} : { counts }) };
      }
      case 'withdrawal':
        return { name: 'withdrawal', state: raw.load };
      case 'ledger': {
        const mode = route.name === 'finance-reconciliation' ? 'reconciliation' : 'transactions';
        const rows = raw.load.kind === 'ready' ? raw.load.data.rows : [];
        const state = this.#list(raw.load.kind === 'ready' ? ({ kind: 'ready', data: rows } as const) : raw.load, (all) => filterLedger(all, this.#ledgerFilter));
        return { name: 'ledger', mode, filter: this.#ledgerFilter, state, ...(raw.load.kind === 'ready' ? { summary: raw.load.data.summary } : {}) };
      }
      case 'params': {
        const draft = this.#paramsDraft ?? (raw.load.kind === 'ready' ? draftOf(raw.load.data.params) : undefined);
        return { name: 'params', state: raw.load, draft, attempted: this.#paramsAttempted };
      }
    }
  }

  /** Applies the filter and the page to a loaded list; every other state passes through unchanged. */
  #list<Row>(load: FinanceLoad<readonly Row[]>, filter: (rows: readonly Row[]) => readonly Row[]): FinanceLoad<ListView<Row>> {
    if (load.kind !== 'ready') {
      return load;
    }
    const matching = filter(load.data);
    if (load.data.length === 0) {
      return { kind: 'empty', filtered: false };
    }
    if (matching.length === 0) {
      return { kind: 'empty', filtered: true };
    }
    const page = paginate(matching, this.#page, FINANCE_PAGE_SIZE);
    return { kind: 'ready', data: { rows: page.rows, total: matching.length, page: page.page, pages: page.pages } };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#latest += 1;
    this.#listeners.clear();
    this.#raw = this.#initial();
    this.#topupDraft = TOPUP_EMPTY_DRAFT;
    this.#paramsDraft = undefined;
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }
    const screen = this.screen;
    for (const listener of [...this.#listeners]) {
      listener(screen);
    }
  }

  /** Reads the page's data again (first load, "Làm mới", "Thử lại"). A newer read replaces an older one. */
  load(): void {
    this.#latest += 1;
    const token = this.#latest;
    const route = this.#route();
    this.#raw = this.#initial();
    this.#emit();
    const source = this.deps.source;
    const settle = <T>(load: FinanceLoad<T>, make: (load: FinanceLoad<T>) => Raw): void => {
      if (this.#disposed || token !== this.#latest) {
        return;
      }
      if (load.kind === 'failed' && load.failure === 'session-expired') {
        this.deps.onSessionLost();
        return;
      }
      if (load.kind === 'failed' && load.failure === 'forbidden') {
        this.deps.onForbidden();
      }
      this.#raw = make(load);
      this.#emit();
    };
    switch (route.name) {
      case 'finance':
        void source.overview().then((load) => settle(load, (value) => ({ kind: 'overview', load: value })));
        return;
      case 'finance-wallets':
        void source.wallets().then((load) => settle(load, (value) => ({ kind: 'wallets', load: value })));
        return;
      case 'finance-topups':
        void source.topups().then((load) => settle(load, (value) => ({ kind: 'topups', load: value })));
        return;
      case 'finance-topup':
        void source.topup(route.id).then((load) => settle(load, (value) => ({ kind: 'topup', load: value })));
        return;
      case 'finance-withdrawals':
        void source.withdrawals().then((load) => settle(load, (value) => ({ kind: 'withdrawals', load: value })));
        return;
      case 'finance-withdrawal':
        void source.withdrawal(route.id).then((load) => settle(load, (value) => ({ kind: 'withdrawal', load: value })));
        return;
      case 'finance-transactions':
      case 'finance-reconciliation':
        void source.ledger().then((load) => settle(load, (value) => ({ kind: 'ledger', load: value })));
        return;
      case 'wallet-params':
        void source.params().then((load) => settle(load, (value) => ({ kind: 'params', load: value })));
        return;
    }
  }

  /** Search text of a list. Back to page 1. */
  search(query: string): void {
    this.#query = query;
    this.#page = 1;
    this.#emit();
  }

  page(page: number): void {
    this.#page = Math.max(1, Math.trunc(page) || 1);
    this.#emit();
  }

  ledgerFilter(next: Partial<LedgerFilter>): void {
    this.#ledgerFilter = { ...this.#ledgerFilter, ...next };
    this.#page = 1;
    this.#emit();
  }

  topupDraft(draft: TopupDecisionDraft): void {
    this.#topupDraft = draft;
    this.#emit();
  }

  /** The admin pressed Xác nhận / Từ chối: from now on the view shows what is missing. Nothing is sent. */
  attemptTopup(action: 'confirm' | 'reject'): void {
    this.#attempted = action;
    this.#emit();
  }

  paramsDraft(draft: WalletParamsDraft): void {
    this.#paramsDraft = draft;
    this.#emit();
  }

  attemptParams(): void {
    this.#paramsAttempted = true;
    this.#emit();
  }

  /** "Hủy": back to what the server last said. */
  resetParams(): void {
    this.#paramsDraft = undefined;
    this.#paramsAttempted = false;
    this.#emit();
  }
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
