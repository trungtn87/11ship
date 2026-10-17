import {
  BANK_STATE_LABEL,
  DRIVER_TYPE_LABEL,
  DriverType,
  EVENT_LABEL,
  formatVnd,
  NOT_WIRED_SHIPPERS_REASON,
  parseVnd,
  READINESS_LABEL,
  REASON_MAX,
  REFUSAL_MESSAGE,
  SHIPPER_FILTER_LABEL,
  SHIPPER_FILTERS,
  SHIPPER_PAGE_SIZE,
  ShipperCommandName,
  ShipperCommandRequest,
  ShipperCommandResult,
  ShipperDetail,
  ShipperFilter,
  ShipperRow,
  ShipperSource,
  standing,
  WALLET_MAX_VND,
  WALLET_PARAMETER_LABEL,
  WalletParameters,
} from '../core/shippers.js';
import { formatRoute, Route } from '../core/routes.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Shipper" (list and detail) and "Hệ thống › Tham số hệ thống › Ví Shipper" (M03). It draws what the server said and
// sends one request per click: the page decides no right and no state (the buttons shown follow the state the server returned, and the
// server refuses again whatever is sent). Every node is created with createElement/textContent (no innerHTML). While a command runs its
// popup is locked, so it cannot be sent twice; after an unknown outcome only "Thử lại" (the same Idempotency-Key) is offered.

export interface ShipperHost {
  readonly source: ShipperSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly go: (route: Route) => void;
  readonly login: () => void;
  readonly home: () => void;
  /** Where popups are mounted (the page body by default). */
  readonly dialogHost?: HTMLElement;
}

const SEARCH_PAUSE_MS = 300;

