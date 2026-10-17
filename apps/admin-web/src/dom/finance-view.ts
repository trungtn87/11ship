import { FinanceScreen, ListView } from '../core/finance-controller.js';
import {
  availableOf,
  BANK_REFERENCE_MAX,
  canDecideTopup,
  ChartDay,
  FINANCE_ACTION_DISABLED,
  FINANCE_PAGE_SIZE,
  FinanceLoad,
  FinanceOverview,
  formatVnd,
  formatVndSigned,
  LEDGER_STATUS_LABEL,
  LEDGER_TYPE_LABEL,
  LedgerFilter,
  LedgerRow,
  LedgerStatus,
  LedgerType,
  movesBalance,
  NOTE_MAX,
  reconciliationDifference,
  ReconciliationSummary,
  TOPUP_STATUS_LABEL,
  TOPUP_TAB_LABEL,
  TOPUP_TABS,
  TopupDecisionDraft,
  TopupDetail,
  TopupRow,
  TopupStatus,
  TopupTab,
  validateTopupDecision,
  validateWalletParams,
  WALLET_PARAM_HINT,
  WALLET_PARAM_KEYS,
  WALLET_PARAM_LABEL,
  WALLET_PARAMS_NOT_SAVED,
  WalletParamChange,
  WalletParamsData,
  WalletParamsDraft,
  WalletRow,
  WALLET_STATUS_LABEL,
  WalletStatus,
  WITHDRAWAL_ACTION_LABEL,
  WITHDRAWAL_STATUS_LABEL,
  WITHDRAWAL_TAB_LABEL,
  WITHDRAWAL_TABS,
  WithdrawalAction,
  WithdrawalDetail,
  withdrawalActions,
  WithdrawalRow,
  WithdrawalStatus,
  WithdrawalTab,
} from '../core/finance.js';
import { formatRoute, Route } from '../core/routes.js';
import { formatDateTimeVn } from './accounts-view.js';
import { h, setMessage, svg } from './dom.js';
import { icon, UiIconName } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Tài chính" (M04-A01 ... M04-A07). It draws the screen model of core/finance-controller.ts and nothing else: no value of its own, no
// request, nothing stored. Every node is created with createElement/textContent (no innerHTML). A button that would change money is drawn
// DISABLED, with its reason in words, until `hooks.wired` is true (a later backend package); the design preview passes `wired: true` and only
// shows that it is a demonstration. The view never computes a balance: it prints the figures it was given (available = total - held is
// computed once, in core/finance.ts).

export interface FinanceHooks {
  readonly wired: boolean;
  retry(): void;
  login(): void;
  home(): void;
  refresh(): void;
  open(route: Route): void;
  search(query: string): void;
  page(page: number): void;
  ledgerFilter(next: Partial<LedgerFilter>): void;
  topupDraft(draft: TopupDecisionDraft): void;
  topupAttempt(action: 'confirm' | 'reject'): void;
  topupDecide(action: 'confirm' | 'reject'): void;
  withdrawalAct(action: WithdrawalAction): void;
  paramsDraft(draft: WalletParamsDraft): void;
  paramsAttempt(): void;
  paramsSave(): void;
  paramsReset(): void;
  exportLedger(): void;
}

// ---- small pieces -------------------------------------------------------------------------------------------------------------

interface Column {
  readonly label: string;
  readonly end?: boolean;
  readonly num?: boolean;
}

function cellClass(column: Column): string {
  return [column.end ? 'cell-end' : '', column.num ? 'cell-num' : ''].join(' ').trim();
}

/** A table whose header is always drawn; the body is rows, or one panel (loading, empty, failed...) spanning all columns. */
function tableCard(caption: string, columns: readonly Column[], body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
  const head = h('tr', {}, ...columns.map((column) => h('th', { scope: 'col', class: cellClass(column) }, column.label)));
  const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
  return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...rows)));
}

function td(column: Column, ...children: (Node | string | undefined)[]): HTMLElement {
  return h('td', { 'data-label': column.label, class: cellClass(column) }, ...children);
}

function pageHead(title: string, subtitle: string, id: string, ...actions: (HTMLElement | undefined)[]): HTMLElement {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id }, title), h('p', { class: 'lead lead-last' }, subtitle)), ...actions);
}

function badge(kind: 'ok' | 'lock' | 'wait' | 'neutral', label: string, iconName: UiIconName): HTMLElement {
  return h('span', { class: `badge${kind === 'neutral' ? '' : ` badge-${kind}`}` }, icon(iconName, 14), label);
}

const TOPUP_BADGE: Record<TopupStatus, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  PENDING: ['wait', 'clock'],
  CONFIRMED: ['ok', 'check'],
  REJECTED: ['lock', 'x'],
  CANCELLED: ['neutral', 'x'],
};
const WITHDRAWAL_BADGE: Record<WithdrawalStatus, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  PENDING: ['wait', 'clock'],
  PROCESSING: ['neutral', 'refresh'],
  NEEDS_RECONCILE: ['lock', 'alert'],
  COMPLETED: ['ok', 'check'],
  CANCELLED: ['neutral', 'x'],
};
const WALLET_BADGE: Record<WalletStatus, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  ACTIVE: ['ok', 'check'],
  LOCKED: ['wait', 'lock'],
  CLOSED: ['neutral', 'x'],
};
const LEDGER_BADGE: Record<LedgerStatus, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  SUCCESS: ['ok', 'check'],
  PENDING: ['wait', 'clock'],
  FAILED: ['lock', 'x'],
};

const topupBadge = (status: TopupStatus): HTMLElement => badge(TOPUP_BADGE[status][0], TOPUP_STATUS_LABEL[status], TOPUP_BADGE[status][1]);
const withdrawalBadge = (status: WithdrawalStatus): HTMLElement => badge(WITHDRAWAL_BADGE[status][0], WITHDRAWAL_STATUS_LABEL[status], WITHDRAWAL_BADGE[status][1]);

function plainClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function definition(items: readonly (readonly [string, Node | string])[]): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function person(name: string, phone: string): HTMLElement {
  return h('span', { class: 'cell-person' }, h('span', { class: 'cell-name' }, name), h('span', { class: 'muted' }, phone));
}

