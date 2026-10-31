import {
  COMMISSION_HOLD_LABEL,
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
  DELIVERY_SIGNAL_LABEL,
  DeliverySource,
  DeliveryStateFilter,
  FEE_UNKNOWN_TEXT,
  formatVnd,
  FRESHNESS_LABEL,
  GeoPoint,
  GOODS_FILTER_LABEL,
  REASON_MAX,
  SOURCE_FILTER_LABEL,
} from '../core/deliveries.js';
import { ChatRoomRef, OrderChatSource } from '../core/order-chat.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage, svg } from './dom.js';
import { icon } from './icons.js';
import { OrderChatPanel } from './order-chat-panel.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Giao hàng" (M07.07): counters, filters, the list and a detail drawer with the timeline, the assignments, the goods
// custody and the few Admin actions. It draws what the server said and sends one request per click: the page decides no right and no state
// (the buttons follow the `can` list the server returned for this Admin and this delivery; the server refuses again whatever is sent).
// There is no free status field. Every node is created with createElement/textContent (no innerHTML). While an action runs its popup is
// locked, so it cannot be sent twice; after an unknown outcome only "Thử lại" (the same Idempotency-Key) is offered. Popups close with
// "Quay lại", never with a bare "Hủy".

export interface DeliveryHost {
  readonly source: DeliverySource;
  /** "Trao đổi đơn hàng" (issue #191) in the detail drawer; without it the drawer shows no chat. */
  readonly chat?: OrderChatSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** Where popups are mounted (the page body by default). */
  readonly dialogHost?: HTMLElement;
  /** M12-B: opens a Shipper's own page (Vận hành › Shipper). Absent when the page is not available to this Admin. */
  readonly openShipper?: (driverId: string) => void;
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

const ACTOR_LABEL: Record<string, string> = { SHIPPER: 'shipper', SHOP: 'quán', ADMIN: 'Admin', SYSTEM: 'hệ thống' };

const fee = (value: number | null): string => (value === null ? FEE_UNKNOWN_TEXT : formatVnd(value));

/** "45 giây", "12 phút", "1 giờ 5 phút", "2 ngày 3 giờ": how long something has been waiting. Never negative. */
export function waitText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) {
    return `${String(total)} giây`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${String(minutes)} phút`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return minutes % 60 === 0 ? `${String(hours)} giờ` : `${String(hours)} giờ ${String(minutes % 60)} phút`;
  }
  return hours % 24 === 0 ? `${String(Math.floor(hours / 24))} ngày` : `${String(Math.floor(hours / 24))} ngày ${String(hours % 24)} giờ`;
}

interface DiagramPoint {
  readonly label: string;
  readonly point: GeoPoint;
  readonly tone: 'pickup' | 'dropoff' | 'live' | 'stale';
}

/**
 * A schematic of the real coordinates the server gave (pickup, drop-off when the Admin may see it, the Shipper's latest position), scaled to fit and
 * drawn with plain SVG. It is NOT a map: there is no basemap, no route and no movement, only where the points lie relative to each other.
 */
export function positionDiagram(points: readonly DiagramPoint[]): SVGElement {
  const width = 420;
  const height = 220;
  const pad = 36;
  const meanLat = points.reduce((sum, item) => sum + item.point.lat, 0) / Math.max(points.length, 1);
  const scaleLng = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((item) => item.point.lng * scaleLng);
  const ys = points.map((item) => item.point.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const scale = Math.min(width - pad * 2, height - pad * 2) / span;
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const colour = { pickup: '#2A2A2E', dropoff: '#D8AD18', live: '#2E7D4F', stale: '#C23B32' } as const;
  const nodes: SVGElement[] = [svg('rect', { x: '0.5', y: '0.5', width: String(width - 1), height: String(height - 1), rx: '12', fill: '#FFFFFF', stroke: '#E3E1DB' })];
  points.forEach((item, index) => {
    const x = offsetX + ((xs[index] as number) - minX) * scale;
    const y = height - (offsetY + ((ys[index] as number) - minY) * scale);
    const circle = svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: '7', fill: colour[item.tone], stroke: '#FFFFFF', 'stroke-width': '2' });
    const text = svg('text', { x: Math.min(Math.max(x, 60), width - 60).toFixed(1), y: (y - 12).toFixed(1), 'text-anchor': 'middle', 'font-size': '12', 'font-weight': '600', fill: '#2A2A2E' });
    text.textContent = item.label;
    nodes.push(circle, text);
  });
  return svg('svg', { viewBox: `0 0 ${String(width)} ${String(height)}`, width: '100%', role: 'img', 'aria-label': `Sơ đồ vị trí tương đối của ${String(points.length)} điểm` }, ...nodes);
}

const ACTION_LABEL: Record<DeliveryActionName, string> = {
  'record-custody': 'Ghi nhận hàng',
  'adjust-after-pickup': 'Điều chỉnh sau lấy hàng',
  'refer-m11': 'Đánh dấu cần theo dõi (M11)',
  'release-assignment': 'Giải phóng shipper',
};

const ACTION_TEXT: Record<DeliveryActionName, string> = {
  'record-custody': 'Ghi nhận hàng đã về quán hoặc đã xử lý không giao tiếp. Đây là ghi nhận, không tự bồi thường hay hoàn tiền.',
  'adjust-after-pickup': 'Sửa phí hoặc địa chỉ mô tả sau khi shipper đã lấy hàng. Giá trị trước/sau được ghi vào nhật ký kiểm toán cùng lý do.',
  'refer-m11': 'Đánh dấu chuyến này cần theo dõi ở Phản ánh (M11). Hệ thống chỉ ghi dấu và nhật ký; KHÔNG tạo phiếu phản ánh thay khách hay shipper.',
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
  readonly #source: HTMLSelectElement;
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
  #chat: OrderChatPanel | undefined;
  #handle: DialogHandle | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: DeliveryHost,
  ) {
    this.#search = h('input', { id: 'delivery-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo mã giao hàng', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo mã', maxlength: '40' });
    const states: DeliveryStateFilter[] = ['ALL', ...DELIVERY_STATES];
    this.#state = h('select', { id: 'delivery-state', class: 'select', 'aria-label': 'Trạng thái' }, ...states.map((value) => h('option', { value }, DELIVERY_STATE_LABEL[value])));
    this.#goods = h('select', { id: 'delivery-goods', class: 'select', 'aria-label': 'Tình trạng hàng' }, ...(['ALL', 'OPEN', 'CLOSED'] as const).map((value) => h('option', { value }, GOODS_FILTER_LABEL[value])));
    this.#source = h('select', { id: 'delivery-source', class: 'select', 'aria-label': 'Nguồn' }, ...(['ALL', 'DIRECT', 'ORDER'] as const).map((value) => h('option', { value }, SOURCE_FILTER_LABEL[value])));
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
    for (const control of [this.#state, this.#goods, this.#source, this.#from, this.#to]) {
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
        h('div', { class: 'toolbar toolbar-filters' }, this.#from, this.#to, this.#source, this.#shop, this.#shipper),
        this.#results,
        this.#drawer,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#handle?.close();
    this.#dropChat();
  }

  #dropChat(): void {
    this.#chat?.dispose();
    this.#chat = undefined;
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
      source: (['DIRECT', 'ORDER'] as const).find((value) => value === this.#source.value) ?? 'ALL',
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
      const filtered = [this.#search.value, this.#shop.value, this.#shipper.value, this.#from.value, this.#to.value].some((value) => value.trim() !== '') || this.#state.value !== 'ALL' || this.#goods.value !== 'ALL' || this.#source.value !== 'ALL' || this.#group !== undefined;
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
    const columns = ['Mã / Order', 'Quán', 'Shipper', 'Tạo lúc', 'Trạng thái', 'Phí giao', 'Chờ', 'Cần xử lý', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Danh sách giao hàng'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #row(row: DeliveryRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem giao hàng ${row.code}` }, 'Xem');
    open.addEventListener('click', () => void this.#open(row.id));
    const signals = row.signals.map((signal) => badge(DELIVERY_SIGNAL_LABEL[signal], 'lock'));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Mã / Order' }, row.code, row.source === 'ORDER' ? h('span', { class: 'cell-sub' }, `Order ${row.orderId ?? ''}`.trim()) : h('span', { class: 'cell-sub' }, 'Quán gọi trực tiếp')),
      h('td', { 'data-label': 'Quán', class: 'cell-name' }, row.shopName),
      h('td', { 'data-label': 'Shipper' }, row.shipperName ?? '—'),
      h('td', { 'data-label': 'Tạo lúc' }, formatDateTime(row.createdAt)),
      h('td', { 'data-label': 'Trạng thái' }, stateBadge(row)),
      h('td', { 'data-label': 'Phí giao' }, fee(row.feeVnd)),
      h('td', { 'data-label': 'Chờ' }, row.waitSeconds === null ? '—' : waitText(row.waitSeconds)),
      h('td', { 'data-label': 'Cần xử lý' }, ...(signals.length === 0 ? ['—'] : signals)),
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
    this.#dropChat();
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
    this.#chat?.start();
  }

  /** Pickup and drop-off. The drop-off address and point are the customer's: filled only for an Admin who may see the contact. */
  #places(d: DeliveryDetail): HTMLElement {
    const point = (p: { readonly lat: number; readonly lng: number }): string => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Điểm lấy và điểm giao'),
      definition([
        ['Điểm lấy (quán)', d.pickup.addressText],
        ['Tọa độ điểm lấy', point(d.pickup)],
        ['Khu vực giao', d.dropoff.areaText ?? '—'],
        ['Địa chỉ giao', d.dropoff.addressText ?? 'Ẩn: tài khoản này không có quyền xem liên hệ'],
        ['Điểm giao đã ghim', d.dropoff.point === null ? (d.dropoff.addressText === null ? 'Ẩn: tài khoản này không có quyền xem liên hệ' : d.dropoff.pinned ? '—' : 'Chưa ghim') : point(d.dropoff.point)],
      ]),
    );
  }

  /**
   * The position of the Shipper. The cases are told apart: nobody holds the delivery, the delivery is not on the way, the phone never sent a position,
   * the position is old or lost, and the position is fresh. Web Admin has no basemap component (the M14 map lives in the Android app), so the block says so
   * and draws a schematic of the real coordinates; it never animates or invents a position, and a missing map never hides the list.
   */
  #mapBlock(d: DeliveryDetail): HTMLElement {
    const notes: Record<DeliveryDetail['locationState'], string> = {
      NO_SHIPPER: 'Chưa có shipper giữ đơn nên chưa theo dõi vị trí.',
      NOT_RUNNING: 'Yêu cầu giao không còn ở giai đoạn đang giao nên không theo dõi vị trí.',
      NO_POSITION: 'Chưa có vị trí: shipper đang giữ đơn nhưng thiết bị chưa gửi vị trí nào.',
      AVAILABLE: '',
    };
    const block = h('section', { class: 'detail-block', id: 'delivery-map' }, h('h3', { class: 'subtitle' }, 'Vị trí shipper'));
    const points: DiagramPoint[] = [{ label: 'Quán', point: { lat: d.pickup.lat, lng: d.pickup.lng }, tone: 'pickup' }];
    if (d.dropoff.point !== null) {
      points.push({ label: 'Điểm giao', point: d.dropoff.point, tone: 'dropoff' });
    }
    const location = d.location;
    if (d.locationState !== 'AVAILABLE' || location === null) {
      block.append(h('p', { class: 'hint', role: 'status' }, notes[d.locationState] === '' ? 'Chưa có vị trí.' : notes[d.locationState]));
    } else {
      block.append(
        definition([
          ['Tọa độ gần nhất', `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`],
          ['Cập nhật lúc', `${formatDateTime(location.recordedAt)} (${waitText(location.ageSeconds)} trước)`],
          ['Tình trạng', badge(FRESHNESS_LABEL[location.freshness], location.freshness === 'LIVE' ? 'ok' : location.freshness === 'STALE' ? 'wait' : 'lock')],
        ]),
      );
      if (location.freshness !== 'LIVE') {
        block.append(h('p', { class: 'notice', role: 'status' }, location.freshness === 'STALE' ? 'GPS cũ: vị trí này không còn là trực tiếp, shipper có thể đã di chuyển.' : 'Mất kết nối vị trí: không nên dùng vị trí này để biết shipper đang ở đâu.'));
      }
      points.push({ label: 'Shipper', point: { lat: location.lat, lng: location.lng }, tone: location.freshness === 'LIVE' ? 'live' : 'stale' });
    }
    block.append(positionDiagram(points), h('p', { class: 'hint' }, 'Sơ đồ tương đối từ tọa độ thật (không phải bản đồ nền). Web Admin chưa có thành phần bản đồ; bản đồ M14 hiện chỉ có trong ứng dụng Android. Chỉ lưu vị trí mới nhất, không có vệt di chuyển.'));
    return block;
  }

  /** The other records of the delivery. A link is a button only where this Admin has the page; the Order and the shop have no page of their own yet. */
  #links(d: DeliveryDetail): HTMLElement {
    const items: Array<readonly [string, string | HTMLElement]> = [['Quán', d.shopName]];
    if (d.links.shipperDriverId !== null) {
      const open = this.host.openShipper;
      if (open === undefined) {
        items.push(['Shipper', d.shipperName ?? '—']);
      } else {
        const button = h('button', { type: 'button', class: 'table-link' }, d.shipperName ?? 'Xem shipper');
        button.addEventListener('click', () => open(d.links.shipperDriverId as string));
        items.push(['Shipper', button]);
      }
    }
    items.push(['Order', d.links.orderId === null ? 'Không có (quán gọi trực tiếp)' : `${d.links.orderId} (màn hình Order chưa có)`]);
    if (d.links.previousDeliveryId !== null) {
      const previous = d.links.previousDeliveryId;
      const button = h('button', { type: 'button', class: 'table-link' }, 'Mở yêu cầu giao trước');
      button.addEventListener('click', () => void this.#open(previous));
      items.push(['Gọi lại từ', button]);
    }
    if (d.links.nextDelivery !== null) {
      const next = d.links.nextDelivery;
      const button = h('button', { type: 'button', class: 'table-link' }, `Mở ${next.code}`);
      button.addEventListener('click', () => void this.#open(next.id));
      items.push(['Đã gọi lại thành', button]);
    }
    return h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Liên kết'), definition(items));
  }

  /** The commission hold and ledger row of each assignment, from M04. Not derived from the delivery state; hidden entirely without wallet.read. */
  #money(d: DeliveryDetail): HTMLElement {
    const block = h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Giao dịch liên quan'));
    if (d.money.status === 'FORBIDDEN') {
      block.append(h('p', { class: 'hint' }, 'Tài khoản này không có quyền xem giao dịch ví nên hoa hồng của yêu cầu giao không được hiển thị.'));
      return block;
    }
    if (d.money.commissions.length === 0) {
      block.append(h('p', { class: 'empty' }, 'Chưa có hoa hồng nào được giữ hoặc thu cho yêu cầu giao này.'));
      return block;
    }
    block.append(
      h(
        'ul',
        { class: 'plain-list' },
        ...d.money.commissions.map((trace) =>
          h(
            'li',
            {},
            `${COMMISSION_HOLD_LABEL[trace.holdStatus]} · ${formatVnd(trace.amountVnd)}`,
            trace.ledgerAt === null ? ' · chưa ghi sổ cái' : ` · ghi sổ cái ${formatDateTime(trace.ledgerAt)}`,
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Trạng thái giao hàng không quyết định tiền đã thu: chỉ một dòng sổ cái (ví M04) mới là bằng chứng hoa hồng đã thu.'),
    );
    return block;
  }

  #closeBar(title: string): HTMLElement {
    const close = secondary('Đóng');
    close.classList.add('btn-inline');
    close.addEventListener('click', () => {
      this.#openId = undefined;
      this.#dropChat();
      this.#drawer.hidden = true;
      this.#drawer.replaceChildren();
    });
    return h('header', { class: 'drawer-head' }, h('h2', { class: 'subtitle' }, title), close);
  }

  /** An ORDER delivery talks in the room of its Order, a DIRECT one in the room of the delivery itself: one room per file, never a second one. */
  #chatBlock(d: DeliveryDetail): HTMLElement[] {
    if (this.host.chat === undefined) {
      return [];
    }
    const room: ChatRoomRef | undefined = d.source === 'ORDER' ? (d.orderId === null ? undefined : { kind: 'ORDER', id: d.orderId }) : { kind: 'DIRECT', id: d.id };
    if (room === undefined) {
      return [h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Trao đổi đơn hàng'), h('p', { class: 'empty' }, 'Không xác định được đơn của yêu cầu giao này nên chưa mở được trao đổi.'))];
    }
    this.#chat = new OrderChatPanel(room, { source: this.host.chat, newKey: this.host.newKey, onSessionLost: this.host.onSessionLost, onForbidden: this.host.onForbidden, ...(this.host.dialogHost === undefined ? {} : { dialogHost: this.host.dialogHost }) });
    return [this.#chat.element];
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
      this.#places(d),
      this.#mapBlock(d),
      this.#links(d),
      this.#money(d),
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
                  h('div', {}, h('p', { class: 'timeline-label' }, `${a.shipperName} · ${a.status}`), h('p', { class: 'timeline-meta' }, `Nhận ${formatDateTime(a.acceptedAt)}${a.endedAt === null ? '' : ` · kết thúc ${formatDateTime(a.endedAt)}${a.endActor === null ? '' : ` bởi ${ACTOR_LABEL[a.endActor] ?? a.endActor}`}`}`), a.endReason === null ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${a.endReason}`)),
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
            ['Đánh dấu theo dõi M11', d.incident.m11ReferredAt === null ? 'Chưa' : formatDateTime(d.incident.m11ReferredAt)],
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
      ...this.#chatBlock(d),
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