function badge(label: string, tone: 'ok' | 'wait' | 'lock' | 'neutral'): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function maskedNumber(value: string): string {
  return value.length <= 4 ? value : `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}

/** The sentence for a command result that did not succeed (the dialog keeps it in its status area). */
function failureText(result: ShipperCommandResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Hồ sơ vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem trạng thái hiện tại.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

// ---- list ------------------------------------------------------------------------------------------------------------------

export class ShipperListView {
  readonly #search: HTMLInputElement;
  readonly #status: HTMLSelectElement;
  readonly #results: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #latest = 0;
  #page = 1;
  #disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShipperHost,
    initial: ShipperFilter = 'ALL',
  ) {
    this.#search = h('input', { id: 'shipper-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo họ tên, số điện thoại hoặc mã Shipper', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm Shipper', maxlength: '80' });
    this.#status = h('select', { id: 'shipper-status', class: 'select', 'aria-label': 'Trạng thái' }, ...SHIPPER_FILTERS.map((value) => h('option', { value }, SHIPPER_FILTER_LABEL[value])));
    this.#status.value = initial;
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#results = h('div', { class: 'results' });
    this.#search.addEventListener('input', () => {
      this.#page = 1;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.load(), SEARCH_PAUSE_MS);
    });
    this.#status.addEventListener('change', () => {
      this.#page = 1;
      void this.load();
    });
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'shipper-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'shipper-title' }, 'Shipper'), h('p', { class: 'lead lead-last' }, 'Hồ sơ, tài khoản ngân hàng và trạng thái nhận đơn của Shipper. Shipper tự đăng ký qua ứng dụng 11Ship; quản trị viên xét duyệt tại đây.'))),
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#status, refresh),
        this.#results,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#results.replaceChildren(this.#card({ panel: skeleton() }));
    const read = await this.host.source.list({ query: this.#search.value, status: SHIPPER_FILTERS.find((value) => value === this.#status.value) ?? 'ALL', page: this.#page });
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#results.replaceChildren(this.#card({ panel: notWiredPanel(read.reason) }));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#results.replaceChildren(this.#card({ panel: failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) }));
      return;
    }
    if (read.rows.length === 0) {
      const filtered = this.#search.value.trim() !== '' || this.#status.value !== 'ALL';
      this.#results.replaceChildren(this.#card({ panel: filtered ? emptyPanel('Không tìm thấy Shipper', 'Thử đổi từ khóa hoặc bộ lọc trạng thái.') : emptyPanel('Chưa có Shipper', 'Shipper xuất hiện ở đây sau khi đăng ký trong ứng dụng 11Ship.') }));
      return;
    }
    const pages = Math.max(1, Math.ceil(read.total / SHIPPER_PAGE_SIZE));
    this.#results.replaceChildren(h('div', {}, this.#card({ rows: read.rows.map((row) => this.#row(row)) }), this.#pager(read.total, pages)));
  }

  #card(body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
    const columns = ['Mã', 'Họ tên', 'Số điện thoại', 'Trạng thái', 'Ngân hàng', 'Nhận đơn', 'Phân loại', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Danh sách Shipper'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #row(row: ShipperRow): HTMLElement {
    const state = standing(row.status, row.reviewState);
    const route: Route = { name: 'shipper', id: row.id };
    const open = h('a', { href: formatRoute(route), class: 'table-link table-action', 'aria-label': `Xem Shipper ${row.fullName}` }, 'Xem');
    open.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.host.go(route);
      }
    });
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Mã' }, row.code),
      h('td', { 'data-label': 'Họ tên', class: 'cell-name' }, row.fullName),
      h('td', { 'data-label': 'Số điện thoại' }, row.phone),
      h('td', { 'data-label': 'Trạng thái' }, badge(state.label, state.tone)),
      h('td', { 'data-label': 'Ngân hàng' }, row.bankState === null ? 'Chưa có' : `${row.bankName ?? ''} · ${BANK_STATE_LABEL[row.bankState]}`),
      h('td', { 'data-label': 'Nhận đơn' }, row.accepting ? badge('Đang bật', 'ok') : badge('Đang tắt', 'neutral')),
      h('td', { 'data-label': 'Phân loại' }, row.driverType),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  #pager(total: number, pages: number): HTMLElement {
    const from = (this.#page - 1) * SHIPPER_PAGE_SIZE + 1;
    const to = Math.min(this.#page * SHIPPER_PAGE_SIZE, total);
    const previous = secondary('Trước');
    previous.disabled = this.#page <= 1;
    previous.addEventListener('click', () => {
      this.#page -= 1;
      void this.load();
    });
    const next = secondary('Sau');
    next.disabled = this.#page >= pages;
    next.addEventListener('click', () => {
      this.#page += 1;
      void this.load();
    });
    return h(
      'nav',
      { class: 'pager', 'aria-label': 'Phân trang' },
      h('p', { class: 'pager-text', id: 'shipper-count' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} Shipper`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(this.#page)}/${String(pages)}`), next),
    );
  }
}

// ---- detail ----------------------------------------------------------------------------------------------------------------

interface CommandSpec {
  readonly name: ShipperCommandName;
  readonly title: string;
  readonly text: string;
  readonly confirm: string;
  readonly danger?: boolean;
  /** The reason is required (reject, lock, ...). */
  readonly reason?: boolean;
  readonly driverType?: DriverType;
}