function pager(view: { readonly total: number; readonly page: number; readonly pages: number }, go: (page: number) => void): HTMLElement {
  const from = (view.page - 1) * FINANCE_PAGE_SIZE + 1;
  const to = Math.min(view.total, view.page * FINANCE_PAGE_SIZE);
  const previous = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, 'Trước');
  const next = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, 'Sau');
  previous.disabled = view.page <= 1;
  next.disabled = view.page >= view.pages;
  previous.addEventListener('click', () => go(view.page - 1));
  next.addEventListener('click', () => go(view.page + 1));
  return h(
    'div',
    { class: 'pager' },
    h('p', { class: 'pager-text', role: 'status' }, `Hiển thị ${String(from)} - ${String(to)} / ${String(view.total)}`),
    h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page' }, `Trang ${String(view.page)} / ${String(view.pages)}`), next),
  );
}

function tabs<T extends string>(label: string, items: readonly { readonly id: T; readonly label: string; readonly count?: number | undefined }[], active: T, pick: (id: T) => void, enabled: boolean): HTMLElement {
  return h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': label },
    ...items.map((item) => {
      const button = h(
        'button',
        { type: 'button', role: 'tab', class: `tab${item.id === active ? ' tab-active' : ''}`, 'aria-selected': String(item.id === active), id: `tab-${item.id.toLowerCase()}` },
        item.count === undefined ? item.label : `${item.label} (${String(item.count)})`,
      );
      button.disabled = !enabled;
      button.addEventListener('click', () => pick(item.id));
      return button;
    }),
  );
}

function searchBox(id: string, placeholder: string, value: string, enabled: boolean, input: (value: string) => void): HTMLElement {
  const box = h('input', { id, type: 'search', class: 'search-input', placeholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder, maxlength: '80' });
  box.value = value;
  box.disabled = !enabled;
  box.addEventListener('input', () => input(box.value));
  return h('div', { class: 'search' }, icon('search', 18), box);
}

function refreshButton(hooks: FinanceHooks, enabled: boolean): HTMLButtonElement {
  const button = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
  button.disabled = !enabled;
  button.addEventListener('click', () => hooks.refresh());
  return button;
}

function backButton(label: string, to: Route, hooks: FinanceHooks): HTMLElement {
  const back = h('button', { type: 'button', class: 'link-btn back' }, icon('arrow-left', 16), label);
  back.addEventListener('click', () => hooks.open(to));
  return back;
}

function rowLink(route: Route, label: string, hooks: FinanceHooks): HTMLElement {
  const link = h('a', { href: formatRoute(route), class: 'table-link', 'aria-label': label }, 'Xem');
  link.addEventListener('click', (event) => {
    if (plainClick(event)) {
      event.preventDefault();
      hooks.open(route);
    }
  });
  return link;
}

/** The panel of a non-ready state of one list/detail; undefined when `state` is ready. */
function statePanelOf(state: FinanceLoad<unknown>, hooks: FinanceHooks, emptyText: { readonly none: string; readonly filtered: string }): HTMLElement | undefined {
  switch (state.kind) {
    case 'not-wired':
      return notWiredPanel(state.reason);
    case 'loading':
      return skeleton();
    case 'failed':
      return failurePanel(state.failure, { retry: () => hooks.retry(), login: () => hooks.login(), home: () => hooks.home() }, state.retryAfterSec);
    case 'empty':
      return state.filtered ? emptyPanel('Không có kết quả phù hợp', emptyText.filtered) : emptyPanel('Chưa có dữ liệu', emptyText.none);
    case 'ready':
      return undefined;
  }
}

/** Why a money button is disabled: written next to it, not hidden in a tooltip. */
const disabledNote = (): HTMLElement => h('p', { class: 'hint hint-block', role: 'note' }, FINANCE_ACTION_DISABLED);

function errorLine(id: string, text: string | undefined): HTMLElement {
  const line = h('p', { id, class: 'message message-error', role: 'alert' });
  setMessage(line, text);
  return line;
}

/** A labelled text input (or textarea) whose value comes from the draft; errors are patched in by the caller. */
function textField(options: { readonly id: string; readonly label: string; readonly value: string; readonly enabled: boolean; readonly error?: string | undefined; readonly numeric?: boolean; readonly multiline?: boolean; readonly maxLength?: number; readonly hint?: string; readonly onInput: (value: string) => void }): HTMLElement {
  const errorId = `${options.id}-error`;
  const common = { id: options.id, 'aria-describedby': errorId, ...(options.error === undefined ? {} : { 'aria-invalid': 'true' }), ...(options.maxLength === undefined ? {} : { maxlength: String(options.maxLength) }) };
  let control: HTMLInputElement | HTMLTextAreaElement;
  if (options.multiline === true) {
    control = h('textarea', { ...common, class: 'textarea', rows: '3' });
  } else {
    control = h('input', { ...common, type: 'text', autocomplete: 'off', spellcheck: 'false', ...(options.numeric === true ? { inputmode: 'numeric' } : {}) });
  }
  control.value = options.value;
  control.disabled = !options.enabled;
  control.addEventListener('input', () => options.onInput(control.value));
  return h(
    'div',
    { class: 'field' },
    h('label', { for: options.id, class: 'label' }, options.label),
    options.multiline === true ? control : h('div', { class: 'input-wrap' }, control),
    options.hint === undefined ? undefined : h('p', { class: 'hint' }, options.hint),
    errorLine(errorId, options.error),
  );
}

function amountCell(value: number): HTMLElement {
  return h('span', { class: value > 0 ? 'amount-in' : value < 0 ? 'amount-out' : '' }, formatVndSigned(value));
}

// ---- the view -----------------------------------------------------------------------------------------------------------------

