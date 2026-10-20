import {
  checkEvidence,
  CommissionPolicyView,
  Destination,
  EvidenceChecked,
  EvidenceDraft,
  FinanceOpsSource,
  FinanceOutcome,
  FinanceRead,
  HOLD_STATUS_LABEL,
  identityLabel,
  isHoldKind,
  LedgerFilterOps,
  LedgerItem,
  LedgerKind,
  LEDGER_KINDS,
  LEDGER_KIND_LABEL,
  OPS_MESSAGE,
  OpsOverview,
  OutgoingEvidenceInput,
  RECONCILE_OUTCOME_LABEL,
  RECONCILE_REASON_CODE_LABEL,
  ReconcileOutcome,
  ReconcileReasonCode,
  RECONCILIATION_REASONS,
  RECONCILIATION_REASON_LABEL,
  ReconciliationReason,
  SourceAccount,
  WalletDetail,
  WalletItem,
  WithdrawalDetailOps,
  WithdrawalFilterOps,
  WithdrawalItem,
  WithdrawalState,
  WITHDRAWAL_FILTERS,
  WITHDRAWAL_FILTER_LABEL,
  WITHDRAWAL_STATE_LABEL,
} from '../core/finance-ops.js';
import { FINANCE_FORBIDDEN_MESSAGE, FINANCE_UNKNOWN_MESSAGE, formatVndAmount, messageOf, shortId } from '../core/finance-admin.js';
import { formatRoute, Route } from '../core/routes.js';
import { formatDateTimeVn } from './accounts-view.js';
import { DialogHandle, openDialog } from './dialog.js';
import { h, primary, secondary, setMessage } from './dom.js';
import { icon, UiIconName } from './icons.js';
import { Column, FinanceAdminHost, cell, definition, noticeBlock, outcomeText, pageHead, readPanel, sessionGone, tableCard, when } from './finance-admin-view.js';
import { emptyPanel, skeleton } from './states.js';

// DOM of the operating finance pages of the administration (M04-C): the overview, the Shipper wallets, the withdrawals (claim, record the manual transfer, reconcile),
// the transactions, the reconciliation and the commission policy. It draws what the server answered and decides nothing: every right is read from the server and
// asked again by it on every call. Every node is created with createElement/textContent (no innerHTML). Nothing is stored (no storage, no URL, no console): the
// transaction code, the amount and the account live in the form for as long as the page does.
//
// Money safety of the browser side (the same rules as the top-up pages): ONE click is ONE request (the button is disabled and the late answer of a closed page is
// dropped); the Idempotency-Key and the exact command of an intent are made once and kept in a closure; after an unknown outcome only "Gửi lại cùng lệnh" (the SAME key,
// the SAME body) and "Kiểm tra trạng thái" (a read) are offered - the page never sends a different command by itself, and never a second TRANSFER: it only records one.

export interface FinanceOpsHost extends Omit<FinanceAdminHost, 'source'> {
  readonly ops: FinanceOpsSource;
}

const opsMessage = (code: string): string => OPS_MESSAGE[code] ?? messageOf(code);

function opsOutcomeText(outcome: FinanceOutcome): { readonly text: string; readonly reload: boolean } {
  if (outcome.kind === 'conflict' || outcome.kind === 'refused') {
    return { text: opsMessage(outcome.code), reload: outcome.kind === 'conflict' };
  }
  return outcomeText(outcome);
}

const STATE_BADGE: Record<WithdrawalState, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  PENDING: ['wait', 'clock'],
  PROCESSING: ['wait', 'clock'],
  RECONCILIATION: ['lock', 'alert'],
  PAID: ['ok', 'check'],
  CANCELLED: ['neutral', 'x'],
};

function stateBadge(state: WithdrawalState): HTMLElement {
  const [kind, name] = STATE_BADGE[state];
  return h('span', { class: `badge${kind === 'neutral' ? '' : ` badge-${kind}`}` }, icon(name, 14), WITHDRAWAL_STATE_LABEL[state]);
}