export class ShipperDetailView {
  readonly #body: HTMLElement;
  readonly #notice: HTMLElement;
  #handle: DialogHandle | undefined;
  #latest = 0;
  #disposed = false;
  #shipper: ShipperDetail | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShipperHost,
    private readonly id: string,
  ) {
    this.#body = h('div', { class: 'detail' });
    this.#notice = message('notice', 'shipper-notice');
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'shipper-detail-title' }, this.#notice, this.#body));
  }

  dispose(): void {
    this.#disposed = true;
    this.#handle?.close();
    this.#handle = undefined;
  }

  async load(notice?: string): Promise<void> {
    const token = ++this.#latest;
    this.#body.replaceChildren(skeleton(4));
    const read = await this.host.source.detail(this.id);
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    setMessage(this.#notice, notice);
    switch (read.kind) {
      case 'not-wired':
        this.#body.replaceChildren(notWiredPanel(read.reason));
        return;
      case 'not-found':
        this.#body.replaceChildren(this.#back(), emptyPanel('Không tìm thấy Shipper', 'Shipper này không tồn tại hoặc bạn không có quyền xem.'));
        return;
      case 'failed':
        if (read.failure === 'session-expired') {
          this.host.onSessionLost();
        } else if (read.failure === 'forbidden') {
          this.host.onForbidden();
        }
        this.#body.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
        return;
      case 'ready':
        this.#shipper = read.shipper;
        this.#body.replaceChildren(...this.#detail(read.shipper));
    }
  }

  #back(): HTMLElement {
    const route: Route = { name: 'shippers' };
    const link = h('a', { href: formatRoute(route), class: 'table-link' }, icon('arrow-left', 16), 'Danh sách Shipper');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      this.host.go(route);
    });
    return link;
  }

  #detail(s: ShipperDetail): HTMLElement[] {
    const state = standing(s.status, s.reviewState);
    const actions = this.#actions(s);
    const blocks: HTMLElement[] = [
      this.#back(),
      h(
        'header',
        { class: 'page-head' },
        h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'shipper-detail-title' }, s.fullName), h('p', { class: 'lead lead-last' }, `Mã ${s.code} · ${s.phone}`)),
        h('div', { class: 'detail-status' }, badge(state.label, state.tone)),
      ),
    ];
    if (actions.length > 0) {
      blocks.push(h('div', { class: 'detail-actions' }, ...actions));
    }
    if (s.status === 'PENDING' && s.reviewState === 'REJECTED' && s.rejectionReason !== null) {
      blocks.push(h('p', { class: 'message message-warning' }, `Đã từ chối: ${s.rejectionReason}`));
    }
    if (s.status === 'SUSPENDED' && s.suspensionReason !== null) {
      blocks.push(h('p', { class: 'message message-warning' }, `Đang tạm khóa: ${s.suspensionReason}`));
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Hồ sơ'),
        definition([
          ['Họ tên', s.fullName],
          ['Số điện thoại (từ tài khoản M01)', s.phone],
          ['Biển số xe', s.plate ?? 'Chưa có'],
          ['Gửi hồ sơ lúc', s.submittedAt === null ? 'Chưa gửi' : formatDateTime(s.submittedAt)],
          ['Tạo lúc', formatDateTime(s.createdAt)],
        ]),
      ),
      this.#bankBlock(s),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Trạng thái nhận đơn'),
        definition([
          ['Nhận đơn', s.accepting ? 'Đang bật' : 'Đang tắt'],
          ['Đủ điều kiện bật', s.canAccept ? 'Có' : 'Chưa'],
        ]),
        s.blocks.length === 0
          ? undefined
          : h('ul', { class: 'hint-list' }, ...s.blocks.map((block) => h('li', {}, READINESS_LABEL[block] ?? block))),
        h('p', { class: 'hint' }, 'Điều kiện: hồ sơ đã duyệt, ngân hàng đã xác minh, ví đủ điều kiện (module Ví M04). Tắt nhận đơn không hủy đơn đã nhận.'),
      ),
      this.#classificationBlock(s),
    );
    if (s.status === 'CLOSING') {
      blocks.push(
        h(
          'section',
          { class: 'detail-block' },
          h('h3', { class: 'subtitle' }, 'Yêu cầu ngừng hoạt động'),
          definition([
            ['Gửi lúc', s.closureRequestedAt === null ? '—' : formatDateTime(s.closureRequestedAt)],
            ['Ghi chú của Shipper', s.closureNote ?? 'Không có'],
          ]),
          h('p', { class: 'hint' }, 'Shipper đã ngừng nhận đơn mới. Đơn đang giao phải hoàn tất và ví phải được tất toán trước khi hoàn tất. Số dư ví không bị mất.'),
        ),
      );
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Lịch sử thao tác'),
        s.history.length === 0
          ? h('p', { class: 'empty' }, 'Chưa có thao tác nào.')
          : h(
              'ol',
              { class: 'timeline' },
              ...s.history.map((event) =>
                h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h(
                    'div',
                    {},
                    h('p', { class: 'timeline-label' }, EVENT_LABEL[event.type] ?? event.type),
                    h('p', { class: 'timeline-meta' }, `${formatDateTime(event.createdAt)} · ${event.actor === 'DRIVER' ? 'Shipper' : event.actor === 'ADMIN' ? 'Quản trị viên' : 'Hệ thống'}`),
                    event.reason === null ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${event.reason}`),
                  ),
                ),
              ),
            ),
      ),
    );
    return blocks;
  }

  #bankBlock(s: ShipperDetail): HTMLElement {
    const bank = s.bank;
    if (bank === null) {
      return h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Tài khoản ngân hàng'), h('p', { class: 'empty' }, 'Shipper chưa khai báo tài khoản ngân hàng.'));
    }
    const buttons: HTMLElement[] = [];
    if (s.status !== 'CLOSED') {
      if (bank.state !== 'VERIFIED') {
        buttons.push(this.#button('Xác minh ngân hàng', { name: 'bank/verify', title: 'Xác minh tài khoản ngân hàng', text: `Xác nhận tài khoản ${bank.bankName} của ${bank.accountHolder} là chính chủ Shipper và đúng thông tin.`, confirm: 'Xác minh' }, true));
      }
      if (bank.state !== 'REJECTED') {
        buttons.push(this.#button('Từ chối ngân hàng', { name: 'bank/reject', title: 'Từ chối tài khoản ngân hàng', text: 'Shipper sẽ thấy lý do và phải nhập lại thông tin ngân hàng. Nhận đơn bị tắt cho đến khi xác minh lại.', confirm: 'Từ chối', danger: true, reason: true }, false));
      }
    }
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Tài khoản ngân hàng'),
      definition([
        ['Ngân hàng', bank.bankName],
        ['Số tài khoản', maskedNumber(bank.accountNumber)],
        ['Tên chủ tài khoản', bank.accountHolder],
        ['Xác minh', badge(BANK_STATE_LABEL[bank.state], bank.state === 'VERIFIED' ? 'ok' : bank.state === 'REJECTED' ? 'lock' : 'wait')],
        ...(bank.rejectionReason === null ? [] : ([['Lý do từ chối', bank.rejectionReason]] as const)),
      ]),
      h('p', { class: 'hint' }, 'Tên chủ tài khoản phải khớp họ tên Shipper. Đổi ngân hàng đưa trạng thái về “Chờ xác minh”.'),
      buttons.length === 0 ? undefined : h('div', { class: 'detail-actions' }, ...buttons),
    );
  }

  #classificationBlock(s: ShipperDetail): HTMLElement {
    const other: DriverType = s.driverType === 'EXTERNAL' ? 'PLATFORM' : 'EXTERNAL';
    const change = this.#button(`Chuyển sang ${other}`, {
      name: 'classification',
      title: 'Đổi phân loại nội bộ',
      text: `Phân loại hiện tại: ${s.driverType}. Chuyển sang ${other}? Phân loại chỉ hiển thị trên Web Admin, không trao quyền quản trị và không hiện cho Shipper, quán hay khách.`,
      confirm: 'Đổi phân loại',
      driverType: other,
    }, false);
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Phân loại nội bộ'),
      definition([['Phân loại', DRIVER_TYPE_LABEL[s.driverType]]]),
      h('p', { class: 'hint' }, 'Chỉ hiển thị trên Web Admin. Không có trong ứng dụng hay API công khai. PLATFORM không cấp quyền quản trị.'),
      s.status === 'CLOSED' ? undefined : h('div', { class: 'detail-actions' }, change),
    );
  }

  #actions(s: ShipperDetail): HTMLElement[] {
    const actions: HTMLElement[] = [];
    if (s.status === 'PENDING' && s.reviewState === 'SUBMITTED') {
      actions.push(
        this.#button('Duyệt hồ sơ', { name: 'approve', title: 'Duyệt hồ sơ Shipper', text: `Duyệt hồ sơ của ${s.fullName}? Shipper chuyển sang “Đã duyệt”. Nhận đơn vẫn chỉ bật được khi ngân hàng đã xác minh và ví đủ điều kiện.`, confirm: 'Duyệt' }, true),
        this.#button('Từ chối', { name: 'reject', title: 'Từ chối hồ sơ Shipper', text: 'Shipper sẽ thấy lý do, được sửa và gửi lại hồ sơ.', confirm: 'Từ chối', danger: true, reason: true }, false),
      );
    }
    if (s.status === 'ACTIVE') {
      actions.push(this.#button('Khóa hoạt động', { name: 'lock', title: 'Khóa hoạt động Shipper', text: 'Shipper ngừng nhận đơn mới ngay. Đơn đã nhận và số dư ví không bị ảnh hưởng.', confirm: 'Khóa', danger: true, reason: true }, false));
    }
    if (s.status === 'SUSPENDED') {
      actions.push(this.#button('Mở lại hoạt động', { name: 'unlock', title: 'Mở lại hoạt động', text: 'Chỉ mở lại khi ngân hàng đã được xác minh. Nhận đơn vẫn tắt cho đến khi Shipper tự bật.', confirm: 'Mở lại' }, true));
    }
    if (s.status === 'CLOSING') {
      actions.push(
        this.#button('Hoàn tất ngừng hoạt động', { name: 'closure/finalize', title: 'Hoàn tất ngừng hoạt động', text: 'Chỉ hoàn tất khi không còn đơn đang giao và ví đã tất toán. Máy chủ kiểm tra lại điều kiện; số dư không bị mất.', confirm: 'Hoàn tất', danger: true }, false),
        this.#button('Từ chối yêu cầu', { name: 'closure/reject', title: 'Từ chối yêu cầu ngừng hoạt động', text: 'Shipper quay lại trạng thái hoạt động với nhận đơn đang tắt.', confirm: 'Từ chối yêu cầu', reason: true }, true),
      );
    }
    return actions;
  }

  #button(label: string, spec: CommandSpec, primaryKind: boolean): HTMLElement {
    const button = primaryKind ? primary(label, 'button') : secondary(label);
    button.classList.add('btn-inline');
    button.addEventListener('click', () => this.#ask(spec));
    return button;
  }

  /** The confirmation popup of one command. One request in flight; an unknown outcome offers only the same request again. */
  #ask(spec: CommandSpec): void {
    const shipper = this.#shipper;
    if (shipper === undefined) {
      return;
    }
    let intent: ShipperCommandRequest | undefined;
    const reasonInput = h('textarea', { id: 'shipper-reason', class: 'textarea', rows: '3', maxlength: String(REASON_MAX), 'aria-describedby': 'shipper-reason-error', 'aria-label': 'Lý do' });
    const reasonError = message('error', 'shipper-reason-error');
    const status = message('error', 'shipper-command-status');
    const cancel = secondary('Hủy');
    const confirm = spec.danger === true ? h('button', { type: 'button', class: 'btn btn-danger-solid' }, spec.confirm) : primary(spec.confirm, 'button');
    let again = false;
    const lock = (working: boolean): void => {
      reasonInput.disabled = working || again;
      cancel.disabled = working || again;
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
    };
    const finish = async (): Promise<void> => {
      if (intent === undefined) {
        const reason = reasonInput.value.normalize('NFC').replace(/\s+/gu, ' ').trim();
        if (spec.reason === true && (reason === '' || [...reason].length > REASON_MAX)) {
          setMessage(reasonError, reason === '' ? 'Lý do là bắt buộc.' : `Lý do tối đa ${String(REASON_MAX)} ký tự.`);
          reasonInput.focus();
          return;
        }
        setMessage(reasonError, undefined);
        intent = {
          id: shipper.id,
          name: spec.name,
          version: shipper.version,
          ...(spec.reason === true ? { reason } : {}),
          ...(spec.driverType === undefined ? {} : { driverType: spec.driverType }),
          key: this.host.newKey(),
        };
      }
      lock(true);
      confirm.textContent = 'Đang gửi…';
      const result = await this.host.source.command(intent);
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#handle?.close();
        this.#handle = undefined;
        await this.load('Đã cập nhật.');
        return;
      }
      if (result.kind === 'session-expired') {
        this.host.onSessionLost();
        return;
      }
      if (result.kind === 'forbidden') {
        this.host.onForbidden();
      }
      again = result.kind === 'unknown';
      confirm.textContent = again ? 'Thử lại' : result.kind === 'conflict' ? 'Tải lại' : spec.confirm;
      if (result.kind === 'conflict') {
        intent = undefined;
        confirm.onclick = () => {
          this.#handle?.close();
          this.#handle = undefined;
          void this.load();
        };
      }
      lock(false);
      status.className = `message message-${again || result.kind === 'conflict' ? 'warning' : 'error'}`;
      setMessage(status, failureText(result));
    };
    confirm.addEventListener('click', () => void finish());
    cancel.addEventListener('click', () => {
      this.#handle?.close();
      this.#handle = undefined;
    });
    this.#handle?.close();
    this.#handle = openDialog({
      host: this.host.dialogHost,
      title: spec.title,
      onDismiss: () => {
        if (!again) {
          this.#handle?.close();
          this.#handle = undefined;
        }
      },
      body: [
        h('p', { class: `dialog-warning dialog-warning-${spec.danger === true ? 'danger' : 'info'}`, role: 'note' }, icon(spec.danger === true ? 'alert' : 'info', 18), h('span', {}, spec.text)),
        ...(spec.reason === true ? [h('div', { class: 'field' }, h('label', { for: 'shipper-reason', class: 'label' }, 'Lý do (bắt buộc)'), reasonInput, reasonError)] : []),
        status,
      ],
      actions: [cancel, confirm],
    });
  }
}

// ---- wallet parameters -----------------------------------------------------------------------------------------------------

export class WalletParametersView {
  readonly #body: HTMLElement;
  #latest = 0;
  #disposed = false;
  /** The unanswered save, kept so "Thử lại" sends exactly the same request. */
  #pending: { readonly version: number; readonly topup: number; readonly withdraw: number; readonly key: string } | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShipperHost,
  ) {
    this.#body = h('div', { class: 'detail' });
    root.replaceChildren(
      h(
        'section',
        { class: 'content', 'aria-labelledby': 'wallet-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'wallet-title' }, 'Ví Shipper'), h('p', { class: 'lead lead-last' }, 'Cài đặt › Tham số hệ thống. Số tiền tối thiểu mỗi yêu cầu nạp và rút. Thay đổi chỉ áp dụng cho yêu cầu mới.'))),
        this.#body,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#pending = undefined;
    this.#body.replaceChildren(skeleton(3));
    const read = await this.host.source.walletParameters();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason || NOT_WIRED_SHIPPERS_REASON));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#body.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#body.replaceChildren(this.#form(read.parameters));
  }

  #form(p: WalletParameters): HTMLElement {
    const topup = h('input', { id: 'wallet-topup', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'wallet-topup-error' });
    const withdraw = h('input', { id: 'wallet-withdraw', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'wallet-withdraw-error' });
    topup.value = String(p.topupMinVnd);
    withdraw.value = String(p.withdrawMinVnd);
    const topupError = message('error', 'wallet-topup-error');
    const withdrawError = message('error', 'wallet-withdraw-error');
    const status = message('error', 'wallet-status');
    const save = primary('Lưu', 'button');
    const cancel = secondary('Hủy thay đổi');
    const send = async (): Promise<void> => {
      let pending = this.#pending;
      if (pending === undefined) {
        const top = parseVnd(topup.value);
        const out = parseVnd(withdraw.value);
        setMessage(topupError, top === undefined ? `Nhập số nguyên VND dương, tối đa ${formatVnd(WALLET_MAX_VND)}.` : undefined);
        setMessage(withdrawError, out === undefined ? `Nhập số nguyên VND dương, tối đa ${formatVnd(WALLET_MAX_VND)}.` : undefined);
        if (top === undefined || out === undefined) {
          return;
        }
        if (top === p.topupMinVnd && out === p.withdrawMinVnd) {
          setMessage(status, 'Chưa có thay đổi nào để lưu.');
          return;
        }
        pending = { version: p.version, topup: top, withdraw: out, key: this.host.newKey() };
        this.#pending = pending;
      }
      save.disabled = true;
      save.textContent = 'Đang lưu…';
      const result = await this.host.source.saveWalletParameters({ version: pending.version, topupMinVnd: pending.topup, withdrawMinVnd: pending.withdraw, key: pending.key });
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#pending = undefined;
        await this.load();
        return;
      }
      if (result.kind === 'session-expired') {
        this.host.onSessionLost();
        return;
      }
      if (result.kind === 'forbidden') {
        this.host.onForbidden();
      }
      if (result.kind !== 'unknown') {
        this.#pending = undefined;
      }
      save.disabled = false;
      save.textContent = result.kind === 'unknown' ? 'Thử lại' : result.kind === 'conflict' ? 'Tải lại' : 'Lưu';
      if (result.kind === 'conflict') {
        save.onclick = () => void this.load();
      }
      status.className = `message message-${result.kind === 'unknown' || result.kind === 'conflict' ? 'warning' : 'error'}`;
      setMessage(status, result.kind === 'conflict' ? 'Tham số đã được thay đổi ở nơi khác. Hãy tải lại để xem giá trị hiện tại.' : failureText(result));
    };
    save.addEventListener('click', () => void send());
    cancel.addEventListener('click', () => void this.load());
    return h(
      'div',
      { class: 'detail' },
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Số tiền tối thiểu mỗi yêu cầu'),
        h('div', { class: 'field' }, h('label', { for: 'wallet-topup', class: 'label' }, `${WALLET_PARAMETER_LABEL.topup_min_vnd} (VND)`), h('div', { class: 'input-wrap' }, topup), topupError),
        h('div', { class: 'field' }, h('label', { for: 'wallet-withdraw', class: 'label' }, `${WALLET_PARAMETER_LABEL.withdraw_min_vnd} (VND)`), h('div', { class: 'input-wrap' }, withdraw), withdrawError),
        h('p', { class: 'hint' }, 'Chỉ nhận số nguyên VND dương. Áp dụng cho yêu cầu nạp/rút mới, không sửa giao dịch đã xảy ra. Đây không phải số dư tối thiểu để nhận đơn (quy tắc của module Ví M04).'),
        status,
        h('div', { class: 'detail-actions' }, save, cancel),
        h('p', { class: 'hint' }, p.updatedAt === null ? 'Đang dùng giá trị mặc định.' : `Cập nhật lần cuối: ${formatDateTime(p.updatedAt)}`),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Lịch sử chỉnh sửa'),
        p.history.length === 0
          ? h('p', { class: 'empty' }, 'Chưa có chỉnh sửa nào.')
          : h(
              'ol',
              { class: 'timeline' },
              ...p.history.map((change) =>
                h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h(
                    'div',
                    {},
                    h('p', { class: 'timeline-label' }, `${WALLET_PARAMETER_LABEL[change.key]}: ${formatVnd(change.oldValue)} → ${formatVnd(change.newValue)}`),
                    h('p', { class: 'timeline-meta' }, `${formatDateTime(change.changedAt)} · Tài khoản ${change.changedBy}`),
                  ),
                ),
              ),
            ),
      ),
    );
  }
}
