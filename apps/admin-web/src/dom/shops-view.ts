import { formatRoute, Route } from '../core/routes.js';
import {
  AVAILABILITY_LABEL,
  Availability,
  displayPhone,
  ENABLE_BLOCKER_LABEL,
  formatVnd,
  HISTORY_ACTION_LABEL,
  HISTORY_PAGE_SIZE,
  HistoryEntry,
  MENU_PAGE_SIZE,
  MENU_STATUS_FILTERS,
  MENU_STATUS_LABEL,
  MenuItem,
  MenuStatusFilter,
  OPEN_WORK_BLOCKED,
  OPEN_WORK_COUNTS,
  PROFILE_FILTER_LABEL,
  PROFILE_FILTERS,
  PROFILE_STATUS,
  ProfileFilter,
  Preview,
  REASON_MAX,
  SCHEDULE_FILTER_LABEL,
  SCHEDULE_FILTERS,
  ScheduleFilter,
  SEARCH_MAX,
  ShopCommandName,
  ShopDetail,
  ShopQuery,
  ShopRow,
  ShopSource,
  ShopTab,
  SHOP_PAGE_SIZE,
  SHOP_TABS,
  StatusFlow,
  TAB_LABEL,
  weekLines,
  AreaOption,
} from '../core/shops.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Quán" (M02 shop management): the list and one shop with four tabs. It draws what the server said and sends one request per
// click: the page decides no right, no status and no "open / closed" (the buttons follow `allowed_actions` of the answer, and the server refuses again
// whatever is sent). Every node is created with createElement/textContent (no innerHTML). While a status command runs or its result is unknown the
// popup, the tabs, the refresh buttons and the links away are locked, so a second write cannot start and the pending payload and key cannot be lost.

export interface ShopListMemory {
  value: ShopQuery | undefined;
}

export interface ShopHost {
  readonly source: ShopSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly go: (route: Route) => void;
  readonly login: () => void;
  readonly home: () => void;
  /** The list filter, kept for the life of the shell so "Danh sách quán" from a detail returns to the same list. */
  readonly memory: ShopListMemory;
  /** Where popups are mounted (the page body by default). */
  readonly dialogHost?: HTMLElement;
}

const SEARCH_PAUSE_MS = 300;

type Tone = 'ok' | 'wait' | 'lock' | 'neutral';

function badge(label: string, tone: Tone): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

const availabilityBadge = (availability: Availability): HTMLElement => badge(AVAILABILITY_LABEL[availability.reason].label, AVAILABILITY_LABEL[availability.reason].tone);

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function routeLink(host: ShopHost, route: Route, label: string, ariaLabel?: string, className = 'table-link table-action'): HTMLElement {
  const link = h('a', { href: formatRoute(route), class: className, ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }) }, label);
  link.addEventListener('click', (event) => {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      host.go(route);
    }
  });
  return link;
}

/** An image that disappears when it cannot be loaded (a logo is public only while the shop is active), never leaving a broken icon. */
function picture(url: string | null, className: string): HTMLElement | undefined {
  if (url === null) {
    return undefined;
  }
  const image = h('img', { class: className, src: url, alt: '', loading: 'lazy' });
  image.addEventListener('error', () => image.remove());
  return image;
}

function pager(total: number, page: number, size: number, noun: string, onPage: (page: number) => void, frozen = false): HTMLElement {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const previous = secondary('Trước');
  previous.disabled = page <= 1 || frozen;
  previous.addEventListener('click', () => onPage(page - 1));
  const next = secondary('Sau');
  next.disabled = page >= pages || frozen;
  next.addEventListener('click', () => onPage(page + 1));
  return h(
    'nav',
    { class: 'pager', 'aria-label': 'Phân trang' },
    h('p', { class: 'pager-text' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} ${noun}`),
    h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(page)}/${String(pages)}`), next),
  );
}

function handleFailure(host: ShopHost, failure: 'offline' | 'timeout' | 'session-expired' | 'forbidden' | 'rate-limited' | 'unknown'): void {
  if (failure === 'session-expired') {
    host.onSessionLost();
  } else if (failure === 'forbidden') {
    host.onForbidden();
  }
}

// ---- list ------------------------------------------------------------------------------------------------------------------

