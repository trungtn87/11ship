import {
  checkConfirm,
  ConfirmChecked,
  ConfirmCommand,
  FinanceOutcome,
  FinanceRead,
  FinanceRights,
  FINANCE_UNKNOWN_MESSAGE,
  formatVndAmount,
  ReceivingAccount,
  REJECT_REASONS,
  REJECT_REASON_LABEL,
  RejectReason,
  shortId,
} from '../core/finance-admin.js';
import { OrderChatSource } from '../core/order-chat.js';
import { formatRoute, Route } from '../core/routes.js';
import {
  checkReason,
  ENTITLEMENT_REASON_MAX,
  ShopPaymentDetail,
  ShopPaymentFilter,
  ShopPaymentItem,
  ShopPaymentSource,
  SHOP_PAYMENT_FILTERS,
  SHOP_PAYMENT_FILTER_LABEL,
  SHOP_PAYMENT_PURPOSE_LABEL,
  ShopPaymentState,
  stateLabel,
} from '../core/shop-payments.js';
import { formatDateTimeVn } from './accounts-view.js';
import { DialogHandle, openDialog } from './dialog.js';
import { h, primary, secondary, setMessage } from './dom.js';
import { cell, Column, definition, noticeBlock, outcomeText, pageHead, readPanel, sessionGone, SessionHost, tableCard, when } from './finance-admin-view.js';
import { icon, UiIconName } from './icons.js';
import { OrderChatPanel } from './order-chat-panel.js';
import { emptyPanel, skeleton } from './states.js';

// DOM of "Tài chính › Thanh toán quán" (issue #198): the reconciliation queue of the payments shops report with "Tôi đã chuyển khoản", one request with
// TWO SEPARATE buttons — "Xác nhận tiền về" (record the money received from the bank statement, or refuse) and the manual dish right ("Cấp quyền mở rộng số món" /
// "Thu hồi quyền") — and the payment conversation (#199). It draws what the server answered and decides nothing: every right and every state is read from the
// server and asked again by it on every call. Every node is created with createElement/textContent (no innerHTML). Nothing is stored. Recording money opens
// nothing, granting the right records no money, and a chat message does neither.
//
// The same money-safety rules as the top-up page: ONE click is ONE request, the Idempotency-Key and the exact command of an intent are made once and kept, and
// after an unknown outcome only "Gửi lại cùng lệnh" (the SAME key and body) and "Kiểm tra trạng thái" (a read) are offered.

export interface ShopPaymentHost extends SessionHost {
  readonly source: ShopPaymentSource;
  readonly chat: OrderChatSource;
  readonly newKey: () => string;
  readonly go: (route: Route) => void;
  readonly rights: () => FinanceRights;
  readonly now: () => number;
  readonly dialogHost?: HTMLElement;
}

const STATE_BADGE: Record<ShopPaymentState, readonly ['ok' | 'lock' | 'wait' | 'neutral', UiIconName]> = {
  PENDING: ['wait', 'clock'],
  CONFIRMED: ['ok', 'check'],
  REJECTED: ['lock', 'x'],
  CANCELLED: ['neutral', 'x'],
};

function stateBadge(item: Pick<ShopPaymentItem, 'state' | 'reportedAt'>): HTMLElement {
  const [kind, name] = STATE_BADGE[item.state];
  return h('span', { class: `badge${kind === 'neutral' ? '' : ` badge-${kind}`}` }, icon(name, 14), stateLabel(item.state, item.reportedAt !== null));
}

// ---- the queue --------------------------------------------------------------------------------------------------------------