const money = (value: number): string => formatVndAmount(value);
const signedMoney = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatVndAmount(value)}`;

const refreshButton = (onClick: () => void): HTMLElement => {
  const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
  refresh.addEventListener('click', onClick);
  return refresh;
};

const link = (route: Route, label: string, host: Pick<FinanceAdminHost, 'go'>): HTMLElement => {
  const anchor = h('a', { href: formatRoute(route), class: 'table-link' }, label);
  anchor.addEventListener('click', (event) => {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      host.go(route);
    }
  });
  return anchor;
};

type Raw = Exclude<FinanceRead<unknown>, { kind: 'ready' }>;

// ---- M04-A01: overview and the commission policy -----------------------------------------------------------------------------------

export class OpsOverviewView {
  readonly #body = h('div', { class: 'results' });
  readonly #notice = noticeBlock('ops-overview-notice', 'warning');
  readonly #commission = h('input', { id: 'commission-amount', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '13' });
  readonly #commissionError = h('p', { class: 'hint', role: 'alert', hidden: true });
  #alive = true;
  #latest = 0;
  #busy = false;
  #pending: (() => Promise<FinanceOutcome>) | undefined;
  #policy: CommissionPolicyView | undefined;
  #dialog: DialogHandle | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
  ) {
    root.replaceChildren(
      h('section', { class: 'content content-wide', 'aria-labelledby': 'ops-overview-title' }, pageHead('Tổng quan tài chính', 'Số liệu đọc trực tiếp từ cơ sở dữ liệu tại một thời điểm. Không có số liệu giả hoặc ước tính.', 'ops-overview-title', refreshButton(() => void this.load())), this.#notice.element, this.#body),
    );
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#pending = undefined;
    this.#commission.value = '';
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#body.replaceChildren(skeleton());
    const [overview, policy] = await Promise.all([this.host.ops.overview(), this.host.ops.commissionPolicy()]);
    if (!this.#alive || token !== this.#latest || sessionGone(overview, this.host) || sessionGone(policy, this.host)) {
      return;
    }
    if (overview.kind !== 'ready') {
      this.#body.replaceChildren(readPanel(overview as Raw, this.host, () => void this.load()));
      return;
    }
    this.#policy = policy.kind === 'ready' ? policy.data : undefined;
    this.#body.replaceChildren(...this.#cards(overview.data));
  }

  #kpi(label: string, value: string, iconName: UiIconName, tone: string, route?: Route): HTMLElement {
    const inner = [h('span', { class: 'kpi-icon' }, icon(iconName, 22)), h('span', { class: 'kpi-body' }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value))];
    if (route === undefined) {
      return h('div', { class: `kpi ${tone}` }, ...inner);
    }
    const anchor = h('a', { href: formatRoute(route), class: `kpi kpi-link ${tone}` }, ...inner);
    anchor.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.host.go(route);
      }
    });
    return anchor;
  }

  #cards(o: OpsOverview): HTMLElement[] {
    const drift = o.driftWallets + o.driftWithdrawals;
    const parts: HTMLElement[] = [];
    if (drift > 0) {
      parts.push(
        h('p', { class: 'message message-error', role: 'alert' }, `Phát hiện ${o.driftWallets} ví và ${o.driftWithdrawals} yêu cầu rút có số liệu lệch với sổ giao dịch. Hệ thống KHÔNG tự sửa. Mở Đối soát để xem chi tiết.`),
      );
    }
    parts.push(
      h(
        'div',
        { class: 'kpi-grid' },
        this.#kpi('Tổng số dư ví', money(o.totalBalanceVnd), 'wallet', 'kpi-ok', { name: 'finance-wallets' }),
        this.#kpi('Tổng tiền tạm giữ', money(o.totalHeldVnd), 'lock', 'kpi-warn'),
        this.#kpi('Tổng khả dụng', money(o.totalAvailableVnd), 'wallet', 'kpi-info'),
        this.#kpi('Yêu cầu nạp chờ xác nhận', `${o.topupPending.count} · ${money(o.topupPending.amountVnd)}`, 'plus-circle', 'kpi-info', { name: 'finance-topups', status: 'PENDING' }),
        this.#kpi('Yêu cầu rút chờ xử lý', `${o.withdrawalPending.count} · ${money(o.withdrawalPending.amountVnd)}`, 'minus-circle', 'kpi-warn', { name: 'finance-withdrawals', status: 'PENDING' }),
        this.#kpi('Rút tiền đang xử lý', String(o.withdrawalProcessing), 'clock', 'kpi-info', { name: 'finance-withdrawals', status: 'PROCESSING' }),
        this.#kpi('Rút tiền cần đối soát', `${o.withdrawalReconciliation.count} · ${money(o.withdrawalReconciliation.amountVnd)}`, 'alert', o.withdrawalReconciliation.count > 0 ? 'kpi-warn' : 'kpi-info', { name: 'finance-withdrawals', status: 'RECONCILIATION' }),
        this.#kpi('Ví lệch sổ giao dịch', String(drift), 'shield', drift > 0 ? 'kpi-warn' : 'kpi-ok', { name: 'finance-reconciliation' }),
      ),
      h(
        'div',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, '24 giờ qua'),
        definition([
          ['Nạp tiền đã ghi nhận', `${o.last24h.topup.count} giao dịch · ${money(o.last24h.topup.amountVnd)}`],
          ['Rút tiền đã chuyển', `${o.last24h.withdrawalPaid.count} giao dịch · ${money(o.last24h.withdrawalPaid.amountVnd)}`],
          ['Hoa hồng đã thu', `${o.last24h.commission.count} đơn · ${money(o.last24h.commission.amountVnd)}`],
          ['Số ví', String(o.wallets)],
        ]),
      ),
      this.#commissionBlock(o.commissionVnd),
    );
    return parts;
  }

  /** The commission per delivery: everybody who may read finance sees it; only SYSTEM changes it (the server decides again). */
  #commissionBlock(current: number): HTMLElement {
    const rows: (HTMLElement | undefined)[] = [
      h('h2', { class: 'subtitle' }, 'Hoa hồng mỗi đơn giao thành công'),
      h('p', { class: 'hint' }, `Đang áp dụng: ${money(current)} / đơn${this.#policy === undefined ? '' : ` (phiên bản ${this.#policy.current.version})`}. Thay đổi chỉ áp dụng cho đơn Shipper nhận SAU khi đổi; đơn đã nhận giữ mức cũ.`),
    ];
    if (this.host.rights().role === 'SYSTEM' && this.#policy !== undefined) {
      const policy = this.#policy;
      const save = primary('Kiểm tra và đổi mức hoa hồng', 'button');
      save.addEventListener('click', () => this.#attemptCommission(policy));
      rows.push(
        h('div', { class: 'field' }, h('label', { for: 'commission-amount', class: 'label' }, 'Mức mới (VND)'), h('div', { class: 'input-wrap' }, this.#commission), this.#commissionError),
        h('div', { class: 'detail-actions' }, save),
      );
      if (this.#pending !== undefined) {
        rows.push(this.#unknown());
      }
    }
    if (this.#policy !== undefined) {
      rows.push(
        h(
          'ul',
          { class: 'hint-list' },
          ...this.#policy.history.slice(0, 6).map((entry) => h('li', {}, `Phiên bản ${entry.version}: ${money(entry.commissionVnd)} từ ${formatDateTimeVn(entry.createdAt)}`)),
        ),
      );
    }
    return h('div', { class: 'detail-block' }, ...rows.filter((row): row is HTMLElement => row !== undefined));
  }

  #attemptCommission(policy: CommissionPolicyView): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const text = this.#commission.value.trim();
    const value = /^[1-9]\d{0,9}$/.test(text) ? Number(text) : /^[1-9]\d{0,2}(\.\d{3}){1,3}$/.test(text) ? Number(text.replace(/\./g, '')) : undefined;
    if (value === undefined || value < 1 || value > 1_000_000_000) {
      setMessage(this.#commissionError, 'Nhập số nguyên đồng từ 1 đến 1.000.000.000.');
      return;
    }
    if (value === policy.current.commissionVnd) {
      setMessage(this.#commissionError, 'Mức mới trùng mức đang áp dụng.');
      return;
    }
    setMessage(this.#commissionError, undefined);
    const key = this.host.newKey();
    const send = (): Promise<FinanceOutcome> => this.host.ops.changeCommission({ key, version: policy.current.version, commissionVnd: value });
    const go = primary('Đổi mức hoa hồng', 'button');
    const cancel = secondary('Quay lại');
    this.#dialog = openDialog({
      title: 'Đổi mức hoa hồng?',
      description: `Từ ${money(policy.current.commissionVnd)} thành ${money(value)} mỗi đơn. Chỉ áp dụng cho đơn nhận sau khi đổi; đơn đang giữ tiền không bị thay đổi.`,
      body: [],
      actions: [cancel, go],
      onDismiss: () => this.#close(),
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
    cancel.addEventListener('click', () => this.#close());
    go.addEventListener('click', () => {
      go.disabled = true;
      cancel.disabled = true;
      void this.#run(send);
    });
  }

  #close(): void {
    this.#dialog?.close();
    this.#dialog = undefined;
  }

  async #run(send: () => Promise<FinanceOutcome>): Promise<void> {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    const outcome = await send();
    this.#busy = false;
    if (!this.#alive) {
      return;
    }
    this.#close();
    if (sessionGone(outcome, this.host)) {
      return;
    }
    if (outcome.kind === 'ok') {
      this.#pending = undefined;
      this.#commission.value = '';
      await this.load();
      this.#notice.set('Đã đổi mức hoa hồng: máy chủ đã xác nhận. Chỉ áp dụng cho đơn nhận sau thời điểm này.');
      return;
    }
    if (outcome.kind === 'unknown') {
      this.#pending = send;
      this.#notice.set(FINANCE_UNKNOWN_MESSAGE);
      await this.load();
      return;
    }
    const text = opsOutcomeText(outcome);
    this.#pending = undefined;
    if (text.reload) {
      await this.load();
    }
    this.#notice.set(text.text);
  }

  #unknown(): HTMLElement {
    const check = secondary('Kiểm tra trạng thái');
    check.addEventListener('click', () => {
      this.#pending = undefined;
      void this.load();
    });
    const resend = primary('Gửi lại cùng lệnh', 'button');
    resend.addEventListener('click', () => {
      const pending = this.#pending;
      if (pending !== undefined) {
        void this.#run(pending);
      }
    });
    return h('div', { class: 'message message-warning', role: 'alert' }, 'Chưa xác định kết quả đổi hoa hồng. "Gửi lại cùng lệnh" dùng đúng khóa và nội dung cũ nên không ghi trùng.', h('div', { class: 'detail-actions' }, check, resend));
  }
}

// ---- M04-A02: Shipper wallets ----------------------------------------------------------------------------------------------------

export class WalletListView {
  readonly #results = h('div', { class: 'results' });
  readonly #search = h('input', { id: 'wallet-search', class: 'input', type: 'search', autocomplete: 'off', maxlength: '60', placeholder: 'Mã Shipper, tên hoặc số điện thoại' });
  #items: readonly WalletItem[] = [];
  #cursor: string | null = null;
  #query = '';
  #latest = 0;
  #alive = true;
  #loadingMore = false;
  #dialog: DialogHandle | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
  ) {
    const go = secondary('Tìm');
    go.addEventListener('click', () => {
      this.#query = this.#search.value;
      void this.load();
    });
    this.#search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        go.click();
      }
    });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'wallets-title' },
        pageHead('Ví Shipper', 'Số dư B, tạm giữ H và khả dụng A = B − H của từng Shipper. Tên và số điện thoại được che.', 'wallets-title', refreshButton(() => void this.load())),
        h('div', { class: 'toolbar toolbar-filters' }, h('label', { for: 'wallet-search', class: 'sr-only' }, 'Tìm Shipper'), this.#search, go),
        this.#results,
      ),
    );
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#items = [];
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#items = [];
    this.#cursor = null;
    this.#draw({ kind: 'loading' });
    const read = await this.host.ops.wallets(this.#query, null);
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = read.data.items;
      this.#cursor = read.data.nextCursor;
      this.#draw(read.data.items.length === 0 ? { kind: 'empty' } : { kind: 'rows' });
      return;
    }
    this.#draw({ kind: 'read', read });
  }

  async #more(): Promise<void> {
    if (this.#cursor === null || this.#loadingMore) {
      return;
    }
    this.#loadingMore = true;
    const token = this.#latest;
    this.#draw({ kind: 'rows' });
    const read = await this.host.ops.wallets(this.#query, this.#cursor);
    this.#loadingMore = false;
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = [...this.#items, ...read.data.items];
      this.#cursor = read.data.nextCursor;
      this.#draw({ kind: 'rows' });
      return;
    }
    void this.load();
  }

  #draw(state: { kind: 'loading' } | { kind: 'empty' } | { kind: 'rows' } | { kind: 'read'; read: Raw }): void {
    const columns: readonly Column[] = [{ label: 'Shipper' }, { label: 'Tổng số dư (B)', end: true }, { label: 'Tạm giữ (H)', end: true }, { label: 'Khả dụng (A)', end: true }, { label: 'Cập nhật' }, { label: '', end: true }];
    const caption = 'Ví Shipper';
    switch (state.kind) {
      case 'loading':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: skeleton() }));
        return;
      case 'empty':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: emptyPanel('Không có ví', this.#query === '' ? 'Chưa có Shipper nào có ví.' : 'Không có ví nào khớp tìm kiếm.') }));
        return;
      case 'read':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: readPanel(state.read, this.host, () => void this.load()) }));
        return;
      case 'rows': {
        const rows = this.#items.map((item) => {
          const open = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, 'Xem');
          open.addEventListener('click', () => void this.#open(item));
          return h(
            'tr',
            {},
            cell('Shipper', identityLabel(item.shipper), h('br'), h('span', { class: 'hint' }, item.shipper.phoneMasked ?? '')),
            cell('Tổng số dư', money(item.balanceVnd)),
            cell('Tạm giữ', money(item.heldVnd)),
            cell('Khả dụng', money(item.availableVnd)),
            cell('Cập nhật', when(item.updatedAt)),
            cell('', open),
          );
        });
        const card = tableCard(caption, columns, { rows });
        if (this.#cursor === null) {
          this.#results.replaceChildren(card, h('p', { class: 'hint' }, 'Đã hiển thị tất cả ví theo bộ lọc. Danh sách không có tổng số.'));
          return;
        }
        const more = secondary(this.#loadingMore ? 'Đang tải…' : 'Tải thêm');
        more.disabled = this.#loadingMore;
        more.addEventListener('click', () => void this.#more());
        this.#results.replaceChildren(card, h('div', { class: 'more' }, more));
      }
    }
  }

  async #open(item: WalletItem): Promise<void> {
    const read = await this.host.ops.wallet(item.driverId);
    if (!this.#alive || sessionGone(read, this.host)) {
      return;
    }
    const body: HTMLElement[] = [];
    if (read.kind !== 'ready') {
      body.push(readPanel(read as Raw, this.host, () => undefined));
    } else {
      body.push(...walletDetailBody(read.data, this.host));
    }
    const close = secondary('Đóng');
    const history = secondary('Xem tất cả giao dịch');
    this.#dialog?.close();
    this.#dialog = openDialog({
      title: `Ví ${identityLabel(item.shipper)}`,
      description: 'Số liệu đọc từ cơ sở dữ liệu. Tạm giữ chỉ là thông tin phần tiền đang giữ, không phải khoản trừ.',
      body,
      actions: [history, close],
      onDismiss: () => this.#dialog?.close(),
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
    close.addEventListener('click', () => this.#dialog?.close());
    history.addEventListener('click', () => {
      this.#dialog?.close();
      this.host.go({ name: 'finance-transactions', shipper: item.driverId });
    });
  }
}