export class FinanceView {
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: FinanceHooks,
  ) {}

  render(screen: FinanceScreen): void {
    // Typing in a field re-renders the page: keep the caret where it was.
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && this.root.contains(active) ? active.id : '';
    const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? ([active.selectionStart, active.selectionEnd] as const) : undefined;
    this.root.replaceChildren(this.#page(screen));
    if (focusId !== '') {
      const next = document.getElementById(focusId);
      if (next instanceof HTMLElement && !(next as HTMLButtonElement).disabled) {
        next.focus();
        if (selection !== undefined && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) && selection[0] !== null && selection[1] !== null) {
          try {
            next.setSelectionRange(selection[0], selection[1]);
          } catch {
            // date and search inputs without a selection range: the focus is enough
          }
        }
      }
    }
  }

  #page(screen: FinanceScreen): HTMLElement {
    switch (screen.name) {
      case 'overview':
        return this.#overview(screen.state);
      case 'wallets':
        return this.#wallets(screen);
      case 'topups':
        return this.#topups(screen);
      case 'topup':
        return this.#topup(screen);
      case 'withdrawals':
        return this.#withdrawals(screen);
      case 'withdrawal':
        return this.#withdrawal(screen.state);
      case 'ledger':
        return this.#ledger(screen);
      case 'params':
        return this.#params(screen);
    }
  }

  #section(titleId: string, ...children: (HTMLElement | undefined)[]): HTMLElement {
    return h('section', { class: 'content content-wide', 'aria-labelledby': titleId }, ...children);
  }

  // ---- M04-A01 overview ---------------------------------------------------------------------------------------------------

  #overview(state: FinanceLoad<FinanceOverview>): HTMLElement {
    const head = pageHead('Tổng quan tài chính', 'Số dư ví Shipper, yêu cầu nạp/rút đang chờ và biến động giao dịch.', 'finance-title', refreshButton(this.hooks, this.hooks.wired && state.kind !== 'loading'));
    const panel = statePanelOf(state, this.hooks, { none: 'Chưa có số liệu tài chính.', filtered: 'Không có số liệu trong khoảng thời gian này.' });
    if (panel !== undefined || state.kind !== 'ready') {
      return this.#section('finance-title', head, h('div', { class: 'table-card' }, panel));
    }
    const data = state.data;
    const link = (route: Route, label: string, value: string, iconName: UiIconName, tone: string): HTMLElement => {
      const anchor = h('a', { href: formatRoute(route), class: `kpi kpi-link ${tone}` }, h('span', { class: 'kpi-icon' }, icon(iconName, 22)), h('span', { class: 'kpi-body' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value)));
      anchor.addEventListener('click', (event) => {
        if (plainClick(event)) {
          event.preventDefault();
          this.hooks.open(route);
        }
      });
      return anchor;
    };
    const plain = (label: string, value: string, iconName: UiIconName, tone: string): HTMLElement =>
      h('div', { class: `kpi ${tone}` }, h('span', { class: 'kpi-icon' }, icon(iconName, 22)), h('span', { class: 'kpi-body' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value)));
    const from = h('input', { id: 'finance-from', type: 'date', class: 'date-input', 'aria-label': 'Từ ngày' });
    const to = h('input', { id: 'finance-to', type: 'date', class: 'date-input', 'aria-label': 'Đến ngày' });
    for (const input of [from, to]) {
      input.disabled = !this.hooks.wired;
      input.addEventListener('change', () => this.hooks.refresh());
    }
    return this.#section(
      'finance-title',
      head,
      h('div', { class: 'toolbar toolbar-filters', role: 'group', 'aria-label': 'Khoảng thời gian' }, h('label', { class: 'label', for: 'finance-from' }, 'Từ ngày'), from, h('label', { class: 'label', for: 'finance-to' }, 'Đến ngày'), to),
      h(
        'div',
        { class: 'kpi-grid' },
        plain('Tổng số dư ví', formatVnd(data.totalBalance), 'wallet', 'kpi-ok'),
        plain('Tổng tiền tạm giữ', formatVnd(data.totalHeld), 'lock', 'kpi-warn'),
        link({ name: 'finance-topups', tab: 'PENDING' }, 'Yêu cầu nạp chờ xác nhận', String(data.pendingTopups), 'plus-circle', 'kpi-info'),
        link({ name: 'finance-withdrawals', tab: 'PENDING' }, 'Yêu cầu rút chờ xử lý', String(data.pendingWithdrawals), 'minus-circle', 'kpi-warn'),
        plain('Hoa hồng đã thu', formatVnd(data.commissionCollected), 'receipt', 'kpi-ok'),
        plain('Giao dịch hôm nay', String(data.transactionsToday), 'activity', 'kpi-info'),
      ),
      h('p', { class: 'hint hint-block' }, 'Tiền tạm giữ là thông tin giữ chỗ (hoa hồng đơn đang giao, yêu cầu rút đang chờ), không phải khoản đã trừ khỏi sổ cái.'),
      h('section', { class: 'detail-block', 'aria-labelledby': 'finance-chart-title' }, h('h2', { class: 'subtitle', id: 'finance-chart-title' }, 'Biến động giao dịch'), chart(data.chart)),
    );
  }

  // ---- M04-A02 wallets ----------------------------------------------------------------------------------------------------

  #wallets(screen: Extract<FinanceScreen, { name: 'wallets' }>): HTMLElement {
    const usable = this.hooks.wired && screen.state.kind !== 'not-wired';
    const head = pageHead('Danh sách ví Shipper', 'Mỗi Shipper một ví. Khả dụng = tổng số dư − tiền tạm giữ.', 'wallets-title', exportButton(this.hooks, 'wallets-export'));
    const toolbar = h(
      'div',
      { class: 'toolbar toolbar-filters', role: 'search' },
      searchBox('wallets-search', 'Tìm theo tên, số điện thoại, mã Shipper', screen.query, usable, (value) => this.hooks.search(value)),
      refreshButton(this.hooks, usable && screen.state.kind !== 'loading'),
    );
    const columns: readonly Column[] = [{ label: 'Mã' }, { label: 'Shipper' }, { label: 'Tổng số dư', num: true }, { label: 'Tạm giữ', num: true }, { label: 'Khả dụng', num: true }, { label: 'Trạng thái' }, { label: 'Thao tác', end: true }];
    const caption = 'Danh sách ví Shipper';
    const panel = statePanelOf(screen.state, this.hooks, { none: 'Chưa có ví Shipper nào.', filtered: 'Thử đổi từ khóa tìm kiếm.' });
    if (panel !== undefined || screen.state.kind !== 'ready') {
      return this.#section('wallets-title', head, toolbar, tableCard(caption, columns, { panel: panel ?? h('div') }));
    }
    const view: ListView<WalletRow> = screen.state.data;
    const rows = view.rows.map((row) =>
      h(
        'tr',
        {},
        td(columns[0]!, row.code),
        td(columns[1]!, person(row.name, row.phoneMasked)),
        td(columns[2]!, formatVnd(row.total)),
        td(columns[3]!, formatVnd(row.held)),
        td(columns[4]!, h('strong', {}, formatVnd(availableOf(row)))),
        td(columns[5]!, badge(WALLET_BADGE[row.status][0], WALLET_STATUS_LABEL[row.status], WALLET_BADGE[row.status][1])),
        td(columns[6]!, rowLink({ name: 'finance-transactions', shipper: row.name }, `Xem giao dịch của ${row.name}`, this.hooks)),
      ),
    );
    const totals = screen.totals;
    return this.#section(
      'wallets-title',
      head,
      toolbar,
      tableCard(caption, columns, { rows }),
      totals === undefined ? undefined : h('p', { class: 'hint hint-block' }, `Tổng các ví trong danh sách: số dư ${formatVnd(totals.total)} · tạm giữ ${formatVnd(totals.held)} · khả dụng ${formatVnd(totals.available)}.`),
      pager(view, (page) => this.hooks.page(page)),
    );
  }

  // ---- M04-A03 top-up requests --------------------------------------------------------------------------------------------

  #topups(screen: Extract<FinanceScreen, { name: 'topups' }>): HTMLElement {
    const usable = this.hooks.wired && screen.state.kind !== 'not-wired';
    const head = pageHead('Yêu cầu nạp tiền', 'Kiểm tra chuyển khoản và ghi nhận số tiền ngân hàng thực nhận.', 'topups-title');
    const tabBar = tabs<TopupTab>(
      'Lọc yêu cầu nạp',
      TOPUP_TABS.map((id) => ({ id, label: TOPUP_TAB_LABEL[id], count: screen.counts?.[id] })),
      screen.tab,
      (tab) => this.hooks.open({ name: 'finance-topups', tab }),
      usable,
    );
    const toolbar = h('div', { class: 'toolbar toolbar-filters', role: 'search' }, searchBox('topups-search', 'Tìm theo tên, SĐT, mã yêu cầu', screen.query, usable, (value) => this.hooks.search(value)), refreshButton(this.hooks, usable && screen.state.kind !== 'loading'));
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Mã yêu cầu' }, { label: 'Shipper' }, { label: 'Số tiền', num: true }, { label: 'Ngân hàng' }, { label: 'Trạng thái' }, { label: 'Thao tác', end: true }];
    const caption = 'Danh sách yêu cầu nạp tiền';
    const panel = statePanelOf(screen.state, this.hooks, { none: 'Chưa có yêu cầu nạp tiền nào.', filtered: 'Không có yêu cầu nào trong mục này. Thử đổi mục hoặc từ khóa.' });
    if (panel !== undefined || screen.state.kind !== 'ready') {
      return this.#section('topups-title', head, tabBar, toolbar, tableCard(caption, columns, { panel: panel ?? h('div') }));
    }
    const view: ListView<TopupRow> = screen.state.data;
    const rows = view.rows.map((row) =>
      h(
        'tr',
        {},
        td(columns[0]!, formatDateTimeVn(row.createdAt)),
        td(columns[1]!, row.code),
        td(columns[2]!, person(row.shipperName, row.phoneMasked)),
        td(columns[3]!, h('strong', {}, formatVnd(row.amount))),
        td(columns[4]!, row.bank),
        td(columns[5]!, topupBadge(row.status)),
        td(columns[6]!, rowLink({ name: 'finance-topup', id: row.id }, `Xem yêu cầu ${row.code}`, this.hooks)),
      ),
    );
    return this.#section('topups-title', head, tabBar, toolbar, tableCard(caption, columns, { rows }), pager(view, (page) => this.hooks.page(page)));
  }

  // ---- M04-A04 top-up detail ----------------------------------------------------------------------------------------------

  #topup(screen: Extract<FinanceScreen, { name: 'topup' }>): HTMLElement {
    const head = pageHead('Chi tiết yêu cầu nạp tiền', 'Đối chiếu chứng từ với sao kê ngân hàng trước khi xác nhận.', 'topup-title');
    const back = backButton('Quay lại danh sách nạp tiền', { name: 'finance-topups' }, this.hooks);
    const panel = statePanelOf(screen.state, this.hooks, { none: 'Không tìm thấy yêu cầu này.', filtered: '' });
    if (panel !== undefined || screen.state.kind !== 'ready') {
      return this.#section('topup-title', back, head, h('div', { class: 'table-card' }, panel));
    }
    const request: TopupDetail = screen.state.data;
    const info = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Thông tin yêu cầu'),
      definition([
        ['Mã yêu cầu', request.code],
        ['Shipper', `${request.shipperName} (${request.phoneMasked})`],
        ['Số tiền đề nghị', h('strong', {}, formatVnd(request.amount))],
        ['Ngân hàng chuyển', request.bank],
        ['Nội dung chuyển khoản', request.transferContent],
        ['Ngày yêu cầu', formatDateTimeVn(request.createdAt)],
        ['Trạng thái', topupBadge(request.status)],
      ]),
    );
    const proof = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Chứng từ'),
      request.proofName === null
        ? h('p', { class: 'muted' }, 'Shipper không đính kèm ảnh chuyển khoản.')
        : h('div', { class: 'proof' }, h('span', { class: 'proof-tile' }, icon('file', 28)), h('span', {}, h('span', { class: 'cell-name' }, request.proofName), h('span', { class: 'muted' }, 'Ảnh sẽ hiển thị khi kết nối lưu trữ tệp (giai đoạn giao diện).'))),
    );
    return this.#section('topup-title', back, head, h('div', { class: 'split' }, h('div', { class: 'detail' }, info, proof), h('div', { class: 'detail' }, this.#topupDecision(request, screen))));
  }

  #topupDecision(request: TopupDetail, screen: Extract<FinanceScreen, { name: 'topup' }>): HTMLElement {
    if (!canDecideTopup(request.status)) {
      return h(
        'section',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Kết quả xử lý'),
        definition([
          ['Trạng thái', topupBadge(request.status)],
          ['Số tiền thực nhận', request.actualAmount === null ? '—' : formatVnd(request.actualAmount)],
          ['Mã giao dịch ngân hàng', request.bankReference ?? '—'],
          ['Người xử lý', request.decidedBy ?? '—'],
          ['Thời gian xử lý', request.decidedAt === null ? '—' : formatDateTimeVn(request.decidedAt)],
          ['Ghi chú', request.note ?? '—'],
        ]),
      );
    }
    const draft = screen.draft;
    const enabled = this.hooks.wired;
    const attempt = screen.attempted;
    const result = attempt === undefined ? undefined : validateTopupDecision(draft, request.amount, attempt);
    const preview = validateTopupDecision(draft, request.amount, 'confirm');
    const edit = (next: Partial<TopupDecisionDraft>): void => this.hooks.topupDraft({ ...draft, ...next });
    const confirm = h('button', { type: 'button', class: 'btn btn-primary btn-inline', id: 'topup-confirm' }, icon('check', 18), 'Xác nhận');
    const reject = h('button', { type: 'button', class: 'btn btn-danger btn-inline', id: 'topup-reject' }, icon('x', 18), 'Từ chối');
    confirm.disabled = !enabled;
    reject.disabled = !enabled;
    const act = (action: 'confirm' | 'reject'): void => {
      this.hooks.topupAttempt(action);
      if (Object.keys(validateTopupDecision(draft, request.amount, action).errors).length === 0) {
        this.hooks.topupDecide(action);
      }
    };
    confirm.addEventListener('click', () => act('confirm'));
    reject.addEventListener('click', () => act('reject'));
    const mismatch = h('p', { class: 'message message-warning', role: 'status' });
    setMessage(mismatch, preview.mismatch ? `Số tiền thực nhận khác số tiền đề nghị (${formatVnd(request.amount)}). Ví chỉ được cộng đúng số tiền ngân hàng thực nhận.` : undefined);
    return h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Thông tin kiểm tra'),
      h('p', { class: 'hint' }, 'Chỉ ghi nhận số tiền sau khi đối chiếu sao kê ngân hàng. Việc Shipper bấm “Tôi đã chuyển tiền” không tự cộng ví.'),
      textField({ id: 'topup-actual', label: 'Số tiền thực nhận (đ)', value: draft.actualAmount, enabled, numeric: true, maxLength: 14, error: attempt === 'confirm' ? result?.errors.actualAmount : undefined, onInput: (value) => edit({ actualAmount: value }) }),
      textField({ id: 'topup-bankref', label: 'Mã giao dịch ngân hàng', value: draft.bankReference, enabled, maxLength: BANK_REFERENCE_MAX, error: attempt === 'confirm' ? result?.errors.bankReference : undefined, onInput: (value) => edit({ bankReference: value }) }),
      textField({ id: 'topup-note', label: 'Ghi chú / lý do từ chối', value: draft.note, enabled, multiline: true, maxLength: NOTE_MAX, error: result?.errors.note, onInput: (value) => edit({ note: value }) }),
      mismatch,
      enabled ? undefined : disabledNote(),
      h('div', { class: 'detail-actions' }, reject, confirm),
    );
  }

  // ---- M04-A05 withdrawals ------------------------------------------------------------------------------------------------

  #withdrawals(screen: Extract<FinanceScreen, { name: 'withdrawals' }>): HTMLElement {
    const usable = this.hooks.wired && screen.state.kind !== 'not-wired';
    const head = pageHead('Danh sách yêu cầu rút tiền', 'Shipper tự tạo yêu cầu trên ứng dụng; Admin xử lý chuyển khoản và đối soát.', 'withdrawals-title');
    const tabBar = tabs<WithdrawalTab>(
      'Lọc yêu cầu rút',
      WITHDRAWAL_TABS.map((id) => ({ id, label: WITHDRAWAL_TAB_LABEL[id], count: screen.counts?.[id] })),
      screen.tab,
      (tab) => this.hooks.open({ name: 'finance-withdrawals', tab }),
      usable,
    );
    const toolbar = h('div', { class: 'toolbar toolbar-filters', role: 'search' }, searchBox('withdrawals-search', 'Tìm theo tên, SĐT, mã yêu cầu', screen.query, usable, (value) => this.hooks.search(value)), refreshButton(this.hooks, usable && screen.state.kind !== 'loading'));
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Mã yêu cầu' }, { label: 'Shipper' }, { label: 'Số tiền', num: true }, { label: 'Trạng thái' }, { label: 'Thao tác', end: true }];
    const caption = 'Danh sách yêu cầu rút tiền';
    const panel = statePanelOf(screen.state, this.hooks, { none: 'Chưa có yêu cầu rút tiền nào.', filtered: 'Không có yêu cầu nào trong mục này. Thử đổi mục hoặc từ khóa.' });
    if (panel !== undefined || screen.state.kind !== 'ready') {
      return this.#section('withdrawals-title', head, tabBar, toolbar, tableCard(caption, columns, { panel: panel ?? h('div') }));
    }
    const view: ListView<WithdrawalRow> = screen.state.data;
    const rows = view.rows.map((row) =>
      h(
        'tr',
        {},
        td(columns[0]!, formatDateTimeVn(row.createdAt)),
        td(columns[1]!, row.code),
        td(columns[2]!, person(row.shipperName, row.phoneMasked)),
        td(columns[3]!, h('strong', {}, formatVnd(row.amount))),
        td(columns[4]!, withdrawalBadge(row.status)),
        td(columns[5]!, rowLink({ name: 'finance-withdrawal', id: row.id }, `Xem yêu cầu ${row.code}`, this.hooks)),
      ),
    );
    return this.#section('withdrawals-title', head, tabBar, toolbar, tableCard(caption, columns, { rows }), pager(view, (page) => this.hooks.page(page)));
  }

  #withdrawal(state: FinanceLoad<WithdrawalDetail>): HTMLElement {
    const head = pageHead('Chi tiết yêu cầu rút tiền', 'Tiền được giữ ngay khi tạo yêu cầu; chỉ khi chuyển khoản xong mới trừ khỏi ví.', 'withdrawal-title');
    const back = backButton('Quay lại danh sách rút tiền', { name: 'finance-withdrawals' }, this.hooks);
    const panel = statePanelOf(state, this.hooks, { none: 'Không tìm thấy yêu cầu này.', filtered: '' });
    if (panel !== undefined || state.kind !== 'ready') {
      return this.#section('withdrawal-title', back, head, h('div', { class: 'table-card' }, panel));
    }
    const request = state.data;
    const info = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Thông tin yêu cầu'),
      definition([
        ['Mã yêu cầu', request.code],
        ['Shipper', `${request.shipperName} (${request.phoneMasked})`],
        ['Số tiền rút', h('strong', {}, formatVnd(request.amount))],
        ['Tiền đang giữ cho yêu cầu', formatVnd(request.held)],
        ['Ngày tạo', formatDateTimeVn(request.createdAt)],
        ['Trạng thái', withdrawalBadge(request.status)],
        ...(request.note === null ? [] : ([['Ghi chú', request.note]] as const)),
      ]),
    );
    const bank = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Tài khoản nhận tiền'),
      definition([
        ['Ngân hàng', request.bank.bank],
        ['Số tài khoản', request.bank.accountMasked],
        ['Chủ tài khoản', request.bank.holder],
      ]),
      h('p', { class: 'hint' }, 'Thông tin chốt tại thời điểm Shipper tạo yêu cầu. Đổi ngân hàng sau đó không làm đổi đích của yêu cầu này.'),
    );
    const actions = withdrawalActions(request.status);
    const buttons = actions.map((action) => {
      const button = h('button', { type: 'button', class: action === 'MARK_RECONCILE' ? 'btn btn-secondary btn-inline' : 'btn btn-primary btn-inline', id: `withdrawal-${action.toLowerCase().replace('_', '-')}` }, WITHDRAWAL_ACTION_LABEL[action]);
      button.disabled = !this.hooks.wired;
      button.addEventListener('click', () => this.hooks.withdrawalAct(action));
      return button;
    });
    const steps = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Tiến trình xử lý'),
      stepsList(request),
      request.status === 'NEEDS_RECONCILE' ? h('p', { class: 'hint' }, 'Chưa biết kết quả chuyển khoản: tiền vẫn đang giữ. Không chuyển lại và không giải phóng tự động; đối soát với sao kê ngân hàng trước.') : undefined,
      request.status === 'CANCELLED' ? h('p', { class: 'hint' }, 'Yêu cầu đã được hủy.') : undefined,
      actions.length === 0 ? h('p', { class: 'hint' }, 'Yêu cầu đã kết thúc, không còn thao tác.') : undefined,
      actions.length === 0 || this.hooks.wired ? undefined : disabledNote(),
      actions.length === 0 ? undefined : h('div', { class: 'detail-actions' }, ...buttons),
    );
    return this.#section('withdrawal-title', back, head, h('div', { class: 'split' }, h('div', { class: 'detail' }, info, bank), h('div', { class: 'detail' }, steps)));
  }

  // ---- M04-A06 ledger and reconciliation ----------------------------------------------------------------------------------

  #ledger(screen: Extract<FinanceScreen, { name: 'ledger' }>): HTMLElement {
    const reconcile = screen.mode === 'reconciliation';
    const usable = this.hooks.wired && screen.state.kind !== 'not-wired';
    const head = pageHead(reconcile ? 'Đối soát' : 'Lịch sử giao dịch', reconcile ? 'So tổng sổ cái với tổng số dư ví và chỉ ra chênh lệch.' : 'Sổ cái ví và các khoản tạm giữ. Dòng đã ghi không bị sửa hay xóa.', 'ledger-title', exportButton(this.hooks, 'ledger-export'));
    const filter = screen.filter;
    const field = (label: string, id: string, control: HTMLElement): HTMLElement => h('div', { class: 'filter' }, h('label', { class: 'label', for: id }, label), control);
    const date = (id: string, value: string, key: 'from' | 'to'): HTMLInputElement => {
      const input = h('input', { id, type: 'date', class: 'date-input' });
      input.value = value;
      input.disabled = !usable;
      input.addEventListener('change', () => this.hooks.ledgerFilter({ [key]: input.value }));
      return input;
    };
    const typeSelect = h('select', { id: 'ledger-type', class: 'select' }, h('option', { value: 'ALL' }, 'Tất cả'), ...(Object.keys(LEDGER_TYPE_LABEL) as LedgerType[]).map((type) => h('option', { value: type }, LEDGER_TYPE_LABEL[type])));
    typeSelect.value = filter.type;
    typeSelect.disabled = !usable;
    typeSelect.addEventListener('change', () => this.hooks.ledgerFilter({ type: typeSelect.value in LEDGER_TYPE_LABEL ? (typeSelect.value as LedgerType) : 'ALL' }));
    const statusSelect = h('select', { id: 'ledger-status', class: 'select' }, h('option', { value: 'ALL' }, 'Tất cả'), ...(Object.keys(LEDGER_STATUS_LABEL) as LedgerStatus[]).map((status) => h('option', { value: status }, LEDGER_STATUS_LABEL[status])));
    statusSelect.value = filter.status;
    statusSelect.disabled = !usable;
    statusSelect.addEventListener('change', () => this.hooks.ledgerFilter({ status: statusSelect.value in LEDGER_STATUS_LABEL ? (statusSelect.value as LedgerStatus) : 'ALL' }));
    const shipper = h('input', { id: 'ledger-shipper', type: 'search', class: 'date-input', placeholder: 'Tên Shipper', autocomplete: 'off', spellcheck: 'false', maxlength: '80' });
    shipper.value = filter.shipper;
    shipper.disabled = !usable;
    shipper.addEventListener('input', () => this.hooks.ledgerFilter({ shipper: shipper.value }));
    const toolbar = h(
      'div',
      { class: 'toolbar toolbar-filters toolbar-wrap', role: 'search' },
      field('Từ ngày', 'ledger-from', date('ledger-from', filter.from, 'from')),
      field('Đến ngày', 'ledger-to', date('ledger-to', filter.to, 'to')),
      field('Shipper', 'ledger-shipper', shipper),
      field('Loại giao dịch', 'ledger-type', typeSelect),
      field('Trạng thái', 'ledger-status', statusSelect),
      refreshButton(this.hooks, usable && screen.state.kind !== 'loading'),
    );
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Loại' }, { label: 'Shipper' }, { label: 'Tham chiếu' }, { label: 'Số tiền', num: true }, { label: 'Số dư sau', num: true }, { label: 'Trạng thái' }];
    const caption = reconcile ? 'Sổ cái để đối soát' : 'Lịch sử giao dịch';
    const summary = screen.summary === undefined ? undefined : reconciliationBlock(screen.summary, reconcile);
    const panel = statePanelOf(screen.state, this.hooks, { none: 'Chưa có giao dịch nào.', filtered: 'Không có giao dịch phù hợp bộ lọc. Thử nới khoảng ngày hoặc đổi loại.' });
    if (panel !== undefined || screen.state.kind !== 'ready') {
      return this.#section('ledger-title', head, summary, toolbar, tableCard(caption, columns, { panel: panel ?? h('div') }));
    }
    const view: ListView<LedgerRow> = screen.state.data;
    const rows = view.rows.map((row) =>
      h(
        'tr',
        {},
        td(columns[0]!, formatDateTimeVn(row.at)),
        td(columns[1]!, LEDGER_TYPE_LABEL[row.type]),
        td(columns[2]!, row.shipperName),
        td(columns[3]!, row.reference),
        td(columns[4]!, ledgerAmount(row)),
        td(columns[5]!, row.balanceAfter === null || !movesBalance(row.type) ? h('span', { class: 'muted' }, 'Không đổi') : formatVnd(row.balanceAfter)),
        td(columns[6]!, badge(LEDGER_BADGE[row.status][0], LEDGER_STATUS_LABEL[row.status], LEDGER_BADGE[row.status][1])),
      ),
    );
    return this.#section('ledger-title', head, summary, toolbar, tableCard(caption, columns, { rows }), pager(view, (page) => this.hooks.page(page)));
  }

  // ---- M04-A07 wallet parameters ------------------------------------------------------------------------------------------

  #params(screen: Extract<FinanceScreen, { name: 'params' }>): HTMLElement {
    const head = pageHead('Tham số hệ thống · Ví Shipper', 'Cài đặt › Tham số hệ thống › Ví Shipper. Chỉ có trên Admin Web; áp dụng cho giao dịch mới.', 'params-title');
    const state = screen.state;
    const panel = statePanelOf(state, this.hooks, { none: 'Chưa có tham số.', filtered: '' });
    if (panel !== undefined || state.kind !== 'ready' || screen.draft === undefined) {
      return h('section', { class: 'content content-narrow', 'aria-labelledby': 'params-title' }, head, panel ?? h('div'));
    }
    const data: WalletParamsData = state.data;
    const draft = screen.draft;
    const errors = screen.attempted ? validateWalletParams(draft) : {};
    const enabled = this.hooks.wired;
    const fields = WALLET_PARAM_KEYS.map((key) =>
      textField({ id: `param-${key}`, label: `${WALLET_PARAM_LABEL[key]} (đ)`, value: draft[key], enabled, numeric: true, maxLength: 12, hint: WALLET_PARAM_HINT[key], error: errors[key], onInput: (value) => this.hooks.paramsDraft({ ...draft, [key]: value }) }),
    );
    const dirty = WALLET_PARAM_KEYS.some((key) => draft[key] !== String(data.params[key]));
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary btn-inline', id: 'params-cancel' }, 'Hủy');
    cancel.disabled = !enabled || !dirty;
    cancel.addEventListener('click', () => this.hooks.paramsReset());
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-inline', id: 'params-save' }, 'Lưu');
    save.disabled = !enabled || !dirty;
    save.addEventListener('click', () => {
      this.hooks.paramsAttempt();
      if (Object.keys(validateWalletParams(draft)).length === 0) {
        this.hooks.paramsSave();
      }
    });
    const history =
      data.history.length === 0
        ? h('p', { class: 'muted' }, 'Chưa có thay đổi nào được ghi lại.')
        : h('ol', { class: 'timeline' }, ...data.history.map((change) => historyRow(change)));
    return h(
      'section',
      { class: 'content content-narrow', 'aria-labelledby': 'params-title' },
      head,
      h('div', { class: 'detail' }, h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Ví Shipper'), ...fields, h('p', { class: 'message message-warning', role: 'status' }, WALLET_PARAMS_NOT_SAVED), enabled ? undefined : disabledNote(), h('div', { class: 'detail-actions' }, cancel, save)), h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Nhật ký thay đổi'), history)),
    );
  }
}