export class ShopListView {
  readonly #search: HTMLInputElement;
  readonly #area: HTMLSelectElement;
  readonly #profile: HTMLSelectElement;
  readonly #schedule: HTMLSelectElement;
  readonly #results: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #latest = 0;
  #page = 1;
  #disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShopHost,
    initial: { readonly q?: string; readonly area?: string; readonly profile?: ProfileFilter; readonly schedule?: ScheduleFilter } = {},
  ) {
    const remembered = Object.keys(initial).length === 0 ? host.memory.value : undefined;
    this.#search = h('input', { id: 'shop-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo tên quán, mã quán hoặc số điện thoại', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm quán', maxlength: String(SEARCH_MAX) });
    this.#search.value = initial.q ?? remembered?.query ?? '';
    this.#area = h('select', { id: 'shop-area', class: 'select', 'aria-label': 'Khu vực' }, h('option', { value: 'ALL' }, 'Mọi khu vực'));
    const area = initial.area ?? remembered?.area ?? 'ALL';
    if (area !== 'ALL') {
      this.#area.append(h('option', { value: area }, 'Khu vực đã chọn'));
      this.#area.value = area;
    }
    this.#profile = h('select', { id: 'shop-profile', class: 'select', 'aria-label': 'Trạng thái hồ sơ' }, ...PROFILE_FILTERS.map((value) => h('option', { value }, PROFILE_FILTER_LABEL[value])));
    this.#profile.value = initial.profile ?? remembered?.profile ?? 'ALL';
    this.#schedule = h('select', { id: 'shop-schedule', class: 'select', 'aria-label': 'Mở hoặc đóng theo lịch' }, ...SCHEDULE_FILTERS.map((value) => h('option', { value }, SCHEDULE_FILTER_LABEL[value])));
    this.#schedule.value = initial.schedule ?? remembered?.schedule ?? 'ALL';
    this.#page = remembered?.page ?? 1;
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#results = h('div', { class: 'results' });
    this.#search.addEventListener('input', () => {
      this.#page = 1;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => void this.load(), SEARCH_PAUSE_MS);
    });
    for (const select of [this.#area, this.#profile, this.#schedule]) {
      select.addEventListener('change', () => {
        this.#page = 1;
        void this.load();
      });
    }
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'shop-title' },
        h(
          'header',
          { class: 'page-head' },
          h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'shop-title' }, 'Quán'), h('p', { class: 'lead lead-last' }, 'Hồ sơ, giờ hoạt động và thực đơn của các quán. Chủ quán tự cập nhật trong ứng dụng 11Food; quản trị viên xem tại đây và có thể vô hiệu hóa hoặc kích hoạt lại quán khi có quyền.')),
        ),
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#area, this.#profile, this.#schedule, refresh),
        this.#results,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
  }

  #query(): ShopQuery {
    return {
      query: this.#search.value,
      area: this.#area.value === '' ? 'ALL' : this.#area.value,
      profile: PROFILE_FILTERS.find((value) => value === this.#profile.value) ?? 'ALL',
      schedule: SCHEDULE_FILTERS.find((value) => value === this.#schedule.value) ?? 'ALL',
      page: this.#page,
    };
  }

  #syncAreas(areas: readonly AreaOption[]): void {
    const selected = this.#area.value;
    const options = [h('option', { value: 'ALL' }, 'Mọi khu vực'), ...areas.map((area) => h('option', { value: area.id }, area.active ? area.name : `${area.name} (tạm ngưng)`))];
    this.#area.replaceChildren(...options);
    this.#area.value = areas.some((area) => area.id === selected) ? selected : 'ALL';
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#results.replaceChildren(this.#card({ panel: skeleton() }));
    const query = this.#query();
    const read = await this.host.source.list(query);
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#results.replaceChildren(this.#card({ panel: notWiredPanel(read.reason) }));
      return;
    }
    if (read.kind === 'failed') {
      handleFailure(this.host, read.failure);
      this.#results.replaceChildren(this.#card({ panel: failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) }));
      return;
    }
    this.#syncAreas(read.page.areas);
    const effective = this.#query();
    this.host.memory.value = { ...effective, page: this.#page };
    const filtered = effective.query.trim() !== '' || effective.area !== 'ALL' || effective.profile !== 'ALL' || effective.schedule !== 'ALL';
    if (read.page.rows.length === 0) {
      const pages = Math.max(1, Math.ceil(read.page.total / SHOP_PAGE_SIZE));
      if (read.page.total > 0 && this.#page > pages) {
        // The list shrank under the person's feet (a filter, another administrator): go back to the last page that exists.
        this.#page = pages;
        void this.load();
        return;
      }
      const clear = secondary('Xóa bộ lọc');
      clear.classList.add('btn-inline');
      clear.addEventListener('click', () => {
        this.#search.value = '';
        this.#area.value = 'ALL';
        this.#profile.value = 'ALL';
        this.#schedule.value = 'ALL';
        this.#page = 1;
        void this.load();
      });
      this.#results.replaceChildren(
        this.#card({ panel: filtered ? h('div', {}, emptyPanel('Không tìm thấy quán', 'Không có quán nào phù hợp với từ khóa hoặc bộ lọc đang chọn.'), h('p', { class: 'link-center' }, clear)) : emptyPanel('Chưa có quán', 'Quán xuất hiện ở đây sau khi chủ quán đăng ký trong ứng dụng 11Food.') }),
      );
      return;
    }
    this.#results.replaceChildren(
      h('div', {}, this.#card({ rows: read.page.rows.map((row) => this.#row(row)) }), pager(read.page.total, this.#page, SHOP_PAGE_SIZE, 'quán', (page) => {
        this.#page = page;
        void this.load();
      })),
    );
  }

  #card(body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
    const columns = ['Quán', 'Chủ quán', 'Khu vực', 'Hồ sơ', 'Theo lịch', 'Món hiện/tổng', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Danh sách quán'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #row(row: ShopRow): HTMLElement {
    const status = PROFILE_STATUS[row.status];
    const open = routeLink(this.host, { name: 'shop', id: row.id }, 'Xem chi tiết', `Xem chi tiết quán ${row.name}`);
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Quán', class: 'cell-name' }, h('span', { class: 'row-name' }, row.name), h('span', { class: 'cell-sub' }, `${row.code} · ${row.addressText}`)),
      h('td', { 'data-label': 'Chủ quán' }, row.owner === null ? 'Chưa có' : h('span', {}, row.owner.name ?? 'Chủ quán', h('span', { class: 'cell-sub' }, displayPhone(row.owner.phone)))),
      h('td', { 'data-label': 'Khu vực' }, row.areaName ?? 'Chưa có'),
      h('td', { 'data-label': 'Hồ sơ' }, badge(status.label, status.tone)),
      h('td', { 'data-label': 'Theo lịch' }, availabilityBadge(row.availability)),
      h('td', { 'data-label': 'Món hiện/tổng', class: 'cell-num' }, `${String(row.itemsVisible)}/${String(row.itemsTotal)}`),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }
}

