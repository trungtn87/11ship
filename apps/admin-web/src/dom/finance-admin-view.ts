import { Failure } from '../core/accounts.js';
import {
  AccessCommand,
  AccountChecked,
  AdminFinanceAccess,
  checkAccount,
  checkConfirm,
  ConfirmCommand,
  ConfirmChecked,
  FinanceAdminSource,
  FinanceOutcome,
  FinanceRead,
  FinanceRights,
  FINANCE_FORBIDDEN_MESSAGE,
  FINANCE_PERMISSIONS,
  FINANCE_PERMISSION_LABEL,
  FINANCE_RATE_LIMITED_MESSAGE,
  FINANCE_UNKNOWN_MESSAGE,
  formatVndAmount,
  messageOf,
  ReceivingAccount,
  REJECT_REASONS,
  REJECT_REASON_LABEL,
  RejectReason,
  shortId,
  SystemAccount,
  TOPUP_FILTERS,
  TOPUP_FILTER_LABEL,
  TOPUP_STATE_LABEL,
  TopupFilter,
  TopupItem,
  TopupState,
} from '../core/finance-admin.js';
import { formatRoute, Route } from '../core/routes.js';
import { formatDateTimeVn } from './accounts-view.js';
import { DialogHandle, openDialog } from './dialog.js';
import { h, message, primary, secondary, setMessage } from './dom.js';
import { icon, UiIconName } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton, statePanel } from './states.js';

// DOM of the REAL finance pages of the administration (M04-B3a): the top-up list and detail with the Admin's decision, the receiving accounts of the
// system (SYSTEM) and the finance rights dialog (SYSTEM). It draws what the server answered and decides nothing: every right is read from the
// server and asked again by it on every call. Every node is created with createElement/textContent (no innerHTML). Nothing is stored (no storage, no
// URL, no console): the transaction code, the amount and the account live in the form for as long as the page does.
//
// Money safety of the browser side: ONE click is ONE request (the button is disabled and the late answer of a closed page is dropped); the
// Idempotency-Key and the exact command of an intent are made once and kept in a closure; after an unknown outcome only "Gửi lại cùng lệnh" (the
// SAME key, the SAME body) and "Kiểm tra trạng thái" (a read) are offered - the page never sends a different command by itself.

export interface FinanceAdminHost {
  readonly source: FinanceAdminSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly go: (route: Route) => void;
  readonly login: () => void;
  readonly home: () => void;
  /** The rights of the calling session as the server last said them (access/me). */
  readonly rights: () => FinanceRights;
  readonly now: () => number;
  readonly dialogHost?: HTMLElement;
}

/** What the shared pieces need from a page host (the top-up pages and the operating pages both provide it). */
export type SessionHost = Pick<FinanceAdminHost, 'home' | 'login' | 'onSessionLost' | 'onForbidden'>;

// ---- small pieces -------------------------------------------------------------------------------------------------------------

export interface Column {
  readonly label: string;
  readonly end?: boolean;
}

export function tableCard(caption: string, columns: readonly Column[], body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
  const head = h('tr', {}, ...columns.map((column) => h('th', { scope: 'col', class: column.end ? 'cell-end' : '' }, column.label)));
  const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
  return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...rows)));
}

export const cell = (label: string, ...children: (Node | string | undefined)[]): HTMLElement => h('td', { 'data-label': label }, ...children);

export function pageHead(title: string, subtitle: string, id: string, ...actions: (HTMLElement | undefined)[]): HTMLElement {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id }, title), h('p', { class: 'lead lead-last' }, subtitle)), ...actions);
}

const STATE_BADGE: Record<TopupState, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  PENDING: ['wait', 'clock'],
  CONFIRMED: ['ok', 'check'],
  REJECTED: ['lock', 'x'],
  CANCELLED: ['neutral', 'x'],
};

function stateBadge(state: TopupState): HTMLElement {
  const [kind, name] = STATE_BADGE[state];
  return h('span', { class: `badge${kind === 'neutral' ? '' : ` badge-${kind}`}` }, icon(name, 14), TOPUP_STATE_LABEL[state]);
}

export function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

export const when = (iso: string | null): string => (iso === null ? '—' : formatDateTimeVn(iso));