// ---- pieces with their own layout ---------------------------------------------------------------------------------------------

function exportButton(hooks: FinanceHooks, id: string): HTMLElement {
  const button = h('button', { type: 'button', class: 'btn btn-secondary btn-inline', id, 'aria-describedby': `${id}-why` }, icon('doc', 18), 'Xuất Excel');
  button.disabled = true;
  button.addEventListener('click', () => hooks.exportLedger());
  return h('div', { class: 'export' }, button, h('span', { id: `${id}-why`, class: 'hint' }, 'Xuất dữ liệu cần quyền riêng; chưa nối.'));
}

function ledgerAmount(row: LedgerRow): HTMLElement {
  if (row.type === 'HOLD') {
    return h('span', { class: 'amount-hold' }, `Giữ ${formatVnd(Math.abs(row.amount))}`);
  }
  if (row.type === 'RELEASE') {
    return h('span', { class: 'amount-hold' }, `Nhả ${formatVnd(Math.abs(row.amount))}`);
  }
  return amountCell(row.amount);
}

function reconciliationBlock(summary: ReconciliationSummary, prominent: boolean): HTMLElement {
  const difference = reconciliationDifference(summary);
  const tile = (label: string, value: string, tone: string): HTMLElement => h('div', { class: `kpi ${tone}` }, h('span', { class: 'kpi-body' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value)));
  const verdict =
    difference === 0
      ? h('p', { class: 'message message-notice', role: 'status' }, 'Khớp: tổng số dư ví bằng tổng sổ cái.')
      : h('p', { class: 'message message-error', role: 'alert' }, `Chênh lệch ${formatVndSigned(difference)}: tổng số dư ví ${difference > 0 ? 'lớn hơn' : 'nhỏ hơn'} tổng sổ cái. Không tự sửa số dư; cần điều chỉnh có quyền và có lý do.`);
  return h(
    'section',
    { class: `detail-block${prominent ? '' : ' detail-block-quiet'}`, 'aria-label': 'Đối soát tổng' },
    h('div', { class: 'kpi-grid' }, tile('Tổng sổ cái', formatVnd(summary.ledgerTotal), 'kpi-info'), tile('Tổng số dư ví', formatVnd(summary.walletTotal), 'kpi-ok'), tile('Chênh lệch', formatVndSigned(difference), difference === 0 ? 'kpi-ok' : 'kpi-bad'), tile('Đang tạm giữ', formatVnd(summary.heldTotal), 'kpi-warn'), tile('Rút chờ xử lý', formatVnd(summary.pendingWithdrawals), 'kpi-warn')),
    verdict,
  );
}