// ---- detail ----------------------------------------------------------------------------------------------------------------

const COMMAND_TEXT: Record<ShopCommandName, { readonly title: string; readonly button: string; readonly confirm: string; readonly danger: boolean }> = {
  disable: { title: 'Vô hiệu hóa quán', button: 'Vô hiệu hóa quán', confirm: 'Vô hiệu hóa', danger: true },
  enable: { title: 'Kích hoạt lại quán', button: 'Kích hoạt lại', confirm: 'Kích hoạt lại', danger: false },
};

export class ShopDetailView {
  readonly #body: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #tabs: HTMLElement;
  #handle: DialogHandle | undefined;
  #latest = 0;
  #tabToken = 0;
  #disposed = false;
  #shop: ShopDetail | undefined;
  #tab: ShopTab;
  #flow: StatusFlow | undefined;
  #menu = { query: '', category: 'ALL', status: 'ALL' as MenuStatusFilter, page: 1 };
  #historyPage = 1;
  readonly #warn = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ShopHost,
    private readonly id: string,
    tab: ShopTab = 'profile',
  ) {
    this.#tab = tab;
    this.#notice = message('notice', 'shop-notice');
    this.#body = h('div', { class: 'detail' });
    this.#tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Thông tin quán' });
    this.#panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'shop-detail-title' }, this.#notice, this.#body));
  }

  dispose(): void {
    this.#disposed = true;
    window.removeEventListener('beforeunload', this.#warn);
    this.#handle?.close();
    this.#handle = undefined;
  }

  get #locked(): boolean {
    return this.#flow?.locked === true;
  }

  async #read(): Promise<ShopDetail | undefined> {
    const read = await this.host.source.detail(this.id);
    if (this.#disposed) {
      return undefined;
    }
    switch (read.kind) {
      case 'ready':
        return read.shop;
      case 'not-wired':
        this.#body.replaceChildren(notWiredPanel(read.reason));
        return undefined;
      case 'not-found':
        this.#body.replaceChildren(this.#back(), emptyPanel('Không tìm thấy quán', 'Quán này không tồn tại hoặc bạn không có quyền xem.'));
        return undefined;
      case 'failed':
        handleFailure(this.host, read.failure);
        this.#body.replaceChildren(this.#back(), failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
        return undefined;
    }
  }

  async load(notice?: string): Promise<void> {
    if (this.#locked) {
      return;
    }
    const token = ++this.#latest;
    this.#body.replaceChildren(skeleton(4));
    const shop = await this.#read();
    if (this.#disposed || token !== this.#latest || shop === undefined) {
      return;
    }
    setMessage(this.#notice, notice);
    this.#shop = shop;
    this.#draw(shop);
    void this.#loadTab();
  }

  #back(): HTMLElement {
    const link = routeLink(this.host, { name: 'shops' }, 'Danh sách quán', undefined, 'table-link');
    link.prepend(icon('arrow-left', 16));
    if (this.#locked) {
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', (event) => event.preventDefault(), { capture: true });
    }
    return link;
  }

  #draw(shop: ShopDetail): void {
    const status = PROFILE_STATUS[shop.status];
    const actions = shop.actions.map((name) => {
      const spec = COMMAND_TEXT[name];
      const button = spec.danger ? h('button', { type: 'button', class: 'btn btn-danger btn-inline' }, spec.button) : primary(spec.button, 'button');
      button.classList.add('btn-inline');
      button.addEventListener('click', () => this.#ask(name));
      return button;
    });
    this.#tabs.replaceChildren(
      ...SHOP_TABS.map((tab) => {
        const button = h('button', { type: 'button', class: `tab${tab === this.#tab ? ' tab-active' : ''}`, role: 'tab', 'aria-selected': String(tab === this.#tab), id: `shop-tab-${tab}` }, TAB_LABEL[tab]);
        button.addEventListener('click', () => {
          if (this.#locked || tab === this.#tab) {
            return;
          }
          this.#tab = tab;
          for (const other of Array.from(this.#tabs.children)) {
            const active = other.id === `shop-tab-${tab}`;
            other.classList.toggle('tab-active', active);
            other.setAttribute('aria-selected', String(active));
          }
          void this.#loadTab();
        });
        return button;
      }),
    );
    const parts: (HTMLElement | undefined)[] = [
      this.#back(),
      h(
        'header',
        { class: 'page-head' },
        h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'shop-detail-title' }, shop.name), h('p', { class: 'lead lead-last' }, `Mã quán ${shop.code}`)),
        h('div', { class: 'detail-status' }, badge(status.label, status.tone), availabilityBadge(shop.availability)),
      ),
      actions.length === 0 ? undefined : h('div', { class: 'detail-actions' }, ...actions),
      shop.status === 'INCOMPLETE' ? h('p', { class: 'message message-warning' }, 'Hồ sơ còn là bản nháp. Chủ quán hoàn thiện và kích hoạt trong 11Food; Web Admin không kích hoạt thay.') : undefined,
      shop.status === 'DISABLED' ? h('p', { class: 'message message-warning' }, 'Quán đang bị vô hiệu hóa: không hiển thị công khai và không nhận đơn mới. Dữ liệu hồ sơ, lịch và thực đơn được giữ nguyên.') : undefined,
      shop.owner?.locked === true ? h('p', { class: 'message message-warning' }, 'Tài khoản chủ quán đang bị khóa nên quán không nhận đơn mới, kể cả khi hồ sơ đang hoạt động. Mở khóa ở mục Tài khoản › Người dùng.') : undefined,
      this.#tabs,
      this.#panel,
    ];
    this.#body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== undefined));
  }

  async #loadTab(): Promise<void> {
    const shop = this.#shop;
    if (shop === undefined) {
      return;
    }
    const token = ++this.#tabToken;
    this.#panel.setAttribute('aria-labelledby', `shop-tab-${this.#tab}`);
    switch (this.#tab) {
      case 'profile':
        this.#panel.replaceChildren(...this.#profile(shop));
        return;
      case 'hours':
        this.#panel.replaceChildren(...this.#hours(shop));
        return;
      case 'menu':
        this.#panel.replaceChildren(skeleton(4));
        await this.#loadMenu(token);
        return;
      case 'history':
        this.#panel.replaceChildren(skeleton(4));
        await this.#loadHistory(token);
        return;
    }
  }

  // -- tab A: profile

  #profile(shop: ShopDetail): HTMLElement[] {
    const coordinates = shop.pickupLat === null || shop.pickupLng === null ? 'Chưa có tọa độ' : `${String(shop.pickupLat)}, ${String(shop.pickupLng)}`;
    const blocks: HTMLElement[] = [
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Hồ sơ quán'),
        picture(shop.logoUrl, 'shop-logo'),
        definition([
          ['Tên quán', shop.name],
          ['Mã quán', shop.code],
          ['Chủ quán', shop.owner?.name ?? 'Chưa có thông tin tên'],
          ['SĐT đăng nhập của chủ quán', shop.owner === null ? 'Chưa có' : displayPhone(shop.owner.phone)],
          ['SĐT liên hệ của quán', displayPhone(shop.contactPhone)],
          ['Địa chỉ', shop.addressText],
          ['Khu vực', shop.areaName === null ? 'Chưa có' : shop.areaActive === false ? `${shop.areaName} (đang tạm ngưng)` : shop.areaName],
          ['Zalo', shop.zalo ?? 'Chưa có'],
          ['Facebook', shop.facebook ?? 'Chưa có'],
          ['Tạo lúc', formatDateTime(shop.createdAt)],
          ['Cập nhật lúc', formatDateTime(shop.updatedAt)],
        ]),
        h('p', { class: 'hint' }, 'Chủ quán tự sửa hồ sơ, lịch và món trong 11Food. Web Admin chỉ xem, không sửa trực tiếp.'),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Vị trí lấy hàng'),
        definition([['Tọa độ (vĩ độ, kinh độ)', coordinates], ['Địa chỉ', shop.addressText]]),
        h('p', { class: 'hint' }, 'Bản đồ trên Web Admin chưa được nối nên chưa hiển thị vị trí trên bản đồ. Địa chỉ và tọa độ ở trên là dữ liệu thật của quán; các luồng khác không bị ảnh hưởng.'),
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Đơn và giao hàng chưa kết thúc'),
        definition([
          ['Đơn chưa kết thúc', String(shop.ordersOpen)],
          ['Trong đó chờ xác nhận', String(shop.ordersPendingConfirmation)],
          ['Trong đó đang chuẩn bị', String(shop.ordersPreparing)],
          ['Lượt giao đang chạy', String(shop.activeDeliveries)],
          ['Món hiện / ẩn', `${String(shop.menuVisible)} / ${String(shop.menuHidden)}`],
        ]),
        shop.disableBlocked ? h('p', { class: 'message message-warning' }, OPEN_WORK_BLOCKED) : undefined,
        h('p', { class: 'hint' }, 'Chỉ vô hiệu hóa được khi mọi đơn đã kết thúc và không còn lượt giao đang chạy. Web Admin không hủy đơn hay giao hàng thay chủ quán.'),
      ),
    ];
    return blocks;
  }

  // -- tab B: hours

  #hours(shop: ShopDetail): HTMLElement[] {
    const lines = weekLines(shop.hours);
    return [
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Giờ hoạt động trong tuần'),
        h('p', { class: 'hint' }, `Múi giờ ${shop.timezone}. Quán tự mở và đóng theo lịch này, không có công tắc. Trạng thái hiện tại do máy chủ tính tại ${formatDateTime(shop.availability.evaluatedAt)}.`),
        h('p', {}, availabilityBadge(shop.availability)),
        shop.hours.length === 0
          ? emptyPanel('Chưa có lịch hoạt động', 'Chủ quán chưa khai báo giờ hoạt động nên quán đang đóng cả tuần.')
          : h(
              'table',
              { class: 'table hours-table' },
              h('caption', { class: 'sr-only' }, 'Lịch hoạt động trong tuần'),
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ngày'), h('th', { scope: 'col' }, 'Khung giờ'))),
              h('tbody', {}, ...lines.map((line) => h('tr', {}, h('td', { 'data-label': 'Ngày', class: 'cell-name' }, line.label), h('td', { 'data-label': 'Khung giờ' }, line.intervals.length === 0 ? 'Nghỉ' : h('span', { class: 'hours-list' }, ...line.intervals.map((text) => h('span', { class: 'hours-slot' }, text))))))),
            ),
        h('p', { class: 'hint' }, 'Khung giờ qua đêm (ví dụ 22:00 – 02:00 hôm sau) thuộc ngày bắt đầu. “Cả ngày” là mở 24 giờ.'),
      ),
    ];
  }

  // -- tab C: menu

  async #loadMenu(token: number): Promise<void> {
    const read = await this.host.source.menu(this.id, this.#menu);
    if (this.#disposed || token !== this.#tabToken || this.#tab !== 'menu') {
      return;
    }
    if (read.kind !== 'ready') {
      this.#panel.replaceChildren(this.#tabProblem(read, () => void this.#loadTab()));
      return;
    }
    const { groups, items, total } = read.page;
    const query = h('input', { type: 'search', class: 'search-input', placeholder: 'Tìm tên món', 'aria-label': 'Tìm món', maxlength: String(SEARCH_MAX), autocomplete: 'off' });
    query.value = this.#menu.query;
    const group = h('select', { class: 'select', 'aria-label': 'Nhóm món' }, h('option', { value: 'ALL' }, 'Mọi nhóm'), ...groups.map((entry) => h('option', { value: entry.id }, `${entry.name}${entry.active ? '' : ' (ngừng dùng)'} · ${String(entry.itemCount)}`)));
    group.value = groups.some((entry) => entry.id === this.#menu.category) ? this.#menu.category : 'ALL';
    const status = h('select', { class: 'select', 'aria-label': 'Hiện hoặc ẩn' }, ...MENU_STATUS_FILTERS.map((value) => h('option', { value }, MENU_STATUS_LABEL[value])));
    status.value = this.#menu.status;
    let timer: ReturnType<typeof setTimeout> | undefined;
    query.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.#menu = { ...this.#menu, query: query.value, page: 1 };
        void this.#loadTab();
      }, SEARCH_PAUSE_MS);
    });
    group.addEventListener('change', () => {
      this.#menu = { ...this.#menu, category: group.value, page: 1 };
      void this.#loadTab();
    });
    status.addEventListener('change', () => {
      this.#menu = { ...this.#menu, status: MENU_STATUS_FILTERS.find((value) => value === status.value) ?? 'ALL', page: 1 };
      void this.#loadTab();
    });
    const preview = primary('Xem như khách', 'button');
    preview.classList.add('btn-inline');
    preview.addEventListener('click', () => void this.#showPreview());
    const filtered = this.#menu.query.trim() !== '' || this.#menu.category !== 'ALL' || this.#menu.status !== 'ALL';
    const pages = Math.max(1, Math.ceil(total / MENU_PAGE_SIZE));
    if (items.length === 0 && total > 0 && this.#menu.page > pages) {
      this.#menu = { ...this.#menu, page: pages };
      void this.#loadTab();
      return;
    }
    this.#panel.replaceChildren(
      h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), query), group, status, preview),
      h('p', { class: 'hint' }, 'Quản trị viên thấy cả món đang ẩn (chỉ ở màn này). Món đã xóa không hiển thị. Nhóm đã ngừng dùng vẫn giữ các món cũ. Không sửa món hay giá tại đây.'),
      items.length === 0
        ? filtered
          ? emptyPanel('Không tìm thấy món', 'Không có món nào phù hợp với từ khóa hoặc bộ lọc đang chọn.')
          : emptyPanel('Chưa có món', 'Quán chưa thêm món nào.')
        : h('div', {}, this.#menuTable(items), pager(total, this.#menu.page, MENU_PAGE_SIZE, 'món', (page) => {
            this.#menu = { ...this.#menu, page };
            void this.#loadTab();
          })),
    );
  }

  #menuTable(items: readonly MenuItem[]): HTMLElement {
    const columns = ['Ảnh', 'Món', 'Giá', 'Nhóm', 'Trạng thái', 'Thao tác'];
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = items.map((item) => {
      const open = h('button', { type: 'button', class: 'btn btn-secondary btn-inline', 'aria-label': `Chi tiết món ${item.name}` }, 'Chi tiết');
      open.addEventListener('click', () => this.#showItem(item));
      return h(
        'tr',
        {},
        h('td', { 'data-label': 'Ảnh' }, picture(item.imageUrl, 'menu-thumb') ?? h('span', { class: 'cell-sub' }, 'Không ảnh')),
        h('td', { 'data-label': 'Món', class: 'cell-name' }, item.name),
        h('td', { 'data-label': 'Giá', class: 'cell-num' }, formatVnd(item.priceVnd)),
        h('td', { 'data-label': 'Nhóm' }, item.categoryActive ? item.categoryName : `${item.categoryName} (ngừng dùng)`),
        h('td', { 'data-label': 'Trạng thái' }, item.status === 'VISIBLE' ? badge('Đang hiện', 'ok') : badge('Đang ẩn', 'neutral')),
        h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
      );
    });
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Thực đơn của quán'), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  #showItem(item: MenuItem): void {
    const close = secondary('Đóng');
    this.#handle?.close();
    this.#handle = openDialog({
      host: this.host.dialogHost,
      title: item.name,
      onDismiss: () => this.#closeDialog(),
      body: [
        picture(item.imageUrl, 'menu-photo') ?? h('p', { class: 'hint' }, 'Món chưa có ảnh.'),
        definition([
          ['Giá', formatVnd(item.priceVnd)],
          ['Nhóm', item.categoryActive ? item.categoryName : `${item.categoryName} (ngừng dùng)`],
          ['Trạng thái', item.status === 'VISIBLE' ? 'Đang hiện cho khách' : 'Đang ẩn: chỉ quản trị viên và chủ quán thấy'],
          ['Cập nhật lúc', formatDateTime(item.updatedAt)],
        ]),
        h('p', { class: 'hint' }, 'Chủ quán sửa món trong 11Food. Web Admin không sửa món, giá hay ảnh.'),
      ],
      actions: [close],
    });
    close.addEventListener('click', () => this.#closeDialog());
  }

  #closeDialog(): void {
    if (this.#locked) {
      return;
    }
    this.#handle?.close();
    this.#handle = undefined;
  }

  async #showPreview(): Promise<void> {
    const read = await this.host.source.preview(this.id);
    if (this.#disposed) {
      return;
    }
    const close = secondary('Đóng');
    close.addEventListener('click', () => this.#closeDialog());
    let body: HTMLElement[];
    if (read.kind === 'ready') {
      body = this.#previewBody(read.preview);
    } else if (read.kind === 'not-found') {
      body = [emptyPanel('Không tìm thấy quán', 'Quán này không còn tồn tại.')];
    } else if (read.kind === 'not-wired') {
      body = [notWiredPanel(read.reason)];
    } else {
      handleFailure(this.host, read.failure);
      body = [failurePanel(read.failure, { login: this.host.login, home: this.host.home }, read.retryAfterSec)];
    }
    this.#handle?.close();
    this.#handle = openDialog({ host: this.host.dialogHost, title: 'Xem như khách', onDismiss: () => this.#closeDialog(), body, actions: [close] });
  }

  #previewBody(preview: Preview): HTMLElement[] {
    if (!preview.visible) {
      return [
        h('p', { class: 'message message-warning' }, `Khách hiện không xem được quán này (${AVAILABILITY_LABEL[preview.reason].label.toLowerCase()}). Quán không xuất hiện trong tìm kiếm và không nhận đơn mới.`),
      ];
    }
    const lines = weekLines(preview.hours);
    return [
      h('p', { class: 'hint' }, 'Đây là những gì khách thấy: chỉ món đang hiện, không có số điện thoại, Zalo, Facebook hay tọa độ.'),
      ...[picture(preview.logoUrl, 'shop-logo')].filter((node): node is HTMLElement => node !== undefined),
      h('h3', { class: 'subtitle' }, preview.name),
      h('p', {}, preview.addressText),
      h('p', {}, availabilityBadge(preview.availability)),
      h('ul', { class: 'hint-list' }, ...lines.map((line) => h('li', {}, `${line.label}: ${line.intervals.length === 0 ? 'Nghỉ' : line.intervals.join(', ')}`))),
      ...(preview.categories.length === 0
        ? [emptyPanel('Chưa có món để khách xem', 'Quán chưa có món nào đang hiện.')]
        : preview.categories.map((category) =>
            h(
              'section',
              { class: 'detail-block detail-block-quiet' },
              h('h4', { class: 'subtitle' }, category.name),
              h('ul', { class: 'plain-list preview-items' }, ...category.items.map((item) => h('li', { class: 'preview-item' }, picture(item.imageUrl, 'menu-thumb'), h('span', { class: 'row-name' }, item.name), h('span', { class: 'cell-num' }, formatVnd(item.priceVnd))))),
            ),
          )),
    ];
  }

  // -- tab D: history

  async #loadHistory(token: number): Promise<void> {
    const read = await this.host.source.history(this.id, this.#historyPage);
    if (this.#disposed || token !== this.#tabToken || this.#tab !== 'history') {
      return;
    }
    if (read.kind !== 'ready') {
      this.#panel.replaceChildren(this.#tabProblem(read, () => void this.#loadTab()));
      return;
    }
    const { entries, total } = read.page;
    const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    if (entries.length === 0 && total > 0 && this.#historyPage > pages) {
      this.#historyPage = pages;
      void this.#loadTab();
      return;
    }
    this.#panel.replaceChildren(
      h('p', { class: 'hint' }, 'Mỗi dòng ghi người thao tác, thời gian, lý do (nếu có), thay đổi trước/sau và phiên bản của quán sau thao tác. Thay đổi hồ sơ, lịch của chủ quán chỉ ghi nhận việc có thay đổi và phiên bản, không ghi nội dung.'),
      entries.length === 0
        ? emptyPanel('Chưa có lịch sử quản lý', 'Chưa có thao tác nào được ghi nhận cho quán này.')
        : h('div', {}, h('ol', { class: 'timeline' }, ...entries.map((entry) => this.#historyItem(entry))), pager(total, this.#historyPage, HISTORY_PAGE_SIZE, 'dòng', (page) => {
            this.#historyPage = page;
            void this.#loadTab();
          })),
    );
  }

  #historyItem(entry: HistoryEntry): HTMLElement {
    const who = entry.actor.type === 'OWNER' ? 'Chủ quán' : entry.actor.type === 'SYSTEM' ? `Hệ thống${entry.actor.name === null ? '' : ` · ${entry.actor.name}`}` : `Quản trị viên${entry.actor.name === null ? '' : ` · ${entry.actor.name}`}`;
    const change = entry.fromStatus !== null && entry.toStatus !== null ? `${PROFILE_STATUS[entry.fromStatus as keyof typeof PROFILE_STATUS]?.label ?? entry.fromStatus} → ${PROFILE_STATUS[entry.toStatus as keyof typeof PROFILE_STATUS]?.label ?? entry.toStatus}` : null;
    return h(
      'li',
      { class: 'timeline-item' },
      h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
      h(
        'div',
        {},
        h('p', { class: 'timeline-label' }, HISTORY_ACTION_LABEL[entry.action] ?? entry.action),
        h('p', { class: 'timeline-meta' }, `${formatDateTime(entry.at)} · ${who}${entry.version === null ? '' : ` · phiên bản ${String(entry.version)}`}`),
        change === null ? undefined : h('p', { class: 'timeline-meta' }, `Trước/sau: ${change}`),
        entry.reason === null ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${entry.reason}`),
      ),
    );
  }

  #tabProblem(read: Exclude<Awaited<ReturnType<ShopSource['menu']>>, { kind: 'ready' }>, retry: () => void): HTMLElement {
    if (read.kind === 'not-wired') {
      return notWiredPanel(read.reason);
    }
    if (read.kind === 'not-found') {
      return emptyPanel('Không tìm thấy quán', 'Quán này không tồn tại hoặc bạn không có quyền xem.');
    }
    handleFailure(this.host, read.failure);
    return failurePanel(read.failure, { retry, login: this.host.login, home: this.host.home }, read.retryAfterSec);
  }

  // -- disable / enable

  #ask(name: ShopCommandName): void {
    const shop = this.#shop;
    if (shop === undefined || this.#locked) {
      return;
    }
    const spec = COMMAND_TEXT[name];
    const flow = new StatusFlow(this.host.source, this.host.newKey, shop.id, name, shop.version);
    this.#flow = flow;
    const reasonInput = h('textarea', { id: 'shop-reason', class: 'textarea', rows: '3', maxlength: String(REASON_MAX), 'aria-describedby': 'shop-reason-error', 'aria-label': 'Lý do' });
    const counter = h('p', { class: 'hint hint-end' }, `0/${String(REASON_MAX)}`);
    const reasonError = message('error', 'shop-reason-error');
    const status = message('error', 'shop-command-status');
    const cancel = secondary('Hủy');
    const confirm = spec.danger ? h('button', { type: 'button', class: 'btn btn-danger-solid' }, spec.confirm) : primary(spec.confirm, 'button');
    const warning = h('div', {});
    const drawWarning = (current: ShopDetail): void => {
      const lines: HTMLElement[] = [];
      if (name === 'disable') {
        lines.push(
          h('p', { class: 'dialog-warning dialog-warning-danger', role: 'note' }, icon('alert', 18), h('span', {}, 'Quán sẽ ngừng hiển thị công khai và ngừng nhận đơn mới. Dữ liệu hồ sơ, lịch, thực đơn được giữ; tài khoản chủ quán không bị khóa.')),
          current.disableBlocked
            ? h('p', { class: 'dialog-warning dialog-warning-danger', role: 'alert' }, icon('alert', 18), h('span', {}, `${OPEN_WORK_BLOCKED} ${OPEN_WORK_COUNTS(current.ordersOpen, current.ordersPendingConfirmation, current.ordersPreparing, current.activeDeliveries)}`))
            : h('p', { class: 'dialog-warning dialog-warning-info', role: 'note' }, icon('info', 18), h('span', {}, 'Hiện không còn đơn hoặc giao hàng chưa kết thúc. Máy chủ kiểm tra lại khi ghi.')),
        );
      } else {
        lines.push(h('p', { class: 'dialog-warning dialog-warning-info', role: 'note' }, icon('info', 18), h('span', {}, 'Quán hoạt động trở lại khi hồ sơ còn đủ điều kiện. Việc mở hay đóng vẫn theo lịch hoạt động, không bị ép mở.')));
        for (const blocker of current.enableBlockers) {
          lines.push(h('p', { class: 'dialog-warning dialog-warning-danger', role: 'note' }, icon('alert', 18), h('span', {}, ENABLE_BLOCKER_LABEL[blocker] ?? blocker)));
        }
      }
      warning.replaceChildren(...lines);
    };
    let changedElsewhere = false;
    const paint = (): void => {
      const view = flow.view;
      const locked = flow.locked;
      reasonInput.disabled = locked || view.phase === 'conflict';
      cancel.disabled = locked;
      confirm.disabled = view.phase === 'sending' || (name === 'enable' && (this.#shop?.enableBlockers.length ?? 0) > 0 && view.phase !== 'conflict') || (name === 'disable' && this.#shop?.disableBlocked === true && view.phase !== 'conflict') || changedElsewhere;
      confirm.setAttribute('aria-busy', String(view.phase === 'sending'));
      confirm.textContent = view.phase === 'sending' ? 'Đang gửi…' : view.phase === 'unknown' ? 'Thử lại' : view.phase === 'conflict' ? 'Đọc trạng thái mới' : spec.confirm;
      setMessage(reasonError, view.reasonError ?? undefined);
      status.className = `message message-${view.phase === 'unknown' || view.phase === 'conflict' ? 'warning' : 'error'}`;
      setMessage(status, view.message ?? undefined);
      this.#refreshLocks();
    };
    reasonInput.addEventListener('input', () => {
      flow.typed(reasonInput.value);
      counter.textContent = `${String([...reasonInput.value].length)}/${String(REASON_MAX)}`;
    });
    const refreshAfterConflict = async (): Promise<void> => {
      confirm.disabled = true;
      confirm.textContent = 'Đang đọc…';
      const fresh = await this.#read();
      if (this.#disposed) {
        return;
      }
      if (fresh === undefined) {
        // The read failed (or the shop is gone): the reason stays, the person may try again.
        confirm.disabled = false;
        confirm.textContent = 'Đọc trạng thái mới';
        setMessage(status, 'Chưa đọc được trạng thái mới. Hãy thử lại.');
        return;
      }
      this.#shop = fresh;
      this.#draw(fresh);
      void this.#loadTab();
      flow.refreshed(fresh.version);
      drawWarning(fresh);
      changedElsewhere = !fresh.actions.includes(name);
      paint();
      if (changedElsewhere) {
        setMessage(status, 'Trạng thái quán đã thay đổi nên thao tác này không còn phù hợp. Đóng hộp thoại để xem trạng thái hiện tại.');
      }
    };
    const submit = async (): Promise<void> => {
      if (flow.view.phase === 'conflict') {
        await refreshAfterConflict();
        return;
      }
      flow.typed(reasonInput.value);
      const pending = flow.submit();
      paint();
      const result = await pending;
      if (this.#disposed) {
        return;
      }
      if (result?.kind === 'ok') {
        this.#flow = undefined;
        this.#refreshLocks();
        this.#handle?.close();
        this.#handle = undefined;
        const fresh = await this.#read();
        if (fresh !== undefined) {
          this.#shop = fresh;
          setMessage(this.#notice, name === 'disable' ? 'Đã vô hiệu hóa quán.' : 'Đã kích hoạt lại quán.');
          this.#draw(fresh);
          void this.#loadTab();
        }
        return;
      }
      if (result?.kind === 'refused' && result.code === 'SHOP_HAS_OPEN_WORK') {
        // The popup's figures were stale: read the shop again so the page and the popup show what blocks it now. Nothing was changed.
        const fresh = await this.#read();
        if (fresh !== undefined && !this.#disposed) {
          this.#shop = fresh;
          this.#draw(fresh);
          void this.#loadTab();
          drawWarning(fresh);
        }
        paint();
        return;
      }
      if (result?.kind === 'session-expired') {
        this.#refreshLocks();
        this.host.onSessionLost();
        return;
      }
      if (result?.kind === 'forbidden') {
        this.host.onForbidden();
        this.#flow = undefined;
        this.#refreshLocks();
        this.#handle?.close();
        this.#handle = undefined;
        void this.load();
        return;
      }
      paint();
    };
    confirm.addEventListener('click', () => void submit());
    cancel.addEventListener('click', () => {
      if (flow.dismiss()) {
        this.#flow = undefined;
        this.#refreshLocks();
        this.#handle?.close();
        this.#handle = undefined;
      }
    });
    drawWarning(shop);
    this.#handle?.close();
    this.#handle = openDialog({
      host: this.host.dialogHost,
      title: spec.title,
      description: `${shop.name} · mã ${shop.code}`,
      onDismiss: () => {
        if (flow.dismiss()) {
          this.#flow = undefined;
          this.#refreshLocks();
          this.#handle?.close();
          this.#handle = undefined;
        }
      },
      body: [warning, h('div', { class: 'field' }, h('label', { for: 'shop-reason', class: 'label' }, 'Lý do (bắt buộc, tối đa 500 ký tự)'), reasonInput, counter, reasonError), status],
      actions: [cancel, confirm],
    });
    paint();
  }

  /** While a write may be running, the page behind the popup cannot start another action, leave, or reload. */
  #refreshLocks(): void {
    const locked = this.#locked;
    for (const control of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.tabs button, .detail-actions button, .toolbar button, .toolbar select, .toolbar input, .pager button'))) {
      control.disabled = locked;
    }
    for (const link of Array.from(this.root.querySelectorAll('a.table-link'))) {
      if (locked) {
        link.setAttribute('aria-disabled', 'true');
      } else {
        link.removeAttribute('aria-disabled');
      }
    }
    if (locked) {
      window.addEventListener('beforeunload', this.#warn);
    } else {
      window.removeEventListener('beforeunload', this.#warn);
    }
  }
}