export class ShopPaymentListView {
  readonly #results: HTMLElement;
  readonly #notice = noticeBlock('shop-payment-notice', 'warning');
  #items: readonly ShopPaymentItem[] = [];
  #cursor: string | null = null;
  #latest = 0;
  #alive = true;
  #loadingMore = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShopPaymentHost,
    private readonly filter: ShopPaymentFilter,
  ) {
    const tabs = h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': 'Trạng thái yêu cầu thanh toán' },
      ...SHOP_PAYMENT_FILTERS.map((item) => {
        const tab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': item === filter ? 'true' : 'false' }, SHOP_PAYMENT_FILTER_LABEL[item]);
        tab.addEventListener('click', () => this.host.go({ name: 'shop-payments', filter: item }));
        return tab;
      }),
    );
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    this.#results = h('div', { class: 'results' });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'shop-payments-title' },
        pageHead('Thanh toán quán', 'Quán tự chuyển khoản ngoài ứng dụng rồi báo đã chuyển. Báo chuyển khoản chỉ là thông báo: bạn đối chiếu sao kê, ghi nhận tiền về và mở quyền bằng các nút riêng.', 'shop-payments-title', refresh),
        h('div', { class: 'toolbar toolbar-filters' }, tabs),
        this.#notice.element,
        this.#results,
      ),
    );
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
    const read = await this.host.source.list(this.filter, null);
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
    const read = await this.host.source.list(this.filter, this.#cursor);
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
    // A cursor the server no longer accepts (rights or data changed): start again from page 1 instead of showing a half list.
    void this.load();
  }

  #draw(state: { kind: 'loading' } | { kind: 'empty' } | { kind: 'rows' } | { kind: 'read'; read: Exclude<FinanceRead<unknown>, { kind: 'ready' }> }): void {
    const columns: readonly Column[] = [{ label: 'Tạo lúc' }, { label: 'Quán' }, { label: 'Mục đích' }, { label: 'Tiền đề nghị', end: true }, { label: 'Báo chuyển khoản' }, { label: 'Trạng thái' }, { label: '', end: true }];
    const caption = 'Yêu cầu thanh toán của quán';
    switch (state.kind) {
      case 'loading':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: skeleton() }));
        return;
      case 'empty':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: emptyPanel('Không có yêu cầu', this.filter === 'CHECK' ? 'Hiện không có khoản nào đang chờ đối soát.' : 'Không có yêu cầu nào ở mục này.') }));
        return;
      case 'read':
        this.#results.replaceChildren(tableCard(caption, columns, { panel: readPanel(state.read, this.host, () => void this.load()) }));
        return;
      case 'rows': {
        const rows = this.#items.map((item) => {
          const open = h('a', { href: formatRoute({ name: 'shop-payment', id: item.requestId }), class: 'table-link' }, 'Xem');
          open.addEventListener('click', (event) => {
            if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              this.host.go({ name: 'shop-payment', id: item.requestId });
            }
          });
          return h(
            'tr',
            { 'data-request': item.requestId },
            cell('Tạo lúc', when(item.createdAt)),
            cell('Quán', h('span', { title: item.shopId }, item.shopName === '' ? shortId(item.shopId) : item.shopName)),
            cell('Mục đích', SHOP_PAYMENT_PURPOSE_LABEL[item.purpose]),
            cell('Tiền đề nghị', formatVndAmount(item.requestedVnd)),
            cell('Báo chuyển khoản', when(item.reportedAt)),
            cell('Trạng thái', stateBadge(item)),
            cell('', open),
          );
        });
        const card = tableCard(caption, columns, { rows });
        if (this.#cursor === null) {
          this.#results.replaceChildren(card, h('p', { class: 'hint' }, 'Đã hiển thị tất cả yêu cầu theo bộ lọc.'));
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

// ---- one request ------------------------------------------------------------------------------------------------------------

/** What an intent sends, kept as a closure with its key: a retry after an unknown outcome calls the SAME one. */
interface Pending {
  readonly label: string;
  readonly send: () => Promise<FinanceOutcome>;
}

export class ShopPaymentDetailView {
  readonly #body: HTMLElement;
  readonly #notice = noticeBlock('shop-payment-detail-notice', 'warning');
  readonly #actual = h('input', { id: 'sp-actual', class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '16' });
  readonly #transaction = h('input', { id: 'sp-txid', class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '160' });
  readonly #receivedAt = h('input', { id: 'sp-received', class: 'input date-input', type: 'datetime-local' });
  readonly #account = h('select', { id: 'sp-account', class: 'select' });
  readonly #reason = h('select', { id: 'sp-reject-reason', class: 'select' }, ...REJECT_REASONS.map((reason) => h('option', { value: reason }, REJECT_REASON_LABEL[reason])));
  readonly #entitlementReason = h('textarea', { id: 'sp-entitlement-reason', class: 'textarea', rows: '2', maxlength: String(ENTITLEMENT_REASON_MAX), 'aria-label': 'Lý do' });
  readonly #basedOnPayment = h('input', { type: 'checkbox', id: 'sp-based-on-payment' });
  readonly #errors: Record<'actual' | 'transactionId' | 'receivedAt' | 'accountId' | 'reason', HTMLElement> = {
    actual: h('p', { class: 'hint', role: 'alert', hidden: true }),
    transactionId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    receivedAt: h('p', { class: 'hint', role: 'alert', hidden: true }),
    accountId: h('p', { class: 'hint', role: 'alert', hidden: true }),
    reason: h('p', { class: 'hint', role: 'alert', hidden: true }),
  };
  #detail: ShopPaymentDetail | undefined;
  #accounts: readonly ReceivingAccount[] = [];
  #accountsFailed = false;
  #pending: Pending | undefined;
  #busy = false;
  #dialog: DialogHandle | undefined;
  #chat: OrderChatPanel | undefined;
  #alive = true;
  #latest = 0;
  #read: Exclude<FinanceRead<unknown>, { kind: 'ready' }> | { kind: 'loading' } = { kind: 'loading' };

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShopPaymentHost,
    private readonly requestId: string,
  ) {
    this.#body = h('div', {});
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'shop-payment-title' }, this.#body));
    this.#draw();
  }

  dispose(): void {
    this.#alive = false;
    this.#dialog?.close();
    this.#dialog = undefined;
    this.#pending = undefined;
    this.#chat?.dispose();
    this.#chat = undefined;
    // The draft (amount, transaction code, time, account, reasons) is dropped with the page.
    for (const input of [this.#actual, this.#transaction, this.#receivedAt, this.#entitlementReason]) {
      input.value = '';
    }
    this.root.replaceChildren();
  }

  async load(): Promise<void> {
    this.#latest += 1;
    const token = this.#latest;
    this.#read = { kind: 'loading' };
    this.#draw();
    const read = await this.host.source.detail(this.requestId);
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
    this.#accountsFailed = false;
    if (read.data.state === 'PENDING' && read.data.mayRecord) {
      const accounts = await this.host.source.receivingAccounts();
      if (!this.#alive || token !== this.#latest || sessionGone(accounts, this.host)) {
        return;
      }
      if (accounts.kind === 'ready') {
        this.#accounts = accounts.data;
        this.#refreshAccounts();
      } else {
        this.#accounts = [];
        this.#accountsFailed = true;
      }
    }
    this.#read = { kind: 'not-wired' };
    this.#draw();
  }

  #refreshAccounts(): void {
    const selected = this.#account.value;
    this.#account.replaceChildren(
      h('option', { value: '' }, 'Chọn tài khoản nhận tiền'),
      ...this.#accounts.filter((account) => account.canReceive).map((account) => h('option', { value: account.accountId }, `${account.bankId} · ${account.numberMasked}`)),
    );
    if (this.#accounts.some((account) => account.accountId === selected && account.canReceive)) {
      this.#account.value = selected;
    }
  }

  #back(): HTMLElement {
    const back = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('arrow-left', 18), 'Danh sách');
    back.addEventListener('click', () => this.host.go({ name: 'shop-payments' }));
    return back;
  }

  #draw(): void {
    const detail = this.#detail;
    if (detail === undefined) {
      const state = this.#read;
      this.#body.replaceChildren(pageHead('Chi tiết thanh toán quán', '', 'shop-payment-title', this.#back()), state.kind === 'loading' ? skeleton() : readPanel(state, this.host, () => void this.load()));
      return;
    }
    // The conversation survives a redraw: it is created once per loaded request and keeps its own draft and reading position.
    if (this.#chat === undefined) {
      this.#chat = new OrderChatPanel(
        { kind: 'SHOP_PAYMENT', id: detail.requestId },
        {
          source: this.host.chat,
          newKey: this.host.newKey,
          onSessionLost: this.host.onSessionLost,
          onForbidden: this.host.onForbidden,
          title: 'Trao đổi thanh toán',
          note: 'Tin nhắn chỉ hỗ trợ đối soát và hiển thị cho chủ quán. Tin nhắn không xác nhận tiền và không mở quyền: dùng các nút ở trên.',
          ...(this.host.dialogHost === undefined ? {} : { dialogHost: this.host.dialogHost }),
        },
      );
      this.#chat.start();
    }
    const parts: (HTMLElement | undefined)[] = [
      pageHead('Chi tiết thanh toán quán', `Mã yêu cầu ${detail.requestId}`, 'shop-payment-title', this.#back()),
      this.#notice.element,
      this.#summary(detail),
    ];
    if (this.#pending !== undefined) {
      parts.push(this.#unknownPanel());
    } else {
      parts.push(this.#money(detail), this.#entitlement(detail), this.#account_(detail));
    }
    parts.push(this.#chat.element);
    this.#body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== undefined));
  }

  #summary(detail: ShopPaymentDetail): HTMLElement {
    const shop = h('a', { href: formatRoute({ name: 'shop', id: detail.shopId }), class: 'table-link' }, detail.shopName === '' ? shortId(detail.shopId) : detail.shopName);
    shop.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.host.go({ name: 'shop', id: detail.shopId });
      }
    });
    const items: Array<readonly [string, string | HTMLElement]> = [
      ['Trạng thái', stateBadge(detail)],
      ['Quán', shop],
      ['Mục đích', SHOP_PAYMENT_PURPOSE_LABEL[detail.purpose]],
      ['Tiền đề nghị', formatVndAmount(detail.requestedVnd)],
      ['Quán báo đã chuyển khoản lúc', when(detail.reportedAt)],
      ['Tạo lúc', when(detail.createdAt)],
      ['Xử lý lúc', when(detail.resolvedAt)],
    ];
    if (detail.state === 'REJECTED' && detail.rejectReason !== null) {
      items.push(['Lý do', REJECT_REASONS.includes(detail.rejectReason as RejectReason) ? REJECT_REASON_LABEL[detail.rejectReason as RejectReason] : 'Lý do khác']);
    }
    if (detail.settlement !== null) {
      items.push(
        ['Tiền thực nhận', formatVndAmount(detail.settlement.amountVnd)],
        ['Ngân hàng', detail.settlement.bankId],
        ['Mã giao dịch', h('code', {}, detail.settlement.transactionId)],
        ['Tiền về lúc', when(detail.settlement.receivedAt)],
        ['Ghi nhận lúc', when(detail.settlement.recordedAt)],
      );
    }
    return h(
      'div',
      { class: 'detail-block' },
      definition(items),
      h('p', { class: 'hint' }, 'Báo chuyển khoản chỉ là thông báo của quán: chưa phải tiền thực nhận. Chứng từ tiền đã ghi nhận không sửa được.'),
    );
  }

  /** The money: record the amount RECEIVED from the statement, or refuse. Opens no account and no right. */
  #money(detail: ShopPaymentDetail): HTMLElement {
    if (detail.state !== 'PENDING') {
      return h('div', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Tiền thực nhận'), h('p', { class: 'hint' }, detail.state === 'CONFIRMED' ? 'Tiền đã được ghi nhận và không sửa được.' : 'Yêu cầu đã đóng, không còn thao tác về tiền.'));
    }
    if (!detail.mayRecord) {
      return h('p', { class: 'message message-notice' }, 'Bạn chỉ có quyền xem. Cần quyền "Xác nhận tiền thanh toán quán" do SYSTEM cấp để ghi nhận tiền về hoặc từ chối.');
    }
    const confirm = primary('Kiểm tra và xác nhận tiền về', 'button');
    confirm.id = 'sp-confirm-money';
    confirm.disabled = this.#busy;
    confirm.addEventListener('click', () => this.#attemptConfirm(detail));
    const reject = secondary('Chưa nhận được / từ chối');
    reject.id = 'sp-reject';
    reject.disabled = this.#busy;
    reject.addEventListener('click', () => this.#attemptReject(detail));
    const accountHint = this.#accountsFailed
      ? 'Không tải được danh sách tài khoản nhận tiền. Làm mới trang để thử lại.'
      : this.#accounts.some((account) => account.canReceive)
        ? 'Chỉ liệt kê tài khoản đang bật. Số tài khoản được che.'
        : 'Chưa có tài khoản nhận tiền nào đang bật. Nhờ SYSTEM bật tài khoản ở Tài chính › Tài khoản nhận tiền.';
    return h(
      'div',
      { class: 'split' },
      h(
        'div',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Xác nhận tiền về'),
        h('p', { class: 'hint' }, 'Nhập đúng số liệu trên sao kê ngân hàng. Một giao dịch ngân hàng chỉ được ghi nhận cho một khoản. Bước này không mở tài khoản và không cấp quyền: các việc đó có nút riêng bên dưới.'),
        this.#field('Số tiền thực nhận (VND)', 'sp-actual', this.#actual, this.#errors.actual, 'Ví dụ 200000. Không tự điền số tiền đề nghị.'),
        this.#field('Mã giao dịch ngân hàng', 'sp-txid', this.#transaction, this.#errors.transactionId, 'Đúng như trên sao kê: giữ nguyên chữ hoa/thường và số 0 ở đầu.'),
        this.#field('Thời điểm tiền về', 'sp-received', this.#receivedAt, this.#errors.receivedAt, 'Giờ trên sao kê theo múi giờ của trình duyệt.'),
        this.#field('Tài khoản nhận tiền', 'sp-account', this.#account, this.#errors.accountId, accountHint),
        h('div', { class: 'detail-actions' }, confirm),
      ),
      h(
        'div',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Chưa nhận được tiền / từ chối'),
        h('p', { class: 'hint' }, 'Không ghi nhận tiền. Yêu cầu đóng lại, quán vẫn đọc được lịch sử trao đổi. Chỉ gửi mã lý do.'),
        this.#field('Lý do', 'sp-reject-reason', this.#reason, h('span', { hidden: true })),
        h('div', { class: 'detail-actions' }, reject),
      ),
    );
  }

  /** The manual dish right: a SEPARATE command under its own right. Recording money never does it; it never records money. */
  #entitlement(detail: ShopPaymentDetail): HTMLElement {
    const limit = detail.visibleLimit === null ? 'không giới hạn' : `tối đa ${String(detail.visibleLimit)} món hiển thị`;
    const lines: HTMLElement[] = [
      definition([
        ['Quyền mở rộng số món', detail.menuExpanded ? `Đang có${detail.menuExpandedSince === null ? '' : ` (từ ${formatDateTimeVn(detail.menuExpandedSince)})`}` : 'Chưa có'],
        ['Món đang hiển thị', `${String(detail.visibleCount)} — ${limit}`],
      ]),
      h('p', { class: 'hint' }, 'Món ẩn không chiếm suất và không bị xóa. Quyền được cấp hoặc thu hồi thủ công, không có hạn dùng hay gia hạn.'),
    ];
    if (detail.overLimit) {
      lines.push(h('p', { class: 'message message-warning', role: 'alert' }, `Quán đang hiển thị ${String(detail.visibleCount)} món, nhiều hơn mức ${String(detail.visibleLimit ?? 0)}. Không món nào bị ẩn hay xóa; quán chỉ không thêm hoặc hiện thêm món cho đến khi tự ẩn bớt.`));
    }
    if (detail.history.length > 0) {
      lines.push(
        h(
          'ul',
          { class: 'hint-list', 'aria-label': 'Lịch sử cấp và thu hồi quyền' },
          ...detail.history.map((event) => h('li', {}, `${formatDateTimeVn(event.at)} — ${event.action === 'GRANT' ? 'Cấp quyền' : 'Thu hồi quyền'}: `, h('span', {}, event.reason))),
        ),
      );
    }
    if (!detail.mayManage) {
      lines.push(h('p', { class: 'message message-notice' }, 'Cần quyền "Cấp / thu hồi quyền mở rộng số món" do SYSTEM cấp để thay đổi.'));
      return h('div', { class: 'detail-block', id: 'sp-entitlement' }, h('h2', { class: 'subtitle' }, 'Quyền mở rộng số món'), ...lines);
    }
    const canLink = !detail.menuExpanded && detail.state === 'CONFIRMED' && !detail.grantedByThisPayment;
    const act = detail.menuExpanded ? secondary('Thu hồi quyền mở rộng') : primary('Cấp quyền mở rộng số món', 'button');
    act.id = detail.menuExpanded ? 'sp-revoke' : 'sp-grant';
    act.disabled = this.#busy;
    act.addEventListener('click', () => this.#attemptEntitlement(detail, canLink));
    return h(
      'div',
      { class: 'detail-block', id: 'sp-entitlement' },
      h('h2', { class: 'subtitle' }, 'Quyền mở rộng số món'),
      ...lines,
      this.#field('Lý do (bắt buộc, ghi vào nhật ký kiểm toán)', 'sp-entitlement-reason', this.#entitlementReason, this.#errors.reason),
      canLink ? h('div', { class: 'field-check' }, this.#basedOnPayment, h('label', { class: 'field-label', for: 'sp-based-on-payment' }, 'Cấp quyền theo khoản thanh toán đã nhận tiền này (mỗi khoản chỉ dùng một lần)')) : undefined,
      h('div', { class: 'detail-actions' }, act),
    );
  }

  /** Opening the shop's account stays in "Quản lý quán" with its own guards (profile, hours, GPS, dishes): money recorded here never bypasses them. */
  #account_(detail: ShopPaymentDetail): HTMLElement {
    const open = secondary('Mở trang quản lý quán');
    open.id = 'sp-open-shop';
    open.addEventListener('click', () => this.host.go({ name: 'shop', id: detail.shopId }));
    return h(
      'div',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Mở tài khoản quán'),
      h('p', { class: 'hint' }, `Trạng thái quán: ${detail.shopStatus}. Việc mở tài khoản làm ở Quản lý quán, theo điều kiện thiết lập (hồ sơ, giờ hoạt động, GPS, món hợp lệ). Ghi nhận tiền về không tự mở quán và không vượt qua các điều kiện đó.`),
      h('div', { class: 'detail-actions' }, open),
    );
  }

  #field(label: string, id: string, control: HTMLElement, error: HTMLElement, hint?: string): HTMLElement {
    return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), h('div', { class: 'input-wrap' }, control), hint === undefined ? undefined : h('p', { class: 'hint' }, hint), error);
  }

  // ---- commands ----------------------------------------------------------------------------------------------------------------

  #attemptConfirm(detail: ShopPaymentDetail): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const checked: ConfirmChecked = checkConfirm({ actual: this.#actual.value, transactionId: this.#transaction.value, receivedAt: this.#receivedAt.value, accountId: this.#account.value }, detail.requestedVnd, this.#accounts, this.host.now());
    for (const key of ['actual', 'transactionId', 'receivedAt', 'accountId'] as const) {
      setMessage(this.#errors[key], checked.errors[key]);
    }
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
    const go = primary('Xác nhận đã nhận tiền', 'button');
    const cancel = secondary('Quay lại kiểm tra');
    const warning = checked.mismatch ? h('p', { class: 'message message-warning', role: 'alert' }, `Số thực nhận ${formatVndAmount(ready.actualVnd)} KHÁC số đề nghị ${formatVndAmount(detail.requestedVnd)}. Chứng từ sẽ ghi ${formatVndAmount(ready.actualVnd)}.`) : undefined;
    this.#openDialog('Xác nhận ghi nhận tiền', 'Kiểm tra lại với sao kê. Chứng từ tiền thực nhận không sửa được. Bước này không mở tài khoản và không cấp quyền.', [
      ...(warning === undefined ? [] : [warning]),
      definition([
        ['Quán', detail.shopName],
        ['Ngân hàng', ready.account.bankId],
        ['Tài khoản nhận', ready.account.numberMasked],
        ['Số tiền thực nhận', formatVndAmount(ready.actualVnd)],
        ['Mã giao dịch', ready.transactionId],
        ['Tiền về lúc', formatDateTimeVn(ready.receivedAt)],
      ]),
    ], [cancel, go]);
    cancel.addEventListener('click', () => this.#closeDialog());
    go.addEventListener('click', () => {
      go.disabled = true;
      cancel.disabled = true;
      void this.#run({ label: 'Ghi nhận tiền', send: () => this.host.source.confirm(command) });
    });
  }

  #attemptReject(detail: ShopPaymentDetail): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const reason = this.#reason.value as RejectReason;
    if (!REJECT_REASONS.includes(reason)) {
      return;
    }
    const key = this.host.newKey();
    const go = primary('Xác nhận chưa nhận được', 'button');
    const cancel = secondary('Quay lại');
    this.#openDialog('Chưa nhận được tiền?', `Lý do: ${REJECT_REASON_LABEL[reason]}. Không có khoản tiền nào được ghi nhận và yêu cầu sẽ đóng.`, [], [cancel, go]);
    cancel.addEventListener('click', () => this.#closeDialog());
    go.addEventListener('click', () => {
      go.disabled = true;
      cancel.disabled = true;
      void this.#run({ label: 'Từ chối', send: () => this.host.source.reject({ key, requestId: detail.requestId, version: detail.version, reason }) });
    });
  }

  #attemptEntitlement(detail: ShopPaymentDetail, canLink: boolean): void {
    if (this.#busy || this.#pending !== undefined) {
      return;
    }
    const checked = checkReason(this.#entitlementReason.value);
    setMessage(this.#errors.reason, checked.error);
    if (checked.reason === undefined) {
      return;
    }
    const reason = checked.reason;
    const granting = !detail.menuExpanded;
    const paymentRequestId = granting && canLink && this.#basedOnPayment.checked ? detail.requestId : null;
    const key = this.host.newKey();
    const go = primary(granting ? 'Cấp quyền' : 'Thu hồi quyền', 'button');
    const cancel = secondary('Quay lại');
    this.#openDialog(
      granting ? 'Cấp quyền mở rộng số món?' : 'Thu hồi quyền mở rộng số món?',
      granting ? 'Quán được hiển thị nhiều hơn 20 món cùng lúc, không có hạn dùng. Việc này không ghi nhận tiền.' : 'Quán không bị ẩn hay xóa món nào. Nếu đang hiển thị hơn 20 món, quán chỉ không thêm hoặc hiện thêm món cho đến khi tự ẩn bớt.',
      [definition([['Quán', detail.shopName], ['Lý do', reason], ['Theo khoản thanh toán', paymentRequestId === null ? 'Không (quyết định thủ công)' : shortId(paymentRequestId)]])],
      [cancel, go],
    );
    cancel.addEventListener('click', () => this.#closeDialog());
    go.addEventListener('click', () => {
      go.disabled = true;
      cancel.disabled = true;
      void this.#run({ label: granting ? 'Cấp quyền' : 'Thu hồi quyền', send: () => (granting ? this.host.source.grant({ key, shopId: detail.shopId, reason, paymentRequestId }) : this.host.source.revoke({ key, shopId: detail.shopId, reason })) });
    });
  }

  #openDialog(title: string, description: string, body: HTMLElement[], actions: HTMLElement[]): void {
    this.#dialog = openDialog({ title, description, body, actions, onDismiss: () => this.#closeDialog(), ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }) });
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
      this.#entitlementReason.value = '';
      this.#basedOnPayment.checked = false;
      await this.load();
      void this.#chat?.refresh();
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
    check.addEventListener('click', () => {
      this.#pending = undefined;
      void this.load();
    });
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
      h('p', { class: 'message message-warning', role: 'alert' }, FINANCE_UNKNOWN_MESSAGE),
      h('p', { class: 'hint' }, `Lệnh "${this.#pending?.label ?? ''}" có thể đã được thực hiện. “Gửi lại cùng lệnh” gửi đúng lệnh cũ với cùng khóa, không tạo thêm thay đổi.`),
      h('div', { class: 'detail-actions' }, check, resend),
    );
  }
}