function walletDetailBody(detail: WalletDetail, host: Pick<FinanceAdminHost, 'go'>): HTMLElement[] {
  void host;
  const parts: HTMLElement[] = [];
  if (detail.wallet === null) {
    parts.push(h('p', { class: 'hint' }, 'Shipper này chưa có ví (chưa có giao dịch nào).'));
    return parts;
  }
  parts.push(
    definition([
      ['Tổng số dư (B)', money(detail.wallet.balanceVnd)],
      ['Tạm giữ (H)', money(detail.wallet.heldVnd)],
      ['Khả dụng (A = B − H)', money(detail.wallet.availableVnd)],
    ]),
  );
  if (detail.holds.length > 0) {
    parts.push(
      h('h3', { class: 'subtitle' }, 'Khoản tạm giữ gần đây'),
      h(
        'ul',
        { class: 'hint-list' },
        ...detail.holds.map((hold) => h('li', {}, `${hold.purpose === 'COMMISSION' ? `Hoa hồng đơn ${hold.orderRef ?? '—'}` : 'Rút tiền'} · ${money(hold.amountVnd)} · ${HOLD_STATUS_LABEL[hold.status]} · ${when(hold.createdAt)}`)),
      ),
    );
  }
  if (detail.recent.length > 0) {
    parts.push(h('h3', { class: 'subtitle' }, 'Giao dịch gần đây'), h('ul', { class: 'hint-list' }, ...detail.recent.map((row) => h('li', {}, ledgerSentence(row)))));
  }
  return parts;
}

function ledgerSentence(row: LedgerItem): string {
  const base = `${LEDGER_KIND_LABEL[row.kind]}${row.orderRef === null ? '' : ` · đơn ${row.orderRef}`} · ${isHoldKind(row.kind) ? money(row.amountVnd) : signedMoney(row.amountVnd)}`;
  const status = row.holdStatus === null ? '' : ` · ${HOLD_STATUS_LABEL[row.holdStatus]}`;
  const after = row.balanceAfterVnd === null ? '' : ` · số dư sau ${money(row.balanceAfterVnd)}`;
  return `${base}${status}${after} · ${when(row.at)}`;
}

// ---- M04-A06: transactions ---------------------------------------------------------------------------------------------------------