/** The sentence of a failed command; `reload` says whether the data on screen is now stale. */
export function outcomeText(outcome: FinanceOutcome): { readonly text: string; readonly reload: boolean } {
  switch (outcome.kind) {
    case 'conflict':
      return { text: messageOf(outcome.code), reload: true };
    case 'refused':
      return { text: messageOf(outcome.code), reload: false };
    case 'unknown':
      return { text: FINANCE_UNKNOWN_MESSAGE, reload: false };
    case 'forbidden':
      return { text: FINANCE_FORBIDDEN_MESSAGE, reload: true };
    case 'rate-limited':
      return { text: FINANCE_RATE_LIMITED_MESSAGE, reload: false };
    case 'not-wired':
      return { text: 'Chức năng chưa được nối với máy chủ.', reload: false };
    default:
      return { text: '', reload: false };
  }
}

/** Shared by the pages: a read that did not give data, drawn as a state panel (never an empty area). */
export function readPanel(read: Exclude<FinanceRead<unknown>, { kind: 'ready' }>, host: SessionHost, retry: () => void): HTMLElement {
  switch (read.kind) {
    case 'not-wired':
      return notWiredPanel('Tài chính chưa được nối với máy chủ nên chưa có dữ liệu nào để hiển thị.');
    case 'not-found':
      return statePanel({ icon: 'file', title: 'Không tìm thấy', text: 'Yêu cầu hoặc tài khoản không tồn tại, hoặc bạn không có quyền xem.', actions: [{ label: 'Về trang chủ', onClick: () => host.home(), kind: 'secondary' }] });
    case 'failed':
      return failurePanel(read.failure as Failure, { retry, login: () => host.login(), home: () => host.home() }, read.retryAfterSec);
  }
}

/** Handles the two outcomes every page treats the same way. Returns true when the page must stop (the session is gone). */
export function sessionGone(outcome: FinanceOutcome | FinanceRead<unknown>, host: SessionHost): boolean {
  if (outcome.kind === 'session-expired' || (outcome.kind === 'failed' && outcome.failure === 'session-expired')) {
    host.onSessionLost();
    return true;
  }
  if (outcome.kind === 'forbidden' || (outcome.kind === 'failed' && outcome.failure === 'forbidden')) {
    host.onForbidden();
  }
  return false;
}

export function noticeBlock(id: string, kind: 'error' | 'notice' | 'warning'): { readonly element: HTMLElement; set(text: string | undefined): void } {
  const element = message(kind, id);
  return { element, set: (text) => setMessage(element, text) };
}

// ---- M04-A03: the list ----------------------------------------------------------------------------------------------------------

