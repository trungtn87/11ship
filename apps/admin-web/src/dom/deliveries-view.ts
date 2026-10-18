import {
  CUSTODY_LABEL,
  DELIVERY_GROUP_LABEL,
  DELIVERY_PAGE_SIZE,
  DELIVERY_REFUSAL_MESSAGE,
  DELIVERY_STATE_LABEL,
  DELIVERY_STATES,
  DeliveryActionName,
  DeliveryActionRequest,
  DeliveryActionResult,
  DeliveryCounters,
  DeliveryDetail,
  DeliveryGroup,
  DeliveryRow,
  DeliverySource,
  DeliveryStateFilter,
  FEE_UNKNOWN_TEXT,
  formatVnd,
  FRESHNESS_LABEL,
  GOODS_FILTER_LABEL,
  REASON_MAX,
} from '../core/deliveries.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Giao hàng" (M07.07): counters, filters, the list and a detail drawer with the timeline, the assignments, the goods
// custody and the few Admin actions. It draws what the server said and sends one request per click: the page decides no right and no state
// (the buttons follow the `can` list the server returned for this Admin and this delivery; the server refuses again whatever is sent).
// There is no free status field. Every node is created with createElement/textContent (no innerHTML). While an action runs its popup is
// locked, so it cannot be sent twice; after an unknown outcome only "Thử lại" (the same Idempotency-Key) is offered. Popups close with
// "Quay lại", never with a bare "Hủy".

export interface DeliveryHost {
  readonly source: DeliverySource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** Where popups are mounted (the page body by default). */
  readonly dialogHost?: HTMLElement;
  /** M12: the filter a link of the overview opened the page with. The page shows it and lets the administrator drop it. */
  readonly initial?: { readonly group?: DeliveryGroup; readonly state?: DeliveryStateFilter; readonly basis?: 'created' | 'ended'; readonly from?: string; readonly to?: string };
}

const SEARCH_PAUSE_MS = 300;

function badge(label: string, tone: 'ok' | 'wait' | 'lock' | 'neutral'): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function stateBadge(row: { readonly state: DeliveryRow['state']; readonly incidentOpen?: boolean }): HTMLElement {
  const label = DELIVERY_STATE_LABEL[row.state];
  switch (row.state) {
    case 'completed':
      return badge(label, 'ok');
    case 'failed':
    case 'search_stopped':
      return badge(label, 'lock');
    case 'cancelled_by_merchant':
      return badge(label, 'neutral');
    default:
      return badge(label, 'wait');
  }
}

const fee = (value: number | null): string => (value === null ? FEE_UNKNOWN_TEXT : formatVnd(value));

const ACTION_LABEL: Record<DeliveryActionName, string> = {
  'record-custody': 'Ghi nhận hàng',
  'adjust-after-pickup': 'Điều chỉnh sau lấy hàng',
  'refer-m11': 'Chuyển phản ánh (M11)',
  'release-assignment': 'Giải phóng shipper',
};

const ACTION_TEXT: Record<DeliveryActionName, string> = {
  'record-custody': 'Ghi nhận hàng đã về quán hoặc đã xử lý không giao tiếp. Đây là ghi nhận, không tự bồi thường hay hoàn tiền.',
  'adjust-after-pickup': 'Sửa phí hoặc địa chỉ mô tả sau khi shipper đã lấy hàng. Giá trị trước/sau được ghi vào nhật ký kiểm toán cùng lý do.',
  'refer-m11': 'Đánh dấu đã chuyển sang Phản ánh (M11). Hệ thống chỉ ghi dấu và nhật ký, không tạo phiếu khi M11 chưa sẵn sàng.',
  'release-assignment': 'Dùng khi tài khoản shipper bị khóa hoặc thiết bị hỏng và đơn chưa lấy hàng: kết thúc lần nhận, giải phóng hoa hồng, tìm shipper khác trong thời hạn còn lại. Không tự suy ra giao xong.',
};