export class TransactionsView {
  readonly #results = h('div', { class: 'results' });
  readonly #kind = h('select', { id: 'ledger-kind', class: 'select' }, h('option', { value: 'ALL' }, 'Tất cả loại'), ...LEDGER_KINDS.map((kind) => h('option', { value: kind }, LEDGER_KIND_LABEL[kind])));
  #items: readonly LedgerItem[] = [];
  #cursor: string | null = null;
  #latest = 0;
  #alive = true;
  #loadingMore = false;
  #filter: LedgerFilterOps;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
    driverId: string | null,
  ) {
    this.#filter = { kind: 'ALL', driverId };
    this.#kind.addEventListener('change', () => {
      this.#filter = { ...this.#filter, kind: this.#kind.value as LedgerKind | 'ALL' };
      void this.load();
    });
    const clear =
      driverId === null
        ? undefined
        : (() => {
            const button = secondary('Bỏ lọc Shipper');
            button.addEventListener('click', () => this.host.go({ name: 'finance-transactions' }));
            return button;
          })();
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'ledger-title' },
        pageHead('Giao dịch', 'Nạp tiền, rút tiền đã chuyển, hoa hồng và các khoản tạm giữ. Tạm giữ/giải phóng chỉ là thông tin, không phải ghi nợ hay ghi có.', 'ledger-title', refreshButton(() => void this.load())),
        h('div', { class: 'toolbar toolbar-filters' }, h('label', { for: 'ledger-kind', class: 'sr-only' }, 'Loại giao dịch'), this.#kind, clear),
        this.#results,
      ),
    );
  }

  dispose(): void {
    this.#alive = false;
    this.#items = [];
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#items = [];
    this.#cursor = null;
    this.#draw({ kind: 'loading' });
    const read = await this.host.ops.ledger(this.#filter, null);
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = read.data.items;
      this.#cursor = read.data.nextCursor;
      this.#draw(read.data.items.length === 0 ? { kind: 'empty' } : { kind: 'rows' });
      return;
    }
    this.#draw({ kind: 'read', read });
  }

  async #more(): Promise<void> {
    if (this.#cursor === null || this.#loadingMore) {
      return;
    }
    this.#loadingMore = true;
    const token = this.#latest;
    this.#draw({ kind: 'rows' });
    const read = await this.host.ops.ledger(this.#filter, this.#cursor);
    this.#loadingMore = false;
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = [...this.#items, ...read.data.items];
      this.#cursor = read.data.nextCursor;
      this.#draw({ kind: 'rows' });
      return;
    }
    void this.load();
  }

  #draw(state: { kind: 'loading' } | { kind: 'empty' } | { kind: 'rows' } | { kind: 'read'; read: Raw }): void {
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Loại' }, { label: 'Shipper' }, { label: 'Tham chiếu' }, { label: 'Số tiền', end: true }, { label: 'Số dư sau', end: true }];
    const caption = 'Giao dịch';
    switch (state.kind) {
      case 'loading':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: skeleton() }));
        return;
      case 'empty':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: emptyPanel('Không có giao dịch', 'Chưa có giao dịch nào khớp bộ lọc.') }));
        return;
      case 'read':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: readPanel(state.read, this.host, () => void this.load()) }));
        return;
      case 'rows': {
        const rows = this.#items.map((row) => {
          const hold = isHoldKind(row.kind);
          const reference = row.orderRef !== null ? `Đơn ${row.orderRef}` : row.sourceId !== null ? `#${shortId(row.sourceId)}` : '—';
          return h(
            'tr',
            {},
            cell('Thời gian', when(row.at)),
            cell('Loại', LEDGER_KIND_LABEL[row.kind], row.holdStatus === null ? undefined : ` · ${HOLD_STATUS_LABEL[row.holdStatus]}`),
            cell('Shipper', row.shipper === null ? '—' : identityLabel(row.shipper)),
            cell('Tham chiếu', reference),
            cell('Số tiền', hold ? `${money(row.amountVnd)} (tạm giữ)` : signedMoney(row.amountVnd)),
            cell('Số dư sau', row.balanceAfterVnd === null ? '—' : money(row.balanceAfterVnd)),
          );
        });
        const card = tableCard(caption, columns, { rows });
        if (this.#cursor === null) {
          this.#results.replaceChildren(card, h('p', { class: 'hint' }, 'Đã hiển thị tất cả giao dịch theo bộ lọc. Danh sách không có tổng số.'));
          return;
        }
        const more = secondary(this.#loadingMore ? 'Đang tải…' : 'Tải thêm');
        more.disabled = this.#loadingMore;
        more.addEventListener('click', () => void this.#more());
        this.#results.replaceChildren(card, h('div', { class: 'more' }, more));
      }
    }
  }
}

// ---- M04-A06: reconciliation -------------------------------------------------------------------------------------------------------

export class ReconciliationPageView {
  readonly #body = h('div', { class: 'results' });
  readonly #notice = noticeBlock('ops-reconciliation-notice', 'warning');
  #alive = true;
  #latest = 0;
  #busy = false;
  #pending: (() => Promise<FinanceOutcome & { readonly result?: { readonly driftWallets: number; readonly driftWithdrawals: number; readonly recorded: boolean } }>) | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
  ) {
    root.replaceChildren(
      h('section', { class: 'content content-wide', 'aria-labelledby': 'ops-reconciliation-title' }, pageHead('Đối soát', 'So sánh số dư và tiền tạm giữ của từng ví với sổ giao dịch trong cùng một thời điểm. Lệch chỉ được báo cáo, không bao giờ tự sửa.', 'ops-reconciliation-title', refreshButton(() => void this.load())), this.#notice.element, this.#body),
    );
  }

  dispose(): void {
    this.#alive = false;
    this.#pending = undefined;
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#body.replaceChildren(skeleton());
    const read = await this.host.ops.reconciliation();
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind !== 'ready') {
      this.#body.replaceChildren(readPanel(read as Raw, this.host, () => void this.load()));
      return;
    }
    const view = read.data;
    const parts: HTMLElement[] = [
      h(
        'div',
        { class: 'detail-block' },
        definition([
          ['Số ví đã kiểm tra', String(view.checkedWallets)],
          ['Ví lệch sổ giao dịch', String(view.driftWallets)],
          ['Yêu cầu rút lệch hold/ledger', String(view.driftWithdrawals)],
          ['Rút tiền đang chờ đối soát', String(view.withdrawalsInReconciliation)],
        ]),
        view.driftWallets + view.driftWithdrawals === 0 ? h('p', { class: 'message message-notice' }, 'Không phát hiện lệch: mọi ví khớp sổ giao dịch và các khoản tạm giữ đang hoạt động.') : h('p', { class: 'message message-error', role: 'alert' }, 'Có lệch. Hệ thống không tự sửa số dư. Liên hệ kỹ thuật và giữ nguyên hiện trường.'),
        h('div', { class: 'detail-actions' }, link({ name: 'finance-withdrawals', status: 'RECONCILIATION' }, 'Xem rút tiền cần đối soát', this.host), this.#checkButton()),
      ),
    ];
    if (view.drift.length > 0) {
      const columns: readonly Column[] = [{ label: 'Shipper' }, { label: 'Số dư (B)', end: true }, { label: 'Tổng sổ giao dịch', end: true }, { label: 'Số dư sau dòng cuối', end: true }, { label: 'Tạm giữ (H)', end: true }, { label: 'Tổng hold đang giữ', end: true }];
      parts.push(
        tableCard(
          'Ví lệch',
          columns,
          {
            rows: view.drift.map((row) =>
              h(
                'tr',
                {},
                cell('Shipper', identityLabel(row.shipper)),
                cell('Số dư', money(row.balanceVnd)),
                cell('Sổ giao dịch', money(row.ledgerSumVnd)),
                cell('Dòng cuối', money(row.lastBalanceAfterVnd)),
                cell('Tạm giữ', money(row.heldVnd)),
                cell('Hold đang giữ', money(row.activeHoldsVnd)),
              ),
            ),
          },
        ),
      );
    }
    this.#body.replaceChildren(...parts);
  }

  #checkButton(): HTMLElement {
    const check = secondary('Chạy kiểm tra và ghi nhận kết quả');
    check.disabled = !this.host.rights().canReconcile || this.#busy;
    check.title = this.host.rights().canReconcile ? '' : 'Cần quyền "Đối soát rút tiền" do SYSTEM cấp.';
    check.addEventListener('click', () => void this.#runCheck());
    return check;
  }

  async #runCheck(): Promise<void> {
    if (this.#busy) {
      return;
    }
    const key = this.host.newKey();
    const send = (): Promise<FinanceOutcome & { readonly result?: { readonly driftWallets: number; readonly driftWithdrawals: number; readonly recorded: boolean } }> => this.host.ops.runCheck({ key });
    this.#pending = send;
    this.#busy = true;
    const outcome = await send();
    this.#busy = false;
    if (!this.#alive || sessionGone(outcome, this.host)) {
      return;
    }
    if (outcome.kind === 'ok') {
      this.#pending = undefined;
      await this.load();
      const r = outcome.result;
      this.#notice.set(r === undefined ? 'Đã chạy kiểm tra.' : r.recorded ? `Phát hiện lệch (${r.driftWallets} ví, ${r.driftWithdrawals} yêu cầu rút) và đã ghi nhận vào nhật ký vận hành. Không có số dư nào bị sửa.` : 'Đã chạy kiểm tra: không có lệch.');
      return;
    }
    const text = opsOutcomeText(outcome);
    this.#notice.set(text.text === '' ? FINANCE_FORBIDDEN_MESSAGE : text.text);
  }
}