export class TopupListView {
  readonly #results: HTMLElement;
  readonly #notice = noticeBlock('topup-notice', 'warning');
  #items: readonly TopupItem[] = [];
  #cursor: string | null = null;
  #latest = 0;
  #alive = true;
  #loadingMore = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceAdminHost,
    private readonly filter: TopupFilter,
  ) {
    const tabs = h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': 'Trạng thái yêu cầu nạp' },
      ...TOPUP_FILTERS.map((item) => {
        const tab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': item === filter ? 'true' : 'false' }, TOPUP_FILTER_LABEL[item]);
        tab.addEventListener('click', () => this.host.go({ name: 'finance-topups', status: item }));
        return tab;
      }),
    );
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    this.#results = h('div', { class: 'results' });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'topups-title' },
        pageHead('Nạp tiền', 'Yêu cầu nạp tiền của Shipper. Chỉ cộng ví sau khi bạn đối chiếu sao kê ngân hàng.', 'topups-title', refresh),
        h('div', { class: 'toolbar toolbar-filters' }, tabs),
        this.#notice.element,
        this.#results,
      ),
    );
    if (!host.rights().canRecord) {
      this.#notice.set('Bạn chỉ có quyền xem. Cần quyền "Xác nhận / từ chối nạp tiền" do SYSTEM cấp để xử lý yêu cầu.');
    }
  }

  dispose(): void {
    this.#alive = false;
    this.#items = [];
    this.#cursor = null;
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#items = [];
    this.#cursor = null;
    this.#draw({ kind: 'loading' });
    const read = await this.host.source.topups(this.filter, null);
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
    const read = await this.host.source.topups(this.filter, this.#cursor);
    this.#loadingMore = false;
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind === 'ready') {
      this.#items = [...this.#items, ...read.data.items];
      this.#cursor = read.data.nextCursor;
    } else if (read.kind === 'failed' && read.failure === 'forbidden') {
      this.#draw({ kind: 'read', read });
      return;
    } else {
      // A cursor the server no longer accepts (rights or data changed): start again from page 1 instead of showing a half list.
      void this.load();
      return;
    }
    this.#draw({ kind: 'rows' });
  }

  #draw(state: { kind: 'loading' } | { kind: 'empty' } | { kind: 'rows' } | { kind: 'read'; read: Exclude<FinanceRead<unknown>, { kind: 'ready' }> }): void {
    const columns: readonly Column[] = [{ label: 'Thời gian' }, { label: 'Mã yêu cầu' }, { label: 'Shipper (ID)' }, { label: 'Tiền đề nghị', end: true }, { label: 'Tiền thực nhận', end: true }, { label: 'Trạng thái' }, { label: '', end: true }];
    const caption = 'Yêu cầu nạp tiền';
    switch (state.kind) {
      case 'loading':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: skeleton() }));
        return;
      case 'empty':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: emptyPanel('Không có yêu cầu', this.filter === 'PENDING' ? 'Hiện không có yêu cầu nạp tiền nào đang chờ xác nhận.' : 'Không có yêu cầu nào ở trạng thái này.') }));
        return;
      case 'read':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: readPanel(state.read, this.host, () => void this.load()) }));
        return;
      case 'rows': {
        const rows = this.#items.map((item) => {
          const open = h('a', { href: formatRoute({ name: 'finance-topup', id: item.requestId }), class: 'table-link' }, 'Xem');
          open.addEventListener('click', (event) => {
            if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              this.host.go({ name: 'finance-topup', id: item.requestId });
            }
          });
          return h(
            'tr',
            {},
            cell('Thời gian', when(item.createdAt)),
            cell('Mã yêu cầu', h('code', { title: item.requestId }, shortId(item.requestId))),
            cell('Shipper (ID)', h('code', { title: item.driverId }, shortId(item.driverId))),
            cell('Tiền đề nghị', formatVndAmount(item.requestedVnd)),
            cell('Tiền thực nhận', item.actualVnd === null ? '—' : formatVndAmount(item.actualVnd)),
            cell('Trạng thái', stateBadge(item.state)),
            cell('', open),
          );
        });
        const card = tableCard(caption, columns, { rows });
        if (this.#cursor === null) {
          this.#results.replaceChildren(card, h('p', { class: 'hint' }, 'Đã hiển thị tất cả yêu cầu theo bộ lọc. Danh sách không có tổng số hay tìm kiếm theo tên/số điện thoại.'));
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

// ---- M04-A04: detail and decision ---------------------------------------------------------------------------------------------------

/** What an intent sends, kept as a closure with its key: a retry after an unknown outcome calls the SAME one. */
interface Pending {
  readonly label: string;
  readonly send: () => Promise<FinanceOutcome>;
}

export class TopupDetailView {
  readonly #body: HTMLElement;
  readonly #notice = noticeBlock('topup-detail-notice', 'warning');
  readonly #actual = h('input', { id: 'confirm-actual', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '16' });
  readonly #transaction = h('input', { id: 'confirm-txid', class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '160' });
  readonly #receivedAt = h('input', { id: 'confirm-received', class: 'input date-input', type: 'datetime-local' });
  readonly #account = h('select', { id: 'confirm-account', class: 'select' });
  readonly #reason = h('select', { id: 'reject-reason', class: 'select' }, ...REJECT_REASONS.map((reason) => h('option', { value: reason }, REJECT_REASON_LABEL[reason])));
  readonly #errors: Record<'actual' | 'transactionId' | 'receivedAt' | 'accountId', HTMLElement> = {
    actual: h('p', { class: 'hint', role: 'alert', hidden: true }),
    transactionId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    receivedAt: h('p', { class: 'hint', role: 'alert', hidden: true }),
    accountId: h('p', { class: 'hint', role: 'alert', hidden: true }),
  };
  #detail: TopupItem | undefined;
  #accounts: readonly ReceivingAccount[] = [];
  #accountsFailed: Exclude<FinanceRead<unknown>, { kind: 'ready' }> | undefined;
  #pending: Pending | undefined;
  #busy = false;
  #dialog: DialogHandle | undefined;
  #alive = true;
  #latest = 0;
  #read: Exclude<FinanceRead<unknown>, { kind: 'ready' }> | { kind: 'loading' } = { kind: 'loading' };

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceAdminHost,
    private readonly requestId: string,
  ) {
    this.#body = h('div', {});
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'topup-title' }, this.#body));
    this.#draw();
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#dialog = undefined;
    this.#pending = undefined;
    // The draft (amount, transaction code, time, account) is dropped with the page.
    for (const input of [this.#actual, this.#transaction, this.#receivedAt]) {
      input.value = '';
    }
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#read = { kind: 'loading' };
    this.#draw();
    const read = await this.host.source.topup(this.requestId);
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
    this.#accountsFailed = undefined;
    if (read.data.state === 'PENDING' && this.host.rights().canRecord) {
      const accounts = await this.host.source.receivingAccounts();
      if (!this.#alive || token !== this.#latest || sessionGone(accounts, this.host)) {
        return;
      }
      if (accounts.kind === 'ready') {
        this.#accounts = accounts.data;
        this.#refreshAccounts();
      } else {
        this.#accounts = [];
        this.#accountsFailed = accounts;
      }
    }
    this.#read = { kind: 'not-wired' };
    this.#draw();
  }

  #refreshAccounts(): void {
    const selected = this.#account.value;
    const options = [h('option', { value: '' }, 'Chọn tài khoản nhận tiền'), ...this.#accounts.filter((account) => account.canReceive).map((account) => h('option', { value: account.accountId }, `${account.bankId} · ${account.numberMasked}`))];
    this.#account.replaceChildren(...options);
    if (this.#accounts.some((account) => account.accountId === selected && account.canReceive)) {
      this.#account.value = selected;
    }
  }

  #draw(): void {
    const detail = this.#detail;
    if (detail === undefined) {
      const state = this.#read;
      this.#body.replaceChildren(
        pageHead('Chi tiết yêu cầu nạp', '', 'topup-title', this.#back()),
        state.kind === 'loading' ? skeleton() : readPanel(state, this.host, () => void this.load()),
      );
      return;
    }
    const parts: (HTMLElement | undefined)[] = [
      pageHead('Chi tiết yêu cầu nạp', `Mã yêu cầu ${detail.requestId}`, 'topup-title', this.#back()),
      this.#notice.element,
      h(
        'div',
        { class: 'detail-block' },
        definition([
          ['Trạng thái', stateBadge(detail.state)],
          ['Shipper (ID)', detail.driverId],
          ['Tiền đề nghị', formatVndAmount(detail.requestedVnd)],
          ['Tiền thực nhận', detail.actualVnd === null ? '—' : formatVndAmount(detail.actualVnd)],
          ['Tiền về lúc', when(detail.receivedAt)],
          ['Tạo lúc', when(detail.createdAt)],
          ['Xử lý lúc', when(detail.resolvedAt)],
        ]),
        h('p', { class: 'hint' }, 'Ảnh chuyển khoản, ghi chú, mã tham chiếu và nội dung chuyển khoản: Chưa hỗ trợ trong phiên bản này. Tên và số điện thoại Shipper xem ở màn Vận hành › Shipper.'),
      ),
    ];
    if (this.#pending !== undefined) {
      parts.push(this.#unknownPanel());
    } else if (detail.state === 'PENDING') {
      parts.push(this.host.rights().canRecord ? this.#decisionForms(detail) : h('p', { class: 'message message-notice' }, 'Bạn chỉ có quyền xem. Cần quyền "Xác nhận / từ chối nạp tiền" để xử lý yêu cầu này.'));
    } else {
      parts.push(h('p', { class: 'hint' }, 'Yêu cầu đã ở trạng thái cuối, không còn thao tác nào.'));
    }
    this.#body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== undefined));
  }

  #back(): HTMLElement {
    const back = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('arrow-left', 18), 'Danh sách');
    back.addEventListener('click', () => this.host.go({ name: 'finance-topups' }));
    return back;
  }

  #field(label: string, id: string, control: HTMLElement, error: HTMLElement, hint?: string): HTMLElement {
    return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'input-wrap' }, control), hint === undefined ? undefined : h('p', { class: 'hint' }, hint), error);
  }

  #decisionForms(detail: TopupItem): HTMLElement {
    const confirm = primary('Kiểm tra và xác nhận', 'button');
    confirm.disabled = this.#busy;
    confirm.addEventListener('click', () => this.#attemptConfirm(detail));
    const reject = secondary('Từ chối yêu cầu');
    reject.disabled = this.#busy;
    reject.addEventListener('click', () => this.#attemptReject(detail));
    const accountHint =
      this.#accountsFailed !== undefined
        ? 'Không tải được danh sách tài khoản nhận tiền. Làm mới trang để thử lại; không thể xác nhận khi chưa có danh sách.'
        : this.#accounts.some((account) => account.canReceive)
          ? 'Chỉ liệt kê tài khoản đang bật. Số tài khoản được che.'
          : 'Chưa có tài khoản nhận tiền nào đang bật. Nhờ SYSTEM bật tài khoản ở Tài chính › Tài khoản nhận tiền.';
    return h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Đối chiếu sao kê và xác nhận'),
        h('p', { class: 'hint' }, 'Nhập đúng số liệu trên sao kê ngân hàng. Ví chỉ được cộng theo số tiền thực nhận, không theo số tiền đề nghị.'),
        this.#field('Số tiền thực nhận (VND)', 'confirm-actual', this.#actual, this.#errors.actual, 'Ví dụ 60000. Không tự điền số tiền đề nghị.'),
        this.#field('Mã giao dịch ngân hàng', 'confirm-txid', this.#transaction, this.#errors.transactionId, 'Đúng như trên sao kê: giữ nguyên chữ hoa/thường và số 0 ở đầu. Không dùng nội dung chuyển khoản hay ảnh.'),
        this.#field('Thời điểm tiền về', 'confirm-received', this.#receivedAt, this.#errors.receivedAt, 'Giờ trên sao kê theo múi giờ của trình duyệt.'),
        this.#field('Tài khoản nhận tiền', 'confirm-account', this.#account, this.#errors.accountId, accountHint),
        h('div', { class: 'detail-actions' }, confirm),
      ),
      h(
        'div',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Từ chối'),
        h('p', { class: 'hint' }, 'Không cộng tiền. Chỉ gửi mã lý do, không có ghi chú tự do.'),
        this.#field('Lý do', 'reject-reason', this.#reason, h('span', { hidden: true })),
        h('div', { class: 'detail-actions' }, reject),
      ),
    );
  }

  #showErrors(checked: ConfirmChecked): void {
    for (const key of ['actual', 'transactionId', 'receivedAt', 'accountId'] as const) {
      setMessage(this.#errors[key], checked.errors[key]);
    }
  }

  #attemptConfirm(detail: TopupItem): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const checked = checkConfirm({ actual: this.#actual.value, transactionId: this.#transaction.value, receivedAt: this.#receivedAt.value, accountId: this.#account.value }, detail.requestedVnd, this.#accounts, this.host.now());
    this.#showErrors(checked);
    if (checked.ready === undefined) {
      return;
    }
    const ready = checked.ready;
    const command: ConfirmCommand = {
      key: this.host.newKey(),
      requestId: detail.requestId,
      version: detail.version,
      actualVnd: ready.actualVnd,
      bankId: ready.account.bankId,
      accountId: ready.account.accountId,
      transactionId: ready.transactionId,
      receivedAt: ready.receivedAt,
    };
    const send = (): Promise<FinanceOutcome> => this.host.source.confirm(command);
    this.#openSummary(detail, ready, checked.mismatch, { label: 'Ghi nhận tiền', send });
  }

  #openSummary(detail: TopupItem, ready: NonNullable<ConfirmChecked['ready']>, mismatch: boolean, pending: Pending): void {
    const go = primary('Xác nhận đã nhận tiền', 'button');
    const cancel = secondary('Quay lại kiểm tra');
    const warning = mismatch
      ? h('p', { class: 'message message-warning', role: 'alert' }, `Số thực nhận ${formatVndAmount(ready.actualVnd)} KHÁC số đề nghị ${formatVndAmount(detail.requestedVnd)}. Ví sẽ được cộng ${formatVndAmount(ready.actualVnd)}.`)
      : undefined;
    this.#dialog = openDialog({
      title: 'Xác nhận ghi nhận tiền',
      description: 'Kiểm tra lại với sao kê. Sau khi ghi nhận, số tiền được cộng vào ví và không thể sửa.',
      body: [
        ...(warning === undefined ? [] : [warning]),
        definition([
          ['Mã yêu cầu', detail.requestId],
          ['Ngân hàng', ready.account.bankId],
          ['Tài khoản nhận', ready.account.numberMasked],
          ['Số tiền thực nhận', formatVndAmount(ready.actualVnd)],
          ['Mã giao dịch', ready.transactionId],
          ['Tiền về lúc', formatDateTimeVn(ready.receivedAt)],
        ]),
      ],
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

  #attemptReject(detail: TopupItem): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const reason = this.#reason.value as RejectReason;
    if (!REJECT_REASONS.includes(reason)) {
      return;
    }
    const key = this.host.newKey();
    const pending: Pending = { label: 'Từ chối', send: () => this.host.source.reject({ key, requestId: detail.requestId, version: detail.version, reason }) };
    const go = primary('Từ chối yêu cầu', 'button');
    const cancel = secondary('Quay lại');
    this.#dialog = openDialog({
      title: 'Từ chối yêu cầu nạp tiền?',
      description: `Lý do: ${REJECT_REASON_LABEL[reason]}. Không có khoản tiền nào được cộng.`,
      body: [],
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
    const text = outcomeText(outcome);
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
      h('p', { class: 'message message-warning', role: 'alert' }, 'Không nhận được phản hồi rõ ràng từ máy chủ. Lệnh có thể đã được thực hiện. Hãy kiểm tra trạng thái và sao kê trước; "Gửi lại cùng lệnh" dùng đúng khóa và nội dung cũ nên không ghi trùng.'),
      h('div', { class: 'detail-actions' }, check, resend),
    );
  }

  async #check(): Promise<void> {
    const before = this.#detail;
    await this.load();
    const after = this.#detail;
    if (after !== undefined && before !== undefined && (after.state !== 'PENDING' || after.version !== before.version)) {
      this.#pending = undefined;
      this.#draw();
      this.#notice.set(`Yêu cầu đã ở trạng thái "${TOPUP_STATE_LABEL[after.state]}". Đối chiếu với sao kê; không gửi thêm lệnh nào.`);
    }
  }
}

