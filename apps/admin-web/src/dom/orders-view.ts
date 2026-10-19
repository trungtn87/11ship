import {
  FEE_UNKNOWN_TEXT,
  formatVnd,
  ORDER_ACTIONS,
  ORDER_PAGE_SIZE,
  ORDER_REASON_MAX,
  ORDER_REFUSAL_MESSAGE,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  OrderActionName,
  OrderActionRequest,
  OrderActionResult,
  OrderDetail,
  OrderRow,
  OrderSource,
  OrderStatusFilter,
  DISPLAY_LABEL,
} from '../core/orders.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Đơn hàng" (M10.05): the list of food Orders with filters, a detail drawer (dishes with the shop's edits, amounts, the calls for a
// Shipper, the timeline) and the two exception actions. It draws what the server said and sends one request per click; the buttons follow the `can`
// list the server returned for this Admin and this Order. There is no free status field. While an action runs its popup is locked, so it cannot be
// sent twice; after an unknown outcome only "Thử lại" (the same Idempotency-Key) is offered. Popups close with "Quay lại", never a bare "Hủy".

export interface OrderHost {
  readonly source: OrderSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly dialogHost?: HTMLElement;
}

const SEARCH_PAUSE_MS = 300;

function badge(label: string, tone: 'ok' | 'wait' | 'lock' | 'neutral'): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function statusBadge(row: { readonly status: OrderRow['status']; readonly display: string }): HTMLElement {
  const label = DISPLAY_LABEL[row.display] ?? ORDER_STATUS_LABEL[row.status];
  switch (row.status) {
    case 'COMPLETED':
      return badge(label, 'ok');
    case 'NOT_COMPLETED':
      return badge(label, 'lock');
    case 'PENDING_CONFIRMATION':
    case 'PREPARING':
      return badge(label, 'wait');
    default:
      return badge(label, 'neutral');
  }
}

const ACTION_LABEL: Record<OrderActionName, string> = {
  'cancel-order': 'Hủy đơn món',
  'close-not-completed': 'Đóng "Không hoàn tất"',
};

const ACTION_TEXT: Record<OrderActionName, string> = {
  'cancel-order': 'Hủy đơn món khi chưa lấy hàng: kết thúc lần giao đang chạy trước khi lấy và giải phóng hoa hồng. Không dùng được sau khi shipper đã lấy hàng.',
  'close-not-completed': 'Đóng đơn là "Không hoàn tất" khi giao thất bại và hàng đã về quán hoặc đã được xử lý. Không tự bồi thường hay hoàn tiền.',
};