function stepsList(request: WithdrawalDetail): HTMLElement {
  const items: HTMLElement[] = [];
  const add = (label: string, meta: string, state: 'done' | 'current' | 'todo'): void => {
    items.push(
      h(
        'li',
        { class: `timeline-item timeline-item-${state}`, ...(state === 'current' ? { 'aria-current': 'step' } : {}) },
        h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
        h('div', {}, h('p', { class: 'timeline-label' }, label), h('p', { class: 'timeline-meta' }, meta)),
      ),
    );
  };
  const reached = (step: { readonly at: string | null; readonly by: string | null }): string => (step.at === null ? 'Chưa có thông tin' : `${formatDateTimeVn(step.at)}${step.by === null ? '' : ` · ${step.by}`}`);
  const order: readonly Exclude<WithdrawalStatus, 'CANCELLED'>[] = ['PENDING', 'PROCESSING', 'COMPLETED'];
  const position = order.indexOf(request.status as Exclude<WithdrawalStatus, 'CANCELLED'>);
  for (const [index, status] of order.entries()) {
    const step = request.steps.find((candidate) => candidate.status === status) ?? { status, at: null, by: null };
    let state: 'done' | 'current' | 'todo';
    if (request.status === 'CANCELLED') {
      state = step.at === null ? 'todo' : 'done';
    } else if (request.status === 'COMPLETED') {
      state = 'done';
    } else if (request.status === 'NEEDS_RECONCILE') {
      // The reconcile branch hangs off "Đang xử lý": the transfer outcome is unknown, so "Hoàn thành" has not happened.
      state = index <= 1 ? 'done' : 'todo';
    } else {
      state = index < position ? 'done' : index === position ? 'current' : 'todo';
    }
    add(WITHDRAWAL_STATUS_LABEL[status], reached(step), state);
    if (status === 'PROCESSING' && request.status === 'NEEDS_RECONCILE') {
      const branch = request.steps.find((candidate) => candidate.status === 'NEEDS_RECONCILE') ?? { at: null, by: null };
      add(WITHDRAWAL_STATUS_LABEL.NEEDS_RECONCILE, reached(branch), 'current');
    }
  }
  return h('ol', { class: 'timeline' }, ...items);
}