// ---- receiving accounts (SYSTEM) ------------------------------------------------------------------------------------------------------------

export class BankAccountsView {
  readonly #results: HTMLElement;
  readonly #notice = noticeBlock('accounts-notice', 'warning');
  readonly #bank = h('input', { id: 'account-bank', class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '16' });
  readonly #number = h('input', { id: 'account-number', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '32' });
  readonly #holder = h('input', { id: 'account-holder', class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '160' });
  readonly #errors: Record<'bankId' | 'accountNumber' | 'accountHolder', HTMLElement> = {
    bankId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    accountNumber: h('p', { class: 'hint', role: 'alert', hidden: true }),
    accountHolder: h('p', { class: 'hint', role: 'alert', hidden: true }),
  };
  #pending: Pending | undefined;
  #busy = false;
  #dialog: DialogHandle | undefined;
  #alive = true;
  #latest = 0;
  #accounts: readonly SystemAccount[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly host: FinanceAdminHost,
  ) {
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    const add = primary('Thêm tài khoản (chưa bật nhận tiền)', 'button');
    add.addEventListener('click', () => this.#attemptCreate());
    this.#results = h('div', { class: 'results' });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'accounts-title' },
        pageHead('Tài khoản nhận tiền', 'Tài khoản ngân hàng của hệ thống để Shipper chuyển tiền nạp. Chỉ SYSTEM xem và quản lý.', 'accounts-title', refresh),
        this.#notice.element,
        this.#results,
        h(
          'div',
          { class: 'detail-block' },
          h('h2', { class: 'subtitle' }, 'Thêm tài khoản'),
          h('p', { class: 'hint' }, 'Tài khoản mới luôn ở trạng thái tắt. Không sửa hay xóa được; muốn đổi thông tin hãy thêm tài khoản khác. Số tài khoản được giữ dạng chữ để không mất số 0 ở đầu.'),
          this.#field('Mã ngân hàng', 'account-bank', this.#bank, this.#errors.bankId),
          this.#field('Số tài khoản', 'account-number', this.#number, this.#errors.accountNumber),
          this.#field('Tên chủ tài khoản', 'account-holder', this.#holder, this.#errors.accountHolder),
          h('div', { class: 'detail-actions' }, add),
        ),
      ),
    );
  }

  #field(label: string, id: string, control: HTMLElement, error: HTMLElement): HTMLElement {
    return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'input-wrap' }, control), error);
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#dialog = undefined;
    this.#pending = undefined;
    this.#accounts = [];
    for (const input of [this.#bank, this.#number, this.#holder]) {
      input.value = '';
    }
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#results.replaceChildren(tableCard('Tài khoản nhận tiền', [{ label: 'Ngân hàng' }], { panel: skeleton() }));
    const read = await this.host.source.systemAccounts();
    if (!this.#alive || token !== this.#latest || sessionGone(read, this.host)) {
      return;
    }
    if (read.kind !== 'ready') {
      this.#results.replaceChildren(tableCard('Tài khoản nhận tiền', [{ label: 'Ngân hàng' }], { panel: readPanel(read, this.host, () => void this.load()) }));
      return;
    }
    this.#accounts = read.data;
    this.#drawList();
  }

  #drawList(): void {
    const columns: readonly Column[] = [{ label: 'Ngân hàng' }, { label: 'Số tài khoản' }, { label: 'Chủ tài khoản' }, { label: 'Nhận tiền' }, { label: 'Tạo lúc' }, { label: '', end: true }];
    if (this.#accounts.length === 0) {
      this.#results.replaceChildren(tableCard('Tài khoản nhận tiền', columns, { panel: emptyPanel('Chưa có tài khoản nhận tiền', 'Thêm tài khoản bên dưới. Tài khoản mới ở trạng thái tắt cho đến khi bạn bật.') }));
      return;
    }
    const rows = this.#accounts.map((account) => {
      const toggle = account.canReceive ? secondary('Tắt nhận tiền') : primary('Bật nhận tiền', 'button');
      toggle.classList.add('btn-inline');
      toggle.disabled = this.#busy || this.#pending !== undefined;
      toggle.addEventListener('click', () => this.#attemptToggle(account));
      return h(
        'tr',
        {},
        cell('Ngân hàng', account.bankId),
        cell('Số tài khoản', account.accountNumber),
        cell('Chủ tài khoản', account.accountHolder),
        cell('Nhận tiền', h('span', { class: `badge ${account.canReceive ? 'badge-ok' : 'badge-lock'}` }, account.canReceive ? 'Đang bật' : 'Đã tắt')),
        cell('Tạo lúc', when(account.createdAt)),
        cell('', toggle),
      );
    });
    const children: HTMLElement[] = [tableCard('Tài khoản nhận tiền', columns, { rows })];
    if (this.#pending !== undefined) {
      children.push(this.#unknownPanel());
    }
    this.#results.replaceChildren(...children);
  }

  #unknownPanel(): HTMLElement {
    const reload = secondary('Kiểm tra lại danh sách');
    reload.addEventListener('click', () => {
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
    return h('div', { class: 'detail-block' }, h('p', { class: 'message message-warning', role: 'alert' }, FINANCE_UNKNOWN_MESSAGE), h('div', { class: 'detail-actions' }, reload, resend));
  }

  #attemptCreate(): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const checked: AccountChecked = checkAccount({ bankId: this.#bank.value, accountNumber: this.#number.value, accountHolder: this.#holder.value });
    for (const key of ['bankId', 'accountNumber', 'accountHolder'] as const) {
      setMessage(this.#errors[key], checked.errors[key]);
    }
    if (checked.ready === undefined) {
      return;
    }
    const ready = checked.ready;
    const key = this.host.newKey();
    const pending: Pending = { label: 'Thêm tài khoản', send: () => this.host.source.createAccount({ key, bankId: ready.bankId, accountNumber: ready.accountNumber, accountHolder: ready.accountHolder }) };
    void this.#run(pending, () => {
      for (const input of [this.#bank, this.#number, this.#holder]) {
        input.value = '';
      }
    });
  }

  #attemptToggle(account: SystemAccount): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const target = !account.canReceive;
    const key = this.host.newKey();
    const pending: Pending = { label: target ? 'Bật nhận tiền' : 'Tắt nhận tiền', send: () => this.host.source.setReceiving({ key, accountId: account.accountId, version: account.version, canReceive: target }) };
    const go = target ? primary('Bật nhận tiền', 'button') : primary('Tắt nhận tiền', 'button');
    const cancel = secondary('Quay lại');
    this.#dialog = openDialog({
      title: target ? 'Bật nhận tiền cho tài khoản này?' : 'Tắt nhận tiền cho tài khoản này?',
      description: target
        ? `Shipper có thể chuyển tiền vào ${account.bankId} ${account.accountNumber} và Admin có quyền có thể ghi nhận các khoản đó.`
        : `Khi tắt, hệ thống KHÔNG ghi nhận được tiền mới về tài khoản ${account.bankId} ${account.accountNumber}, kể cả tiền Shipper đã chuyển rồi. Tiền về muộn: bật lại, đối soát và xác nhận, rồi tắt lại. Tiền đã ghi nhận không bị ảnh hưởng.`,
      body: [],
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

  async #run(pending: Pending, onOk?: () => void): Promise<void> {
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
      onOk?.();
      await this.load();
      this.#notice.set(`${pending.label}: máy chủ đã xác nhận.`);
      return;
    }
    if (outcome.kind === 'unknown') {
      this.#pending = pending;
      this.#notice.set(FINANCE_UNKNOWN_MESSAGE);
      this.#drawList();
      return;
    }
    this.#pending = undefined;
    const text = outcomeText(outcome);
    if (text.reload) {
      await this.load();
    }
    this.#notice.set(text.text);
  }
}