// ---- M04-A05: withdrawals ----------------------------------------------------------------------------------------------------------

export class WithdrawalListView {
  readonly #results = h('div', { class: 'results' });
  #items: readonly WithdrawalItem[] = [];
  #cursor: string | null = null;
  #latest = 0;
  #alive = true;
  #loadingMore = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
    private readonly filter: WithdrawalFilterOps,
  ) {
    const tabs = h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': 'Trạng thái yêu cầu rút' },
      ...WITHDRAWAL_FILTERS.map((item) => {
        const tab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': item === filter ? 'true' : 'false' }, WITHDRAWAL_FILTER_LABEL[item]);
        tab.addEventListener('click', () => this.host.go({ name: 'finance-withdrawals', status: item }));
        return tab;
      }),
    );
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'withdrawals-title' },
        pageHead('Rút tiền', 'Yêu cầu rút tiền của Shipper. Hệ thống không tự chuyển khoản: quản trị viên chuyển thủ công theo tài khoản đã chụp lúc tạo yêu cầu rồi ghi nhận ở đây.', 'withdrawals-title', refreshButton(() => void this.load())),
        h('div', { class: 'toolbar toolbar-filters' }, tabs),
        this.#results,
      ),
    );
  }

  dispose(): void {
    this.#alive = false;
    this.#items = [];
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#items = [];
    this.#cursor = null;
    this.#draw({ kind: 'loading' });
    const read = await this.host.ops.withdrawals(this.filter, null);
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = read.data.items;
      this.#cursor = read.data.nextCursor;
      this.#draw(read.data.items.length === 0 ? { kind: 'empty' } : { kind: 'rows' });
      return;
    }
    this.#draw({ kind: 'read', read });
  }

  async #more(): Promise<void> {
    if (this.#cursor === null || this.#loadingMore) {
      return;
    }
    this.#loadingMore = true;
    const token = this.#latest;
    this.#draw({ kind: 'rows' });
    const read = await this.host.ops.withdrawals(this.filter, this.#cursor);
    this.#loadingMore = false;
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = [...this.#items, ...read.data.items];
      this.#cursor = read.data.nextCursor;
      this.#draw({ kind: 'rows' });
      return;
    }
    void this.load();
  }

  #draw(state: { kind: 'loading' } | { kind: 'empty' } | { kind: 'rows' } | { kind: 'read'; read: Raw }): void {
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Mã' }, { label: 'Shipper' }, { label: 'Số tiền', end: true }, { label: 'Tài khoản nhận' }, { label: 'Trạng thái' }, { label: '', end: true }];
    const caption = 'Yêu cầu rút tiền';
    switch (state.kind) {
      case 'loading':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: skeleton() }));
        return;
      case 'empty':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: emptyPanel('Không có yêu cầu', 'Không có yêu cầu rút tiền nào ở trạng thái này.') }));
        return;
      case 'read':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: readPanel(state.read, this.host, () => void this.load()) }));
        return;
      case 'rows': {
        const rows = this.#items.map((item) =>
          h(
            'tr',
            {},
            cell('Thời gian', when(item.createdAt)),
            cell('Mã', h('code', { title: item.withdrawalId }, item.requestCode)),
            cell('Shipper', identityLabel(item.shipper)),
            cell('Số tiền', money(item.amountVnd)),
            cell('Tài khoản nhận', `${item.destinationBank} · ${item.destinationMasked}`),
            cell('Trạng thái', stateBadge(item.state)),
            cell('', link({ name: 'finance-withdrawal', id: item.withdrawalId }, 'Xem', this.host)),
          ),
        );
        const card = tableCard(caption, columns, { rows });
        if (this.#cursor === null) {
          this.#results.replaceChildren(card, h('p', { class: 'hint' }, 'Đã hiển thị tất cả yêu cầu theo bộ lọc. Danh sách không có tổng số.'));
          return;
        }
        const more = secondary(this.#loadingMore ? 'Đang tải…' : 'Tải thêm');
        more.disabled = this.#loadingMore;
        more.addEventListener('click', () => void this.#more());
        this.#results.replaceChildren(card, h('div', { class: 'more' }, more));
      }
    }
  }
}

/** What an intent sends, kept as a closure with its key: a retry after an unknown outcome calls the SAME one. */
interface Pending {
  readonly label: string;
  readonly send: () => Promise<FinanceOutcome>;
}