/** The sentence for an action result that did not succeed. */
function failureText(result: DeliveryActionResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Yêu cầu giao vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem trạng thái hiện tại.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return DELIVERY_REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

export class DeliveryListView {
  readonly #search: HTMLInputElement;
  readonly #state: HTMLSelectElement;
  readonly #goods: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #shop: HTMLInputElement;
  readonly #shipper: HTMLInputElement;
  readonly #counters: HTMLElement;
  readonly #linked: HTMLElement;
  readonly #results: HTMLElement;
  readonly #drawer: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #latest = 0;
  #page = 1;
  #group: DeliveryGroup | undefined;
  #basis: 'created' | 'ended' = 'created';
  #disposed = false;
  #openId: string | undefined;
  #handle: DialogHandle | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: DeliveryHost,
  ) {
    this.#search = h('input', { id: 'delivery-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo mã giao hàng', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo mã', maxlength: '40' });
    const states: DeliveryStateFilter[] = ['ALL', ...DELIVERY_STATES];
    this.#state = h('select', { id: 'delivery-state', class: 'select', 'aria-label': 'Trạng thái' }, ...states.map((value) => h('option', { value }, DELIVERY_STATE_LABEL[value])));
    this.#goods = h('select', { id: 'delivery-goods', class: 'select', 'aria-label': 'Tình trạng hàng' }, ...(['ALL', 'OPEN', 'CLOSED'] as const).map((value) => h('option', { value }, GOODS_FILTER_LABEL[value])));
    this.#from = h('input', { id: 'delivery-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'delivery-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#shop = h('input', { id: 'delivery-shop', type: 'search', class: 'search-input', placeholder: 'Quán', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Quán', maxlength: '80' });
    this.#shipper = h('input', { id: 'delivery-shipper', type: 'search', class: 'search-input', placeholder: 'Shipper', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Shipper', maxlength: '80' });
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#counters = h('div', { class: 'counters', role: 'status', 'aria-label': 'Tổng quan giao hàng' });
    this.#linked = h('div', { class: 'notice linked-filter', role: 'status', hidden: true });
    this.#results = h('div', { class: 'results' });
    this.#drawer = h('aside', { class: 'drawer', id: 'delivery-drawer', 'aria-label': 'Chi tiết giao hàng', hidden: true });
    const reload = (): void => {
      this.#page = 1;
      void this.load();
    };
    const typed = (): void => {
      this.#page = 1;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.load(), SEARCH_PAUSE_MS);
    };
    for (const input of [this.#search, this.#shop, this.#shipper]) {
      input.addEventListener('input', typed);
    }
    for (const control of [this.#state, this.#goods, this.#from, this.#to]) {
      control.addEventListener('change', reload);
    }
    refresh.addEventListener('click', () => void this.load());
    const initial = host.initial;
    if (initial !== undefined) {
      this.#group = initial.group;
      this.#basis = initial.basis ?? 'created';
      this.#state.value = initial.state ?? 'ALL';
      this.#from.value = initial.from ?? '';
      this.#to.value = initial.to ?? '';
    }
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'delivery-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'delivery-title' }, 'Giao hàng'), h('p', { class: 'lead lead-last' }, 'Các yêu cầu gọi shipper của quán: theo dõi, xem diễn biến và xử lý ngoại lệ đúng quyền. Quán và shipper thao tác trong ứng dụng; Admin không đổi trạng thái tùy ý.'))),
        this.#counters,
        this.#linked,
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#state, this.#goods, refresh),
        h('div', { class: 'toolbar toolbar-filters' }, this.#from, this.#to, this.#shop, this.#shipper),
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
      state: DELIVERY_STATES.find((value) => value === this.#state.value) ?? 'ALL',
      goods: (['OPEN', 'CLOSED'] as const).find((value) => value === this.#goods.value) ?? 'ALL',
      from: this.#from.value,
      to: this.#to.value,
      shop: this.#shop.value,
      shipper: this.#shipper.value,
      page: this.#page,
      ...(this.#group === undefined ? {} : { group: this.#group }),
      ...(this.#basis === 'ended' ? { basis: 'ended' as const } : {}),
    });
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#counters.replaceChildren();
      this.#results.replaceChildren(this.#card({ panel: notWiredPanel(read.reason) }));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#counters.replaceChildren();
      this.#results.replaceChildren(this.#card({ panel: failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) }));
      return;
    }
    this.#renderCounters(read.counters);
    this.#renderLinked();
    if (read.rows.length === 0) {
      const filtered = [this.#search.value, this.#shop.value, this.#shipper.value, this.#from.value, this.#to.value].some((value) => value.trim() !== '') || this.#state.value !== 'ALL' || this.#goods.value !== 'ALL' || this.#group !== undefined;
      this.#results.replaceChildren(this.#card({ panel: filtered ? emptyPanel('Không tìm thấy yêu cầu giao', 'Thử đổi từ khóa hoặc bộ lọc.') : emptyPanel('Chưa có yêu cầu giao', 'Yêu cầu giao xuất hiện ở đây khi quán gọi shipper trong ứng dụng 11Food.') }));
      return;
    }
    const pages = Math.max(1, Math.ceil(read.total / DELIVERY_PAGE_SIZE));
    this.#results.replaceChildren(h('div', {}, this.#card({ rows: read.rows.map((row) => this.#row(row)) }), this.#pager(read.total, pages)));
  }

  /** The filter that came from the overview, in words, with a way to drop it. Gone as soon as the administrator drops it. */
  #renderLinked(): void {
    if (this.#group === undefined && this.#basis === 'created') {
      this.#linked.hidden = true;
      this.#linked.replaceChildren();
      return;
    }
    const drop = secondary('Bỏ lọc này');
    drop.classList.add('btn-inline');
    drop.addEventListener('click', () => {
      this.#group = undefined;
      this.#basis = 'created';
      this.#page = 1;
      void this.load();
    });
    const parts: string[] = [];
    if (this.#group !== undefined) {
      parts.push(DELIVERY_GROUP_LABEL[this.#group]);
    }
    if (this.#basis === 'ended') {
      parts.push('thời gian tính theo ngày kết thúc');
    }
    this.#linked.hidden = false;
    this.#linked.replaceChildren(h('span', {}, `Đang lọc từ Tổng quan: ${parts.join(', ')}.`), drop);
  }

  #renderCounters(counters: DeliveryCounters): void {
    const tile = (label: string, value: number, tone: string): HTMLElement => h('div', { class: `counter counter-${tone}` }, h('span', { class: 'counter-value' }, String(value)), h('span', { class: 'counter-label' }, label));
    this.#counters.replaceChildren(
      tile('Đang tìm', counters.searching, 'wait'),
      tile('Chờ lấy hàng', counters.waitingPickup, 'wait'),
      tile('Đang giao', counters.delivering, 'ok'),
      tile('Cần xử lý', counters.needsAttention, counters.needsAttention > 0 ? 'lock' : 'neutral'),
    );
  }

  #card(body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
    const columns = ['Mã', 'Quán', 'Shipper', 'Trạng thái', 'Tiền hàng', 'Phí giao', 'Cập nhật', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Danh sách giao hàng'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #row(row: DeliveryRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem giao hàng ${row.code}` }, 'Xem');
    open.addEventListener('click', () => void this.#open(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Mã' }, row.code),
      h('td', { 'data-label': 'Quán', class: 'cell-name' }, row.shopName),
      h('td', { 'data-label': 'Shipper' }, row.shipperName ?? '—'),
      h('td', { 'data-label': 'Trạng thái' }, stateBadge(row), row.incidentOpen ? badge('Cần xử lý hàng', 'lock') : undefined),
      h('td', { 'data-label': 'Tiền hàng' }, formatVnd(row.goodsValueVnd)),
      h('td', { 'data-label': 'Phí giao' }, fee(row.feeVnd)),
      h('td', { 'data-label': 'Cập nhật' }, formatDateTime(row.updatedAt)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  #pager(total: number, pages: number): HTMLElement {
    const from = (this.#page - 1) * DELIVERY_PAGE_SIZE + 1;
    const to = Math.min(this.#page * DELIVERY_PAGE_SIZE, total);
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
      h('p', { class: 'pager-text', id: 'delivery-count' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} yêu cầu giao`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(this.#page)}/${String(pages)}`), next),
    );
  }

  // ---- drawer ----------------------------------------------------------------------------------------------------------------

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
      this.#drawer.replaceChildren(this.#closeBar('Giao hàng'), emptyPanel('Không tìm thấy', 'Yêu cầu giao này không còn hoặc bạn không có quyền xem.'));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#drawer.replaceChildren(this.#closeBar('Giao hàng'), failurePanel(read.failure, { retry: () => void this.#open(id), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#drawer.replaceChildren(...this.#detail(read.delivery, note));
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

  #detail(d: DeliveryDetail, note?: string): HTMLElement[] {
    const blocks: HTMLElement[] = [this.#closeBar(`Giao hàng ${d.code}`)];
    if (note !== undefined) {
      blocks.push(h('p', { class: 'notice', role: 'status' }, note));
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Tóm tắt'),
        definition([
          ['Trạng thái', stateBadge(d)],
          ['Quán', d.shopName],
          ['Shipper', d.shipperName ?? '—'],
          ['Nguồn', d.source === 'ORDER' ? `Từ Order ${d.orderId ?? ''}`.trim() : 'Gọi trực tiếp (đơn ngoài app)'],
          ...(d.previousDeliveryId === null ? [] : ([['Gọi lại từ', d.previousDeliveryId]] as const)),
          ['Tìm shipper', `${formatDateTime(d.searchStartedAt)} → ${formatDateTime(d.searchExpiresAt)}`],
        ]),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Người nhận'),
        d.recipientPhone === null && d.recipientAddress === null
          ? h('p', { class: 'hint' }, 'Liên hệ người nhận bị ẩn: tài khoản này không có quyền xem.')
          : definition([
              ['Tên', d.recipientName ?? '—'],
              ['Điện thoại', d.recipientPhone ?? '—'],
              ['Địa chỉ', d.recipientAddress ?? '—'],
            ]),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Hàng và thanh toán'),
        definition([
          ['Hàng', d.goodsDescription],
          ['Giá trị hàng', formatVnd(d.goodsValueVnd)],
          ['Đã thanh toán', formatVnd(d.paidVnd)],
          ['Còn phải thu', formatVnd(d.goodsValueVnd - d.paidVnd)],
          ['Phí giao', fee(d.feeVnd)],
          ['Chế độ phí', d.feeMode],
          ['Người trả phí', d.feePayer === 'CUSTOMER' ? 'Khách' : 'Quán'],
        ]),
        h('p', { class: 'hint' }, 'Tiền hàng và phí giao do các bên giao nhận trực tiếp, không đi qua ví 11Ship.'),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Vị trí shipper'),
        d.location === null
          ? h('p', { class: 'hint' }, 'Chưa có vị trí: shipper chưa giữ đơn hoặc chưa chia sẻ vị trí.')
          : definition([
              ['Tọa độ', `${d.location.lat.toFixed(5)}, ${d.location.lng.toFixed(5)}`],
              ['Cập nhật lúc', formatDateTime(d.location.recordedAt)],
              ['Tình trạng', badge(FRESHNESS_LABEL[d.location.freshness], d.location.freshness === 'LIVE' ? 'ok' : d.location.freshness === 'STALE' ? 'wait' : 'lock')],
            ]),
        h('p', { class: 'hint' }, 'Chỉ lưu vị trí mới nhất, không có vệt di chuyển. Vị trí cũ hoặc mất kết nối không được coi là trực tiếp.'),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Các lần nhận đơn'),
        d.assignments.length === 0
          ? h('p', { class: 'empty' }, 'Chưa có shipper nhận.')
          : h(
              'ol',
              { class: 'timeline' },
              ...d.assignments.map((a) =>
                h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h('div', {}, h('p', { class: 'timeline-label' }, `${a.shipperName} · ${a.status}`), h('p', { class: 'timeline-meta' }, `Nhận ${formatDateTime(a.acceptedAt)}${a.endedAt === null ? '' : ` · kết thúc ${formatDateTime(a.endedAt)}`}`), a.endReason === null ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${a.endReason}`)),
                ),
              ),
            ),
      ),
    );
    if (d.incident !== null) {
      blocks.push(
        h(
          'section',
          { class: 'detail-block' },
          h('h3', { class: 'subtitle' }, 'Hồ sơ xử lý hàng'),
          definition([
            ['Tình trạng hồ sơ', badge(d.incident.status === 'OPEN' ? 'Đang mở' : 'Đã đóng', d.incident.status === 'OPEN' ? 'lock' : 'ok')],
            ['Hàng hiện ở', CUSTODY_LABEL[d.incident.custody]],
            ['Lý do giao thất bại', d.incident.reason],
            ['Mở lúc', formatDateTime(d.incident.openedAt)],
            ['Đã chuyển M11', d.incident.m11ReferredAt === null ? 'Chưa' : formatDateTime(d.incident.m11ReferredAt)],
          ]),
          h('p', { class: 'hint' }, 'Hàng ở tay ai người đó chịu trách nhiệm. Giao thất bại không có nghĩa hàng đã về quán. Không tự bồi thường hay hoàn tiền.'),
        ),
      );
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Chính sách đã áp dụng'),
        definition([
          ['Bán kính tìm shipper', `${(d.policy.searchRadiusM / 1000).toLocaleString('vi-VN')} km (cố định)`],
          ['Hoa hồng đã chốt', d.policy.commissionVnd === null ? '—' : formatVnd(d.policy.commissionVnd)],
          ['Phiên bản bảng phí', d.policy.feePolicyVersion === null ? '—' : `v${String(d.policy.feePolicyVersion)}`],
        ]),
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
    const actions = [...d.can].map((name) => {
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

  /** The popup of one action. One request in flight; an unknown outcome offers only the same request again. */
  #ask(d: DeliveryDetail, name: DeliveryActionName): void {
    let intent: DeliveryActionRequest | undefined;
    const reasonInput = h('textarea', { id: 'delivery-reason', class: 'textarea', rows: '3', maxlength: String(REASON_MAX), 'aria-describedby': 'delivery-reason-error', 'aria-label': 'Lý do' });
    const reasonError = message('error', 'delivery-reason-error');
    const status = message('error', 'delivery-action-status');
    const resolution = h('select', { id: 'delivery-resolution', class: 'select', 'aria-label': 'Hàng đã' }, h('option', { value: 'GOODS_RETURNED' }, 'Hàng đã về quán, sẵn sàng gọi lại'), h('option', { value: 'HANDLED_NO_RETURN' }, 'Đã xử lý, không giao tiếp'));
    const feeInput = h('input', { id: 'delivery-fee', type: 'text', inputmode: 'numeric', class: 'search-input', placeholder: 'Phí mới (đ), để trống nếu không đổi', 'aria-label': 'Phí mới' });
    const addressInput = h('input', { id: 'delivery-address', type: 'text', class: 'search-input', placeholder: 'Địa chỉ mô tả mới, để trống nếu không đổi', maxlength: '200', 'aria-label': 'Địa chỉ mới' });
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
        if (reason === '' || [...reason].length > REASON_MAX) {
          setMessage(reasonError, reason === '' ? 'Lý do là bắt buộc.' : `Lý do tối đa ${String(REASON_MAX)} ký tự.`);
          reasonInput.focus();
          return;
        }
        let newFee: number | undefined;
        let newAddress: string | undefined;
        if (name === 'adjust-after-pickup') {
          const digits = feeInput.value.replace(/[.\s]/g, '');
          newFee = digits === '' ? undefined : /^[0-9]{1,8}$/.test(digits) && Number(digits) <= 10_000_000 ? Number(digits) : Number.NaN;
          const address = addressInput.value.normalize('NFC').replace(/\s+/gu, ' ').trim();
          newAddress = address === '' ? undefined : address;
          if (Number.isNaN(newFee) || (newFee === undefined && newAddress === undefined)) {
            setMessage(reasonError, 'Nhập phí mới (số nguyên, tối đa 10.000.000đ) và/hoặc địa chỉ mới.');
            return;
          }
        }
        setMessage(reasonError, undefined);
        intent = {
          id: d.id,
          name,
          version: d.version,
          reason,
          ...(name === 'record-custody' ? { resolution: resolution.value === 'HANDLED_NO_RETURN' ? ('HANDLED_NO_RETURN' as const) : ('GOODS_RETURNED' as const) } : {}),
          ...(newFee === undefined ? {} : { feeVnd: newFee }),
          ...(newAddress === undefined ? {} : { recipientAddress: newAddress }),
          key: this.host.newKey(),
        };
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
      body: [
        ...(name === 'record-custody' ? [h('label', { class: 'field-label', for: 'delivery-resolution' }, 'Hàng đã'), resolution] : []),
        ...(name === 'adjust-after-pickup' ? [feeInput, addressInput] : []),
        h('label', { class: 'field-label', for: 'delivery-reason' }, 'Lý do (bắt buộc, ghi vào nhật ký kiểm toán)'),
        reasonInput,
        reasonError,
        status,
      ],
      actions: [back, confirm],
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
  }
}