function historyRow(change: WalletParamChange): HTMLElement {
  return h(
    'li',
    { class: 'timeline-item' },
    h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
    h('div', {}, h('p', { class: 'timeline-label' }, `${WALLET_PARAM_LABEL[change.key]}: ${formatVnd(change.oldValue)} → ${formatVnd(change.newValue)}`), h('p', { class: 'timeline-meta' }, `${formatDateTimeVn(change.changedAt)} · Người thực hiện: ${change.changedBy.slice(0, 8)}`)),
  );
}

// ---- chart --------------------------------------------------------------------------------------------------------------------

const compact = (value: number): string => (value >= 1_000_000 ? `${String(Math.round(value / 100_000) / 10)}tr` : value >= 1_000 ? `${String(Math.round(value / 100) / 10)}k` : String(value));

/** Grouped bars (nạp / rút / hoa hồng) per day. Drawn with SVG attributes and classes only (the CSP forbids inline styles). */
function chart(days: readonly ChartDay[]): HTMLElement {
  if (days.length === 0) {
    return emptyPanel('Chưa có biến động', 'Chưa có giao dịch trong khoảng thời gian này.');
  }
  const width = 760;
  const height = 260;
  const left = 56;
  const bottom = 28;
  const top = 12;
  const plotWidth = width - left - 8;
  const plotHeight = height - bottom - top;
  const maxValue = Math.max(1, ...days.flatMap((day) => [day.topup, day.withdraw, day.commission]));
  const step = (() => {
    const magnitude = 10 ** Math.floor(Math.log10(maxValue));
    return [0.2, 0.25, 0.5, 1, 2].map((factor) => factor * magnitude).find((candidate) => maxValue / candidate <= 5) ?? magnitude * 2;
  })();
  const ceiling = Math.ceil(maxValue / step) * step;
  const y = (value: number): number => top + plotHeight - (value / ceiling) * plotHeight;
  const group = plotWidth / days.length;
  const bar = group * 0.22;
  const nodes: SVGElement[] = [];
  for (let value = 0; value <= ceiling; value += step) {
    nodes.push(svg('line', { x1: String(left), x2: String(width - 8), y1: String(y(value)), y2: String(y(value)), class: 'chart-grid' }));
    const label = svg('text', { x: String(left - 8), y: String(y(value) + 4), class: 'chart-axis', 'text-anchor': 'end' });
    label.textContent = compact(value);
    nodes.push(label);
  }
  const series: readonly (readonly [keyof Pick<ChartDay, 'topup' | 'withdraw' | 'commission'>, string])[] = [
    ['topup', 'chart-topup'],
    ['withdraw', 'chart-withdraw'],
    ['commission', 'chart-commission'],
  ];
  days.forEach((day, index) => {
    const x0 = left + index * group + (group - bar * 3 - 4) / 2;
    series.forEach(([key, cls], seriesIndex) => {
      const value = day[key];
      const barHeight = Math.max(0, plotHeight - (y(value) - top));
      nodes.push(svg('rect', { x: String(x0 + seriesIndex * (bar + 2)), y: String(y(value)), width: String(bar), height: String(barHeight), class: cls, rx: '2' }));
    });
    if (days.length <= 16 || index % 2 === 0) {
      const label = svg('text', { x: String(left + index * group + group / 2), y: String(height - 8), class: 'chart-axis', 'text-anchor': 'middle' });
      label.textContent = day.label;
      nodes.push(label);
    }
  });
  const figure = svg('svg', { viewBox: `0 0 ${String(width)} ${String(height)}`, class: 'chart', role: 'img', 'aria-label': `Biểu đồ cột nạp tiền, rút tiền và hoa hồng theo ngày, ${String(days.length)} ngày. Số liệu chi tiết nằm trong bảng bên dưới.` }, ...nodes);
  const legend = h('ul', { class: 'legend' }, ...series.map(([key, cls]) => h('li', {}, h('span', { class: `legend-swatch ${cls}`, 'aria-hidden': 'true' }), key === 'topup' ? 'Nạp tiền' : key === 'withdraw' ? 'Rút tiền' : 'Hoa hồng')));
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Số liệu biến động giao dịch theo ngày'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ngày'), h('th', { scope: 'col' }, 'Nạp tiền'), h('th', { scope: 'col' }, 'Rút tiền'), h('th', { scope: 'col' }, 'Hoa hồng'))),
    h('tbody', {}, ...days.map((day) => h('tr', {}, h('th', { scope: 'row' }, day.label), h('td', {}, formatVnd(day.topup)), h('td', {}, formatVnd(day.withdraw)), h('td', {}, formatVnd(day.commission))))),
  );
  return h('div', { class: 'chart-wrap' }, legend, figure as unknown as HTMLElement, table);
}