// ---- finance rights of one administrator (SYSTEM) ----------------------------------------------------------------------------------------

/** The dialog opened from the administrators list. Both rights start OFF; a toggle is one command with its own key. */
export function openFinanceAccessDialog(host: FinanceAdminHost, admin: { readonly id: string; readonly fullName: string }): { close(): void } {
  let alive = true;
  let busy = false;
  let pending: Pending | undefined;
  let access: AdminFinanceAccess | undefined;
  const notice = noticeBlock('finance-access-notice', 'warning');
  const list = h('div', {}, skeleton(2));
  const close = secondary('Đóng');
  const dialog = openDialog({
    title: `Quyền tài chính của ${admin.fullName}`,
    description: 'Mỗi quyền được cấp riêng. Mặc định tắt; quyền xem ứng dụng khác không kéo theo quyền tài chính.',
    body: [
      h('p', { class: 'message message-warning' }, 'Quyền "Xác nhận / từ chối nạp tiền" cho phép xác nhận mọi yêu cầu nạp tiền trong hệ thống. Hiện chưa có giới hạn theo Shipper, khu vực, hạn mức hay hai người duyệt. Quyền "Xem yêu cầu nạp tiền" cần có để thao tác qua giao diện.'),
      notice.element,
      list,
    ],
    actions: [close],
    onDismiss: () => stop(),
    ...(host.dialogHost === undefined ? {} : { host: host.dialogHost }),
  });
  const stop = (): void => {
    alive = false;
    pending = undefined;
    dialog.close();
  };
  close.addEventListener('click', stop);

  const draw = (): void => {
    if (access === undefined) {
      return;
    }
    const current = access;
    const rows = FINANCE_PERMISSIONS.map((key) => {
      const row = current.permissions.find((item) => item.key === key);
      const granted = row?.state === 'GRANTED';
      const version = row?.version ?? 0;
      const toggle = granted ? secondary('Thu hồi') : primary('Cấp quyền', 'button');
      toggle.classList.add('btn-inline');
      toggle.disabled = busy || pending !== undefined;
      toggle.addEventListener('click', () => {
        const command: AccessCommand = { key: host.newKey(), userId: current.userId, permission: key, version, action: granted ? 'revoke' : 'grant' };
        void run({ label: granted ? 'Thu hồi quyền' : 'Cấp quyền', send: () => host.source.changeAccess(command) });
      });
      return h(
        'div',
        { class: 'kv' },
        h('dt', {}, FINANCE_PERMISSION_LABEL[key]),
        h('dd', {}, h('span', { class: `badge ${granted ? 'badge-ok' : 'badge-lock'}` }, granted ? 'Đang được cấp' : row?.state === 'REVOKED' ? 'Đã thu hồi' : 'Chưa cấp'), ' ', toggle),
      );
    });
    const extra: HTMLElement[] = [];
    if (pending !== undefined) {
      const resend = primary('Gửi lại cùng lệnh', 'button');
      resend.addEventListener('click', () => {
        if (pending !== undefined) {
          void run(pending);
        }
      });
      const reload = secondary('Kiểm tra lại quyền');
      reload.addEventListener('click', () => {
        pending = undefined;
        void load();
      });
      extra.push(h('div', { class: 'detail-actions' }, reload, resend));
    }
    list.replaceChildren(h('dl', { class: 'kvs' }, ...rows), ...extra);
  };

  const load = async (): Promise<void> => {
    const read = await host.source.adminAccess(admin.id);
    if (!alive || sessionGone(read, host)) {
      return;
    }
    if (read.kind !== 'ready') {
      list.replaceChildren(readPanel(read, host, () => void load()));
      return;
    }
    access = read.data;
    draw();
  };

  const run = async (command: Pending): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    draw();
    const outcome = await command.send();
    busy = false;
    if (!alive || sessionGone(outcome, host)) {
      return;
    }
    if (outcome.kind === 'ok') {
      pending = undefined;
      notice.set(undefined);
      await load();
      return;
    }
    if (outcome.kind === 'unknown') {
      pending = command;
      notice.set(FINANCE_UNKNOWN_MESSAGE);
      draw();
      return;
    }
    pending = undefined;
    const text = outcomeText(outcome);
    notice.set(text.text);
    if (text.reload) {
      await load();
    } else {
      draw();
    }
  };

  void load();
  return { close: stop };
}

export const FINANCE_RECORD_REQUIRES_READ = 'Tài khoản của bạn có quyền xác nhận nạp tiền nhưng chưa có quyền xem. Nhờ SYSTEM cấp thêm quyền "Xem yêu cầu nạp tiền" để thao tác qua giao diện.';