export class WithdrawalDetailView {
  readonly #body = h('div', {});
  readonly #notice = noticeBlock('withdrawal-detail-notice', 'warning');
  readonly #actual = h('input', { id: 'wd-actual', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '16' });
  readonly #transaction = h('input', { id: 'wd-txid', class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '160' });
  readonly #paidAt = h('input', { id: 'wd-paid-at', class: 'input date-input', type: 'datetime-local' });
  readonly #account = h('select', { id: 'wd-account', class: 'select' });
  readonly #destination = h('input', { id: 'wd-destination', type: 'checkbox' });
  readonly #reportReason = h('select', { id: 'wd-report-reason', class: 'select' }, ...RECONCILIATION_REASONS.map((reason) => h('option', { value: reason }, RECONCILIATION_REASON_LABEL[reason])));
  readonly #outcome = h('select', { id: 'wd-outcome', class: 'select' }, ...(['UNKNOWN', 'CONFIRMED_PAID', 'CONFIRMED_NOT_SENT_FINAL'] as const).map((outcome) => h('option', { value: outcome }, RECONCILE_OUTCOME_LABEL[outcome])));
  readonly #reasonCode = h('select', { id: 'wd-reason-code', class: 'select' }, ...(['STATEMENT_CONFIRMED', 'BANK_CONFIRMED_NOT_SENT', 'STILL_UNCLEAR', 'OTHER'] as const).map((code) => h('option', { value: code }, RECONCILE_REASON_CODE_LABEL[code])));
  readonly #notSent = h('input', { id: 'wd-not-sent', type: 'checkbox' });
  readonly #errors: Record<'actual' | 'transactionId' | 'paidAt' | 'accountId' | 'destinationChecked', HTMLElement> = {
    actual: h('p', { class: 'hint', role: 'alert', hidden: true }),
    transactionId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    paidAt: h('p', { class: 'hint', role: 'alert', hidden: true }),
    accountId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    destinationChecked: h('p', { class: 'hint', role: 'alert', hidden: true }),
  };
  #detail: WithdrawalDetailOps | undefined;
  #accounts: readonly SourceAccount[] = [];
  #pending: Pending | undefined;
  #busy = false;
  #dialog: DialogHandle | undefined;
  #alive = true;
  #latest = 0;
  #read: Raw | { kind: 'loading' } = { kind: 'loading' };

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceOpsHost,
    private readonly withdrawalId: string,
  ) {
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'withdrawal-title' }, this.#body));
    this.#draw();
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#dialog = undefined;
    this.#pending = undefined;
    // The draft (amount, transaction code, time, account) is dropped with the page.
    for (const input of [this.#actual, this.#transaction, this.#paidAt]) {
      input.value = '';
    }
    this.#destination.checked = false;
    this.#notSent.checked = false;
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#read = { kind: 'loading' };
    this.#draw();
    const read = await this.host.ops.withdrawal(this.withdrawalId);
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind !== 'ready') {
      this.#detail = undefined;
      this.#read = read;
      this.#draw();
      return;
    }
    this.#detail = read.data;
    const needsAccounts = read.data.rights.canConfirm || read.data.rights.canReport || read.data.rights.canReconcile;
    if (needsAccounts) {
      const accounts = await this.host.ops.sourceAccounts();
      if (!this.#alive || token !== this.#latest || sessionGone(accounts, this.host)) {
        return;
      }
      this.#accounts = accounts.kind === 'ready' ? accounts.data : [];
      this.#refreshAccounts();
    }
    this.#read = { kind: 'not-wired' };
    this.#draw();
  }

  #refreshAccounts(): void {
    const selected = this.#account.value;
    this.#account.replaceChildren(h('option', { value: '' }, 'Chọn tài khoản hệ thống đã chuyển đi'), ...this.#accounts.map((account) => h('option', { value: account.accountId }, `${account.bankId} · ${account.numberMasked}`)));
    if (this.#accounts.some((account) => account.accountId === selected)) {
      this.#account.value = selected;
    }
  }

  #back(): HTMLElement {
    const back = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('arrow-left', 18), 'Danh sách');
    back.addEventListener('click', () => this.host.go({ name: 'finance-withdrawals' }));
    return back;
  }

  #field(label: string, id: string, control: HTMLElement, error?: HTMLElement, hint?: string): HTMLElement {
    return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'input-wrap' }, control), hint === undefined ? undefined : h('p', { class: 'hint' }, hint), error);
  }

  #draw(): void {
    const detail = this.#detail;
    if (detail === undefined) {
      const state = this.#read;
      this.#body.replaceChildren(pageHead('Chi tiết yêu cầu rút', '', 'withdrawal-title', this.#back()), state.kind === 'loading' ? skeleton() : readPanel(state, this.host, () => void this.load()));
      return;
    }
    const parts: (HTMLElement | undefined)[] = [
      pageHead('Chi tiết yêu cầu rút', `Mã ${detail.requestCode} · ${detail.withdrawalId}`, 'withdrawal-title', this.#back()),
      this.#notice.element,
      h(
        'div',
        { class: 'detail-block' },
        definition([
          ['Trạng thái', stateBadge(detail.state)],
          ['Shipper', identityLabel(detail.shipper)],
          ['Số tiền yêu cầu', money(detail.amountVnd)],
          ['Tạo lúc', when(detail.createdAt)],
          ['Xử lý xong lúc', when(detail.resolvedAt)],
          ['Kết quả', detail.outcome === null ? '—' : detail.outcome === 'PAID' ? 'Đã chuyển và ghi nhận' : detail.outcome === 'CANCELLED_BY_SHIPPER' ? 'Shipper tự hủy' : 'Đối soát: chắc chắn chưa chuyển, đã giải phóng tiền'],
        ]),
      ),
      this.#destinationBlock(detail),
      this.#statusBlock(detail),
    ];
    if (this.#pending !== undefined) {
      parts.push(this.#unknownPanel());
    } else {
      parts.push(this.#actions(detail));
    }
    parts.push(this.#history(detail));
    this.#body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== undefined));
  }

  #destinationBlock(detail: WithdrawalDetailOps): HTMLElement {
    const d: Destination = detail.destination;
    const rows: Array<readonly [string, string]> = d.full
      ? [
          ['Ngân hàng', `${d.bankName} (${d.bankCode})`],
          ['Số tài khoản', d.accountNumber],
          ['Chủ tài khoản', d.accountHolder],
        ]
      : [
          ['Ngân hàng', `${d.bankName} (${d.bankCode})`],
          ['Số tài khoản', d.accountNumberMasked],
          ['Chủ tài khoản', d.accountHolderMasked],
        ];
    const note = d.full
      ? 'Đây là tài khoản đã chụp NGUYÊN VẸN lúc Shipper tạo yêu cầu (đã xác minh). Chỉ bạn, người đã nhận xử lý, thấy đầy đủ. Chuyển đúng tài khoản này, đúng số tiền, một lần.'
      : 'Tài khoản nhận được che. Người nhận xử lý (hoặc người đối soát khi cần đối soát) mới thấy đầy đủ.';
    return h('div', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Tài khoản nhận (đã chụp lúc tạo yêu cầu)'), definition(rows), h('p', { class: 'hint' }, note));
  }

  #statusBlock(detail: WithdrawalDetailOps): HTMLElement | undefined {
    const rows: Array<readonly [string, string]> = [];
    if (detail.processing !== null) {
      rows.push(['Nhận xử lý lúc', `${when(detail.processing.startedAt)}${detail.processing.isOwner ? ' (bạn)' : ' (quản trị viên khác)'}`]);
    }
    if (detail.reconciliation !== null) {
      rows.push(['Lý do cần đối soát', RECONCILIATION_REASON_LABEL[detail.reconciliation.reasonCode]], ['Báo cáo lúc', when(detail.reconciliation.reportedAt)]);
    }
    if (detail.outgoing !== null) {
      rows.push(['Giao dịch chuyển đi đã ghi nhận', `${detail.outgoing.bankId} · ${money(detail.outgoing.amountVnd)} · ${when(detail.outgoing.occurredAt)}${detail.outgoing.matchesAmount ? '' : ' — KHÁC số tiền yêu cầu'}`]);
    }
    if (detail.paidAt !== null) {
      rows.push(['Chuyển lúc', when(detail.paidAt)]);
    }
    if (detail.state === 'PENDING' && detail.snapshotCurrent === false) {
      rows.push(['Cảnh báo', 'Shipper đã đổi/chưa xác minh lại tài khoản ngân hàng. Không thể nhận xử lý; Shipper cần hủy và tạo yêu cầu mới.']);
    }
    return rows.length === 0 ? undefined : h('div', { class: 'detail-block' }, definition(rows));
  }

  #history(detail: WithdrawalDetailOps): HTMLElement {
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Lịch sử xử lý'),
      h('ul', { class: 'hint-list' }, ...detail.events.map((event) => h('li', {}, `${when(event.at)} · ${event.kind}${event.fromState === null ? '' : ` (${WITHDRAWAL_STATE_LABEL[event.fromState]} → ${WITHDRAWAL_STATE_LABEL[event.toState]})`}${event.reasonCode === null ? '' : ` · ${event.reasonCode}`}${event.byMe ? ' · bạn' : ''}`))),
    );
  }

  #actions(detail: WithdrawalDetailOps): HTMLElement | undefined {
    const r = detail.rights;
    const blocks: HTMLElement[] = [];
    if (detail.state === 'PENDING') {
      if (r.canProcess && detail.snapshotCurrent !== false) {
        const start = primary('Nhận xử lý (tôi sẽ chuyển khoản thủ công)', 'button');
        start.disabled = this.#busy;
        start.addEventListener('click', () => this.#attemptStart(detail));
        blocks.push(h('div', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Nhận xử lý'), h('p', { class: 'hint' }, 'Chỉ MỘT quản trị viên nhận xử lý mỗi yêu cầu. Sau khi nhận, chỉ bạn thấy đầy đủ tài khoản nhận và chỉ bạn được ghi nhận đã chuyển. Hệ thống KHÔNG tự chuyển tiền.'), h('div', { class: 'detail-actions' }, start)));
      } else if (!r.canProcess) {
        blocks.push(h('p', { class: 'message message-notice' }, 'Bạn không có quyền "Nhận xử lý yêu cầu rút tiền". Nhờ SYSTEM cấp quyền nếu cần.'));
      }
    }
    if (detail.state === 'PROCESSING') {
      if (r.canConfirm) {
        blocks.push(this.#evidenceForm(detail, 'paid'));
      } else if (detail.processing?.isOwner === false) {
        blocks.push(h('p', { class: 'message message-notice' }, 'Yêu cầu đang được quản trị viên khác xử lý. Chỉ người đó được xác nhận đã chuyển tiền.'));
      } else if (detail.processing?.isOwner === true) {
        blocks.push(h('p', { class: 'message message-notice' }, 'Bạn đã nhận xử lý nhưng không (còn) có quyền "Xác nhận đã chuyển tiền".'));
      }
      if (r.canReport) {
        blocks.push(this.#reportBlock(detail));
      }
    }
    if (detail.state === 'RECONCILIATION' && r.canReconcile) {
      blocks.push(this.#reconcileForm(detail));
    }
    return blocks.length === 0 ? undefined : h('div', {}, ...blocks);
  }

  #evidenceFields(): HTMLElement[] {
    return [
      this.#field('Số tiền đã chuyển (VND)', 'wd-actual', this.#actual, this.#errors.actual, 'Đúng như trên sao kê chuyển đi. Không tự điền số tiền yêu cầu.'),
      this.#field('Mã giao dịch chuyển đi', 'wd-txid', this.#transaction, this.#errors.transactionId, 'Đúng như trên sao kê: giữ nguyên chữ hoa/thường và số 0 ở đầu. Mỗi mã chỉ ghi nhận một lần trên toàn hệ thống.'),
      this.#field('Thời điểm chuyển', 'wd-paid-at', this.#paidAt, this.#errors.paidAt, 'Giờ trên sao kê theo múi giờ của trình duyệt.'),
      this.#field('Tài khoản hệ thống đã dùng để chuyển', 'wd-account', this.#account, this.#errors.accountId, this.#accounts.length === 0 ? 'Chưa có tài khoản hệ thống nào được cấu hình. Nhờ SYSTEM thêm ở Tài chính › Tài khoản nhận tiền.' : 'Số tài khoản được che.'),
    ];
  }

  #evidenceForm(detail: WithdrawalDetailOps, mode: 'paid'): HTMLElement {
    void mode;
    const confirm = primary('Kiểm tra và xác nhận đã chuyển', 'button');
    confirm.disabled = this.#busy;
    confirm.addEventListener('click', () => this.#attemptPaid(detail));
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Xác nhận đã chuyển tiền (ghi nhận, không phải lệnh chuyển)'),
      h('p', { class: 'hint' }, `Bạn chuyển khoản thủ công ${money(detail.amountVnd)} đến tài khoản nhận ở trên, rồi nhập đúng số liệu trên sao kê. Tiền ví chỉ bị trừ khi bạn xác nhận ở đây, đúng một lần.`),
      ...this.#evidenceFields(),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'wd-destination' }, this.#destination, ' Tôi đã kiểm tra tiền được chuyển đúng tài khoản nhận của yêu cầu'), this.#errors.destinationChecked),
      h('div', { class: 'detail-actions' }, confirm),
    );
  }

  #reportBlock(detail: WithdrawalDetailOps): HTMLElement {
    const report = secondary('Chuyển sang cần đối soát');
    report.disabled = this.#busy;
    report.addEventListener('click', () => this.#attemptReport(detail));
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Không chắc kết quả / chuyển khác số tiền hoặc tài khoản'),
      h('p', { class: 'hint' }, 'Tiền ví vẫn được giữ, KHÔNG chuyển khoản lại và KHÔNG giải phóng. Nếu đã có chứng từ của lệnh chuyển, nhập ở các ô phía trên để chiếm mã giao dịch (tùy chọn).'),
      this.#field('Lý do', 'wd-report-reason', this.#reportReason),
      h('div', { class: 'detail-actions' }, report),
    );
  }

  #reconcileForm(detail: WithdrawalDetailOps): HTMLElement {
    const go = primary('Kiểm tra và đối soát', 'button');
    go.disabled = this.#busy;
    go.addEventListener('click', () => this.#attemptReconcile(detail));
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Đối soát'),
      h('p', { class: 'hint' }, 'Chỉ kết luận "đã chuyển" khi có chứng từ đủ số tiền; chỉ kết luận "chưa chuyển" khi ngân hàng xác nhận lệnh chưa/không được thực hiện. Một giao dịch chuyển đi đã ghi nhận không bao giờ được giải phóng. Việc đối soát KHÔNG cho phép chuyển thêm.'),
      this.#field('Kết luận', 'wd-outcome', this.#outcome),
      this.#field('Căn cứ', 'wd-reason-code', this.#reasonCode),
      h('p', { class: 'hint' }, detail.outgoing === null ? 'Nếu kết luận "đã chuyển": nhập chứng từ dưới đây.' : 'Đã có giao dịch chuyển đi ghi nhận ở trên; chỉ cần chọn kết luận.'),
      ...(detail.outgoing === null ? [...this.#evidenceFields(), h('div', { class: 'field' }, h('label', { class: 'label', for: 'wd-destination' }, this.#destination, ' Tôi đã kiểm tra tiền được chuyển đúng tài khoản nhận'), this.#errors.destinationChecked)] : []),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'wd-not-sent' }, this.#notSent, ' Ngân hàng đã xác nhận lệnh chuyển CHƯA/KHÔNG được thực hiện (chỉ cho kết luận "chưa chuyển")')),
      h('div', { class: 'detail-actions' }, go),
    );
  }

  #showErrors(checked: EvidenceChecked | undefined): void {
    for (const key of ['actual', 'transactionId', 'paidAt', 'accountId', 'destinationChecked'] as const) {
      setMessage(this.#errors[key], checked?.errors[key]);
    }
  }

  #draft(): EvidenceDraft {
    return { actual: this.#actual.value, transactionId: this.#transaction.value, paidAt: this.#paidAt.value, accountId: this.#account.value, destinationChecked: this.#destination.checked };
  }

  #evidence(ready: NonNullable<EvidenceChecked['ready']>): OutgoingEvidenceInput {
    return { actualVnd: ready.actualVnd, bankId: ready.bankId, accountId: ready.accountId, transactionId: ready.transactionId, paidAt: ready.paidAt };
  }

  #attemptStart(detail: WithdrawalDetailOps): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const key = this.host.newKey();
    this.#confirmDialog('Nhận xử lý yêu cầu rút tiền?', 'Bạn sẽ là người duy nhất được chuyển khoản thủ công và ghi nhận yêu cầu này. Số tiền vẫn đang được giữ trong ví của Shipper; chưa có khoản nào bị trừ.', [], 'Nhận xử lý', {
      label: 'Nhận xử lý',
      send: () => this.host.ops.startProcessing({ key, withdrawalId: detail.withdrawalId, version: detail.version }),
    });
  }

  #attemptPaid(detail: WithdrawalDetailOps): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const checked = checkEvidence(this.#draft(), detail.amountVnd, this.#accounts, this.host.now(), true);
    this.#showErrors(checked);
    if (checked.ready === undefined) {
      return;
    }
    if (checked.mismatch) {
      setMessage(this.#errors.actual, `Số tiền đã chuyển khác số tiền yêu cầu (${money(detail.amountVnd)}). Không thể ghi là hoàn thành: hãy dùng "Chuyển sang cần đối soát".`);
      return;
    }
    const ready = checked.ready;
    const key = this.host.newKey();
    const evidence = this.#evidence(ready);
    this.#confirmDialog(
      'Xác nhận đã chuyển tiền?',
      'Kiểm tra lại với sao kê. Sau khi xác nhận, tiền được trừ khỏi ví Shipper và không thể sửa.',
      [
        ['Số tiền', money(ready.actualVnd)],
        ['Mã giao dịch', ready.transactionId],
        ['Tài khoản chuyển đi', ready.accountLabel],
        ['Chuyển lúc', formatDateTimeVn(ready.paidAt)],
      ],
      'Xác nhận đã chuyển',
      { label: 'Ghi nhận đã chuyển', send: () => this.host.ops.markPaid({ key, withdrawalId: detail.withdrawalId, version: detail.version, evidence }) },
    );
  }

  #attemptReport(detail: WithdrawalDetailOps): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const reason = this.#reportReason.value as ReconciliationReason;
    if (!RECONCILIATION_REASONS.includes(reason)) {
      return;
    }
    // The evidence is optional here: when ANY field is filled, all of it must be valid.
    const touched = this.#actual.value.trim() !== '' || this.#transaction.value.trim() !== '' || this.#paidAt.value !== '' || this.#account.value !== '';
    let evidence: OutgoingEvidenceInput | undefined;
    if (touched) {
      const checked = checkEvidence(this.#draft(), detail.amountVnd, this.#accounts, this.host.now(), false);
      this.#showErrors(checked);
      if (checked.ready === undefined) {
        return;
      }
      evidence = this.#evidence(checked.ready);
    } else {
      this.#showErrors(undefined);
    }
    const key = this.host.newKey();
    this.#confirmDialog(
      'Chuyển sang cần đối soát?',
      `Lý do: ${RECONCILIATION_REASON_LABEL[reason]}. Tiền vẫn được giữ; không chuyển lại và không giải phóng cho đến khi đối soát xong.`,
      evidence === undefined ? [] : [['Mã giao dịch chiếm chỗ', evidence.transactionId]],
      'Chuyển sang cần đối soát',
      { label: 'Báo cáo đối soát', send: () => this.host.ops.reportReconciliation({ key, withdrawalId: detail.withdrawalId, version: detail.version, reason, ...(evidence === undefined ? {} : { evidence }) }) },
    );
  }

  #attemptReconcile(detail: WithdrawalDetailOps): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const outcome = this.#outcome.value as ReconcileOutcome;
    const reasonCode = this.#reasonCode.value as ReconcileReasonCode;
    let evidence: OutgoingEvidenceInput | undefined;
    if (outcome === 'CONFIRMED_PAID' && detail.outgoing === null) {
      const checked = checkEvidence(this.#draft(), detail.amountVnd, this.#accounts, this.host.now(), true);
      this.#showErrors(checked);
      if (checked.ready === undefined) {
        return;
      }
      if (checked.mismatch) {
        setMessage(this.#errors.actual, 'Số tiền khác số tiền yêu cầu: không thể kết luận "đã chuyển đủ". Giữ trạng thái cần đối soát.');
        return;
      }
      evidence = this.#evidence(checked.ready);
    } else if (outcome === 'CONFIRMED_PAID' && detail.outgoing !== null) {
      if (!detail.outgoing.matchesAmount) {
        this.#notice.set('Giao dịch chuyển đi đã ghi nhận KHÁC số tiền yêu cầu: không thể kết luận "đã chuyển đủ". Cần quyết định nghiệp vụ riêng (chuyển một phần chưa được Owner duyệt).');
        return;
      }
      this.#showErrors(undefined);
    } else if (outcome === 'CONFIRMED_NOT_SENT_FINAL') {
      if (detail.outgoing !== null) {
        this.#notice.set('Đã có giao dịch chuyển đi được ghi nhận: không thể giải phóng tiền.');
        return;
      }
      if (!this.#notSent.checked) {
        this.#notice.set('Chỉ kết luận "chưa chuyển" khi ngân hàng xác nhận lệnh chưa/không được thực hiện. Hãy tích ô xác nhận.');
        return;
      }
      this.#showErrors(undefined);
    } else {
      this.#showErrors(undefined);
    }
    const key = this.host.newKey();
    this.#confirmDialog(
      'Đối soát yêu cầu rút tiền?',
      `Kết luận: ${RECONCILE_OUTCOME_LABEL[outcome]}. ${outcome === 'CONFIRMED_NOT_SENT_FINAL' ? 'Tiền được giải phóng về khả dụng của Shipper, không ghi nợ.' : outcome === 'CONFIRMED_PAID' ? 'Tiền được trừ khỏi ví Shipper đúng một lần.' : 'Yêu cầu giữ nguyên, tiền vẫn bị giữ.'}`,
      evidence === undefined ? [] : [['Mã giao dịch', evidence.transactionId]],
      'Đối soát',
      { label: 'Đối soát', send: () => this.host.ops.reconcile({ key, withdrawalId: detail.withdrawalId, version: detail.version, outcome, reasonCode, ...(evidence === undefined ? {} : { evidence }) }) },
    );
  }

  #confirmDialog(title: string, description: string, rows: ReadonlyArray<readonly [string, string]>, goLabel: string, pending: Pending): void {
    const go = primary(goLabel, 'button');
    const cancel = secondary('Quay lại kiểm tra');
    this.#dialog = openDialog({
      title,
      description,
      body: rows.length === 0 ? [] : [definition(rows)],
      actions: [cancel, go],
      onDismiss: () => this.#closeDialog(),
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
    cancel.addEventListener('click', () => this.#closeDialog());
    go.addEventListener('click', () => {
      go.disabled = true;
      cancel.disabled = true;
      void this.#run(pending);
    });
  }

  #closeDialog(): void {
    this.#dialog?.close();
    this.#dialog = undefined;
  }

  /** Sends ONE command. A second click while it runs is ignored; the answer of a page that was left is dropped. */
  async #run(pending: Pending): Promise<void> {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    const outcome = await pending.send();
    this.#busy = false;
    if (!this.#alive) {
      return;
    }
    this.#closeDialog();
    if (sessionGone(outcome, this.host)) {
      return;
    }
    if (outcome.kind === 'ok') {
      this.#pending = undefined;
      this.#notice.set(undefined);
      await this.load();
      this.#notice.set(`${pending.label}: máy chủ đã xác nhận. Đây là trạng thái mới nhất từ máy chủ.`);
      return;
    }
    if (outcome.kind === 'unknown') {
      // Keep the SAME key and body. Nothing else is sent until the Admin chooses.
      this.#pending = pending;
      this.#notice.set(FINANCE_UNKNOWN_MESSAGE);
      this.#draw();
      return;
    }
    const text = opsOutcomeText(outcome);
    this.#pending = undefined;
    if (text.reload) {
      await this.load();
    } else {
      this.#draw();
    }
    this.#notice.set(text.text);
  }

  #unknownPanel(): HTMLElement {
    const check = secondary('Kiểm tra trạng thái');
    check.addEventListener('click', () => void this.#check());
    const resend = primary('Gửi lại cùng lệnh', 'button');
    resend.disabled = this.#busy;
    resend.addEventListener('click', () => {
      const pending = this.#pending;
      if (pending !== undefined) {
        void this.#run(pending);
      }
    });
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Chưa xác định kết quả'),
      h('p', { class: 'message message-warning', role: 'alert' }, 'Không nhận được phản hồi rõ ràng từ máy chủ. Lệnh có thể đã được ghi nhận. KHÔNG chuyển khoản lại. Hãy kiểm tra trạng thái trước; "Gửi lại cùng lệnh" dùng đúng khóa và nội dung cũ nên không ghi trùng.'),
      h('div', { class: 'detail-actions' }, check, resend),
    );
  }

  async #check(): Promise<void> {
    const before = this.#detail;
    await this.load();
    const after = this.#detail;
    if (after !== undefined && before !== undefined && (after.state !== before.state || after.version !== before.version)) {
      this.#pending = undefined;
      this.#draw();
      this.#notice.set(`Yêu cầu đã ở trạng thái "${WITHDRAWAL_STATE_LABEL[after.state]}". Đối chiếu với sao kê; không chuyển khoản thêm lần nào.`);
    }
  }
}