function failureText(result: OrderActionResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Đơn vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem trạng thái hiện tại.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return ORDER_REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

const money = (value: number | null): string => (value === null ? FEE_UNKNOWN_TEXT : formatVnd(value));

export class OrderListView {
  readonly #search: HTMLInputElement;
  readonly #status: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #shop: HTMLInputElement;
  readonly #results: HTMLElement;
  readonly #drawer: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #latest = 0;
  #page = 1;
  #disposed = false;
  #openId: string | undefined;
  #handle: DialogHandle | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: OrderHost,
  ) {
    this.#search = h('input', { id: 'order-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo mã đơn hoặc người nhận', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm đơn', maxlength: '40' });
    const statuses: OrderStatusFilter[] = ['ALL', ...ORDER_STATUSES];
    this.#status = h('select', { id: 'order-status', class: 'select', 'aria-label': 'Trạng thái' }, ...statuses.map((value) => h('option', { value }, ORDER_STATUS_LABEL[value])));
    this.#from = h('input', { id: 'order-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'order-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#shop = h('input', { id: 'order-shop', type: 'search', class: 'search-input', placeholder: 'Quán', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Quán', maxlength: '80' });
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#results = h('div', { class: 'results' });
    this.#drawer = h('aside', { class: 'drawer', id: 'order-drawer', 'aria-label': 'Chi tiết đơn hàng', hidden: true });
    const typed = (): void => {
      this.#page = 1;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.load(), SEARCH_PAUSE_MS);
    };
    for (const input of [this.#search, this.#shop]) {
      input.addEventListener('input', typed);
    }
    for (const control of [this.#status, this.#from, this.#to]) {
      control.addEventListener('change', () => {
        this.#page = 1;
        void this.load();
      });
    }
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'order-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'order-title' }, 'Đơn hàng'), h('p', { class: 'lead lead-last' }, 'Đơn món của khách tại các quán: theo dõi, xem diễn biến và xử lý ngoại lệ đúng quyền. Khách và quán thao tác trong 11Food; Admin không đổi trạng thái tùy ý.'))),
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#status, refresh),
        h('div', { class: 'toolbar toolbar-filters' }, this.#from, this.#to, this.#shop),
        this.#results,
        this.#drawer,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#handle?.close();
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#results.replaceChildren(this.#card({ panel: skeleton() }));
    const read = await this.host.source.list({
      query: this.#search.value,
      status: ORDER_STATUSES.find((value) => value === this.#status.value) ?? 'ALL',
      shop: this.#shop.value,
      from: this.#from.value,
      to: this.#to.value,
      page: this.#page,
    });
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
      const filtered = [this.#search.value, this.#shop.value, this.#from.value, this.#to.value].some((value) => value.trim() !== '') || this.#status.value !== 'ALL';
      this.#results.replaceChildren(this.#card({ panel: filtered ? emptyPanel('Không tìm thấy đơn hàng', 'Thử đổi từ khóa hoặc bộ lọc.') : emptyPanel('Chưa có đơn hàng', 'Đơn xuất hiện ở đây khi khách đặt món trong ứng dụng 11Food.') }));
      return;
    }
    const pages = Math.max(1, Math.ceil(read.total / ORDER_PAGE_SIZE));
    this.#results.replaceChildren(h('div', {}, this.#card({ rows: read.rows.map((row) => this.#row(row)) }), this.#pager(read.total, pages)));
  }

  #card(body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
    const columns = ['Mã', 'Quán', 'Người nhận', 'Trạng thái', 'Tiền món', 'Tạo lúc', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Danh sách đơn hàng'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #row(row: OrderRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem đơn ${row.code}` }, 'Xem');
    open.addEventListener('click', () => void this.#open(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Mã' }, row.code),
      h('td', { 'data-label': 'Quán', class: 'cell-name' }, row.shopName),
      h('td', { 'data-label': 'Người nhận' }, row.recipientName),
      h('td', { 'data-label': 'Trạng thái' }, statusBadge(row), row.edited ? badge('Quán đã sửa', 'neutral') : undefined, row.needsAttention ? badge('Cần xử lý', 'lock') : undefined),
      h('td', { 'data-label': 'Tiền món' }, formatVnd(row.itemsVnd)),
      h('td', { 'data-label': 'Tạo lúc' }, formatDateTime(row.createdAt)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  #pager(total: number, pages: number): HTMLElement {
    const from = (this.#page - 1) * ORDER_PAGE_SIZE + 1;
    const to = Math.min(this.#page * ORDER_PAGE_SIZE, total);
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
      h('p', { class: 'pager-text', id: 'order-count' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} đơn`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(this.#page)}/${String(pages)}`), next),
    );
  }

  async #open(id: string, note?: string): Promise<void> {
    this.#openId = id;
    this.#drawer.hidden = false;
    this.#drawer.replaceChildren(skeleton(3));
    const read = await this.host.source.detail(id);
    if (this.#disposed || this.#openId !== id) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#drawer.replaceChildren(notWiredPanel(read.reason));
      return;
    }
    if (read.kind === 'not-found') {
      this.#drawer.replaceChildren(this.#closeBar('Đơn hàng'), emptyPanel('Không tìm thấy', 'Đơn này không còn hoặc bạn không có quyền xem.'));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#drawer.replaceChildren(this.#closeBar('Đơn hàng'), failurePanel(read.failure, { retry: () => void this.#open(id), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#drawer.replaceChildren(...this.#detail(read.order, note));
    this.#drawer.focus();
  }

  #closeBar(title: string): HTMLElement {
    const close = secondary('Đóng');
    close.classList.add('btn-inline');
    close.addEventListener('click', () => {
      this.#openId = undefined;
      this.#drawer.hidden = true;
      this.#drawer.replaceChildren();
    });
    return h('header', { class: 'drawer-head' }, h('h2', { class: 'subtitle' }, title), close);
  }

  #detail(d: OrderDetail, note?: string): HTMLElement[] {
    const blocks: HTMLElement[] = [this.#closeBar(`Đơn ${d.code}`)];
    if (note !== undefined) {
      blocks.push(h('p', { class: 'notice', role: 'status' }, note));
    }
    const remaining = Math.max(0, d.itemsVnd - d.paidVnd);
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Tóm tắt'),
        definition([
          ['Trạng thái', statusBadge(d)],
          ['Quán', d.shopName],
          ['Hẹn nhận', d.scheduledFor === null ? 'Càng sớm càng tốt' : formatDateTime(d.scheduledFor)],
          ['Tạo lúc', formatDateTime(d.createdAt)],
          ...(d.endReason === null ? [] : ([['Kết thúc bởi', `${d.endActor ?? '—'}: ${d.endReason}`]] as const)),
        ]),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Người nhận'),
        definition([
          ['Tên', d.recipientName],
          ['Điện thoại', d.recipientPhone],
          ['Địa chỉ', d.recipientAddress],
          ['Ghi chú', d.note ?? '—'],
        ]),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Món'),
        h(
          'ul',
          { class: 'plain-list' },
          ...d.lines.map((line) =>
            h(
              'li',
              {},
              `${line.removed ? '(đã bỏ) ' : ''}${String(line.quantity)} × ${line.name} — ${formatVnd(line.unitPriceVnd)}${line.note === null ? '' : ` · ${line.note}`}${line.original === null ? '' : ` · khách đặt ${String(line.original.quantity)} × ${formatVnd(line.original.unitPriceVnd)}`}`,
            ),
          ),
        ),
        d.changeReason === null ? undefined : h('p', { class: 'hint' }, `Quán sửa đơn — lý do: ${d.changeReason}`),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Tiền'),
        definition([
          ['Tiền món (khách đặt)', formatVnd(d.originalItemsVnd)],
          ['Tiền món (hiện tại)', formatVnd(d.itemsVnd)],
          ['Khách đã trả', formatVnd(d.paidVnd)],
          ['Còn phải thu', formatVnd(remaining)],
          ['Phí giao', money(d.fee.amountVnd)],
          ['Người trả phí', d.fee.payer === 'CUSTOMER' ? 'Khách' : 'Quán'],
        ]),
        h('p', { class: 'hint' }, 'Thanh toán trực tiếp giữa các bên, không đi qua ví 11Ship.'),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Các lần gọi shipper'),
        d.calls.length === 0
          ? h('p', { class: 'empty' }, 'Quán chưa gọi shipper.')
          : h(
              'ol',
              { class: 'timeline' },
              ...d.calls.map((call) =>
                h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h('div', {}, h('p', { class: 'timeline-label' }, `${call.code} · ${call.state}`), h('p', { class: 'timeline-meta' }, `Tạo ${formatDateTime(call.createdAt)}${call.endedAt === null ? '' : ` · kết thúc ${formatDateTime(call.endedAt)}`}`), call.endReason === null ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${call.endReason}`)),
                ),
              ),
            ),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Diễn biến'),
        d.timeline.length === 0
          ? h('p', { class: 'empty' }, 'Chưa có sự kiện nào.')
          : h(
              'ol',
              { class: 'timeline' },
              ...d.timeline.map((event) =>
                h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h('div', {}, h('p', { class: 'timeline-label' }, event.type), h('p', { class: 'timeline-meta' }, `${formatDateTime(event.at)} · ${event.actor}`), event.note === null ? undefined : h('p', { class: 'timeline-reason' }, event.note)),
                ),
              ),
            ),
      ),
    );
    const actions = ORDER_ACTIONS.filter((name) => d.can.has(name)).map((name) => {
      const button = secondary(ACTION_LABEL[name]);
      button.classList.add('btn-inline');
      button.addEventListener('click', () => this.#ask(d, name));
      return button;
    });
    if (actions.length > 0) {
      blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Xử lý ngoại lệ'), h('div', { class: 'detail-actions' }, ...actions)));
    }
    return blocks;
  }

  #ask(d: OrderDetail, name: OrderActionName): void {
    let intent: OrderActionRequest | undefined;
    const reasonInput = h('textarea', { id: 'order-reason', class: 'textarea', rows: '3', maxlength: String(ORDER_REASON_MAX), 'aria-describedby': 'order-reason-error', 'aria-label': 'Lý do' });
    const reasonError = message('error', 'order-reason-error');
    const status = message('error', 'order-action-status');
    const back = secondary('Quay lại');
    const confirm = primary(ACTION_LABEL[name], 'button');
    let again = false;
    const lock = (working: boolean): void => {
      reasonInput.disabled = working || again;
      back.disabled = working || again;
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
    };
    const finish = async (): Promise<void> => {
      if (intent === undefined) {
        const reason = reasonInput.value.normalize('NFC').replace(/\s+/gu, ' ').trim();
        if (reason === '' || [...reason].length > ORDER_REASON_MAX) {
          setMessage(reasonError, reason === '' ? 'Lý do là bắt buộc.' : `Lý do tối đa ${String(ORDER_REASON_MAX)} ký tự.`);
          reasonInput.focus();
          return;
        }
        setMessage(reasonError, undefined);
        intent = { id: d.id, name, version: d.version, reason, key: this.host.newKey() };
      }
      lock(true);
      confirm.textContent = 'Đang gửi…';
      const result = await this.host.source.action(intent);
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#handle?.close();
        this.#handle = undefined;
        await this.#open(d.id, 'Đã cập nhật.');
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
      setMessage(status, failureText(result));
      again = result.kind === 'unknown';
      lock(false);
      confirm.textContent = again ? 'Thử lại' : ACTION_LABEL[name];
      if (result.kind === 'conflict') {
        confirm.disabled = true;
        back.disabled = false;
      }
    };
    back.addEventListener('click', () => {
      this.#handle?.close();
      this.#handle = undefined;
    });
    confirm.addEventListener('click', () => void finish());
    this.#handle?.close();
    this.#handle = openDialog({
      title: ACTION_LABEL[name],
      description: ACTION_TEXT[name],
      body: [h('label', { class: 'field-label', for: 'order-reason' }, 'Lý do (bắt buộc, ghi vào nhật ký kiểm toán)'), reasonInput, reasonError, status],
      actions: [back, confirm],
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
  }
}
