import {
  CHANNEL_TEXT,
  ConfigSaveResult,
  ChannelRecord,
  NOTIFICATION_APP_LABEL,
  NOTIFICATION_KIND_LABEL,
  NOTIFICATION_KINDS,
  NOTIFICATION_PAGE_SIZE,
  NotificationConfig,
  NotificationDetail,
  NotificationRow,
  NotificationSource,
  RETENTION_TEXT,
  SEND_STATUS_LABEL,
  SEND_STATUSES,
  SendStatus,
  WorkQueue,
} from '../core/notifications.js';
import { ActionQueueHost, ActionQueuePanel } from './action-queue-view.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Thông báo" (M08.06): three tabs, "Việc cần xử lý", "Tra cứu thông báo" and "Cấu hình". It draws what the server said and sends one
// request per click. There is NO control that sends, resends or broadcasts a notification. "Đã gửi" is the push service's acceptance, never a read or a display on
// the phone; a reason for "not sent" is shown only when the row carries evidence for it. The business timers (5 / 15 / 30 minutes, a pickup reminder every
// 5 minutes) are M07's and are drawn read-only; only SYSTEM edits the settings (the backend decides again). Every node is created with createElement/textContent.

export interface NotificationHost {
  readonly source: NotificationSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** "Xem đơn giao": the delivery pages decide the right to read again. */
  readonly openDeliveries: () => void;
  /** The files behind "Việc cần xử lý" (#216): read-only; a row opens the screen that owns the file. */
  readonly actionQueue: ActionQueueHost;
  readonly canEdit: boolean;
}

type Tab = 'queue' | 'search' | 'config';
const TABS: readonly (readonly [Tab, string])[] = [
  ['queue', 'Việc cần xử lý'],
  ['search', 'Tra cứu thông báo'],
  ['config', 'Cấu hình'],
];
const SEARCH_PAUSE_MS = 300;

function badge(label: string, tone: 'ok' | 'wait' | 'lock' | 'neutral'): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

/** Status as the design table words it. A push that is still waiting after a failed attempt is "Chờ thử lại". */
export function statusBadge(status: SendStatus | null, expired: boolean, attempts: number): HTMLElement {
  if (status === null) {
    return badge('Chưa gửi', 'neutral');
  }
  if (status === 'SENT') {
    return badge(SEND_STATUS_LABEL.SENT, 'ok');
  }
  if (status === 'PENDING') {
    return badge(attempts > 0 ? SEND_STATUS_LABEL.PENDING : 'Đang chờ gửi', 'wait');
  }
  if (status === 'FAILED') {
    return badge(SEND_STATUS_LABEL.FAILED, 'lock');
  }
  return badge(status === 'EXPIRED' || expired ? SEND_STATUS_LABEL.EXPIRED : SEND_STATUS_LABEL.SKIPPED, 'neutral');
}

const CHANNEL_STATUS_TEXT: Record<string, string> = { STORED: 'Đã lưu trong hộp thông báo', PENDING: 'Chờ gửi', SENDING: 'Đang gửi', SENT: 'Đã gửi (dịch vụ đẩy đã nhận)', FAILED: 'Gửi lỗi', EXPIRED: 'Hết hiệu lực, không gửi nữa', SKIPPED: 'Không gửi' };

function channelBlock(channel: ChannelRecord): HTMLElement {
  const rows: Array<readonly [string, string | HTMLElement]> = [
    ['Kênh', channel.channel === 'APP' ? 'App (hộp thông báo)' : 'Push điện thoại'],
    ['Trạng thái', CHANNEL_STATUS_TEXT[channel.status] ?? channel.status],
    ['Tạo lúc', channel.at === null ? '—' : formatDateTime(channel.at)],
  ];
  if (channel.channel === 'PUSH') {
    rows.push(['Số lần thử', String(channel.attempts)]);
    if (channel.lastAttemptAt !== null) {
      rows.push(['Lần thử cuối', formatDateTime(channel.lastAttemptAt)]);
    }
    if (channel.sentAt !== null) {
      rows.push(['Gửi lúc', formatDateTime(channel.sentAt)]);
    }
    if (channel.nextAttemptAt !== null) {
      rows.push(['Thử lại lúc', formatDateTime(channel.nextAttemptAt)]);
    }
    if (channel.expiresAt !== null) {
      rows.push(['Hết hạn gửi', formatDateTime(channel.expiresAt)]);
    }
    // Only a reason the row itself proves: a skip reason, or the provider's own error evidence.
    const why = channel.reasonText ?? channel.evidence;
    if (why !== null) {
      rows.push(['Lý do chưa gửi được', why]);
    }
    if (channel.errorCode !== null) {
      rows.push(['Mã lỗi', channel.errorCode]);
    }
  }
  return h('section', { class: 'detail-block' }, definition(rows));
}

export class NotificationsView {
  readonly #body: HTMLElement;
  readonly #tabs: HTMLElement;
  readonly #drawer: HTMLElement;
  // search tab
  #search: HTMLInputElement | undefined;
  #kind: HTMLSelectElement | undefined;
  #status: HTMLSelectElement | undefined;
  #app: HTMLSelectElement | undefined;
  #from: HTMLInputElement | undefined;
  #to: HTMLInputElement | undefined;
  #results: HTMLElement | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #tab: Tab = 'queue';
  #queuePanel: ActionQueuePanel | undefined;
  #latest = 0;
  #page = 1;
  #disposed = false;
  #openId: string | undefined;
  #config: NotificationConfig | undefined;
  #saving = false;
  #pendingKey: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: NotificationHost,
  ) {
    this.#tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Thông báo' });
    this.#body = h('div', { class: 'tab-body' });
    this.#drawer = h('aside', { class: 'drawer', id: 'notification-drawer', 'aria-label': 'Chi tiết thông báo', hidden: true });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'notification-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'notification-title' }, 'Thông báo'), h('p', { class: 'lead lead-last' }, 'Tra cứu thông báo và việc cần xử lý. “Đã gửi” nghĩa là dịch vụ đẩy đã nhận, không có nghĩa thiết bị đã hiển thị hoặc người dùng đã đọc.'))),
        this.#tabs,
        this.#body,
        this.#drawer,
      ),
    );
    this.#drawTabs();
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#queuePanel?.dispose();
  }

  async load(): Promise<void> {
    await this.#show(this.#tab);
  }

  #drawTabs(): void {
    this.#tabs.replaceChildren(
      ...TABS.map(([id, label]) => {
        const button = h('button', { type: 'button', role: 'tab', class: `tab${id === this.#tab ? ' tab-active' : ''}`, 'aria-selected': String(id === this.#tab), id: `notification-tab-${id}` }, label);
        button.addEventListener('click', () => void this.#show(id));
        return button;
      }),
    );
  }

  async #show(tab: Tab): Promise<void> {
    this.#tab = tab;
    this.#openId = undefined;
    this.#drawer.hidden = true;
    this.#drawer.replaceChildren();
    this.#drawTabs();
    switch (tab) {
      case 'queue':
        return this.#loadQueue();
      case 'search':
        return this.#loadSearch();
      case 'config':
        return this.#loadConfig();
    }
  }

  /** The shared answer to a failed read: session lost / forbidden are told to the shell, everything else is a panel with its own retry. */
  #failed(read: { readonly kind: 'failed'; readonly failure: Parameters<typeof failurePanel>[0]; readonly retryAfterSec?: number }, retry: () => void): HTMLElement {
    if (read.failure === 'session-expired') {
      this.host.onSessionLost();
    } else if (read.failure === 'forbidden') {
      this.host.onForbidden();
    }
    return failurePanel(read.failure, { retry, login: this.host.login, home: this.host.home }, read.retryAfterSec);
  }

  // ---- Việc cần xử lý ------------------------------------------------------------------------------------------------------

  async #loadQueue(): Promise<void> {
    const token = ++this.#latest;
    // The files that wait (#216) and the notification delivery problems are two reads: one failing never hides the other.
    this.#queuePanel?.dispose();
    const panel = new ActionQueuePanel(this.host.actionQueue);
    this.#queuePanel = panel;
    const delivery = h('div', { class: 'queue-delivery' }, skeleton(4));
    this.#body.replaceChildren(panel.element, delivery);
    void panel.load();
    const read = await this.host.source.workQueue();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      delivery.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'failed') {
      delivery.replaceChildren(this.#failed(read, () => void this.#loadQueue()));
    } else {
      delivery.replaceChildren(...this.#queue(read.queue));
    }
  }

  #queue(queue: WorkQueue): HTMLElement[] {
    const tile = (label: string, value: number, tone: string): HTMLElement => h('div', { class: `counter counter-${tone}` }, h('span', { class: 'counter-value' }, String(value)), h('span', { class: 'counter-label' }, label));
    const c = queue.counters;
    const blocks: HTMLElement[] = [
      h(
        'div',
        { class: 'counters', role: 'status', 'aria-label': 'Tổng quan việc cần xử lý' },
        tile('Gửi lỗi (7 ngày)', c.failedPushes, c.failedPushes > 0 ? 'lock' : 'neutral'),
        tile('Đang chậm gửi', c.latePushes, c.latePushes > 0 ? 'wait' : 'neutral'),
        tile('Chưa có thiết bị', c.noDevice, 'neutral'),
        tile('Sự kiện lỗi chưa xử lý', c.deadEvents, c.deadEvents > 0 ? 'lock' : 'neutral'),
        tile('Hàng cần xử lý', c.goodsCases, c.goodsCases > 0 ? 'lock' : 'neutral'),
      ),
    ];
    if (!queue.providerConfigured) {
      blocks.push(h('p', { class: 'message message-warning', role: 'status' }, 'Máy chủ chưa cấu hình dịch vụ đẩy thông báo: thông báo vẫn vào hộp thông báo trong app nhưng chưa có thông báo đẩy nào được gửi.'));
    }
    if (queue.failures.length === 0 && queue.goodsCases.length === 0) {
      blocks.push(emptyPanel('Không có việc cần xử lý', 'Chưa có thông báo nào gửi lỗi hoặc hàng cần xử lý trong phạm vi của bạn.'));
      return blocks;
    }
    if (queue.failures.length > 0) {
      const rows = queue.failures.map((f) => {
        const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': 'Xem chi tiết thông báo' }, 'Xem');
        open.addEventListener('click', () => void this.#openDetail(f.id));
        return h(
          'tr',
          {},
          h('td', { 'data-label': 'Thời gian' }, formatDateTime(f.at)),
          h('td', { 'data-label': 'Loại', class: 'cell-name' }, NOTIFICATION_KIND_LABEL[f.kind]),
          h('td', { 'data-label': 'Ứng dụng' }, NOTIFICATION_APP_LABEL[f.app]),
          h('td', { 'data-label': 'Trạng thái' }, f.status === 'FAILED' ? badge(SEND_STATUS_LABEL.FAILED, 'lock') : badge(SEND_STATUS_LABEL.PENDING, 'wait')),
          h('td', { 'data-label': 'Bằng chứng' }, f.evidence ?? f.errorCode ?? '—'),
          h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
        );
      });
      blocks.push(this.#table('Thông báo gửi lỗi hoặc chậm', ['Thời gian', 'Loại', 'Ứng dụng', 'Trạng thái', 'Bằng chứng', 'Thao tác'], rows));
    }
    if (queue.goodsCases.length > 0) {
      const rows = queue.goodsCases.map((g) =>
        h('tr', {}, h('td', { 'data-label': 'Mã' }, g.code), h('td', { 'data-label': 'Quán', class: 'cell-name' }, g.shopName), h('td', { 'data-label': 'Mở lúc' }, formatDateTime(g.openedAt))),
      );
      const go = secondary('Mở trang Giao hàng');
      go.classList.add('btn-inline');
      go.addEventListener('click', () => this.host.openDeliveries());
      blocks.push(this.#table('Hàng cần xử lý sau giao thất bại', ['Mã', 'Quán', 'Mở lúc'], rows), h('p', {}, go));
    }
    return blocks;
  }

  #table(caption: string, columns: readonly string[], rows: readonly HTMLElement[]): HTMLElement {
    return h(
      'div',
      { class: 'table-card' },
      h('table', { class: 'table' }, h('caption', { class: 'sub-caption' }, caption), h('thead', {}, h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)))), h('tbody', {}, ...rows)),
    );
  }

  // ---- Tra cứu --------------------------------------------------------------------------------------------------------------

  async #loadSearch(): Promise<void> {
    if (this.#search === undefined) {
      this.#search = h('input', { id: 'notification-search', type: 'search', class: 'search-input', placeholder: 'Mã đơn hoặc mã tài khoản', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Mã đơn hoặc tài khoản', maxlength: '64' });
      this.#kind = h('select', { id: 'notification-kind', class: 'select', 'aria-label': 'Loại thông báo' }, ...(['ALL', ...NOTIFICATION_KINDS] as const).map((value) => h('option', { value }, NOTIFICATION_KIND_LABEL[value])));
      this.#status = h('select', { id: 'notification-status', class: 'select', 'aria-label': 'Trạng thái gửi' }, ...(['ALL', ...SEND_STATUSES] as const).map((value) => h('option', { value }, SEND_STATUS_LABEL[value])));
      this.#app = h('select', { id: 'notification-app', class: 'select', 'aria-label': 'Ứng dụng' }, ...(['ALL', 'FOOD', 'SHIP'] as const).map((value) => h('option', { value }, NOTIFICATION_APP_LABEL[value])));
      this.#from = h('input', { id: 'notification-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
      this.#to = h('input', { id: 'notification-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
      this.#results = h('div', { class: 'results' });
      const reload = (): void => {
        this.#page = 1;
        void this.#runSearch();
      };
      this.#search.addEventListener('input', () => {
        this.#page = 1;
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => void this.#runSearch(), SEARCH_PAUSE_MS);
      });
      for (const control of [this.#kind, this.#status, this.#app, this.#from, this.#to]) {
        control.addEventListener('change', reload);
      }
    }
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.#runSearch());
    this.#body.replaceChildren(
      h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#kind as HTMLElement, this.#status as HTMLElement, this.#app as HTMLElement, refresh),
      h('div', { class: 'toolbar toolbar-filters' }, this.#from as HTMLElement, this.#to as HTMLElement),
      this.#results as HTMLElement,
      h('div', { id: 'notification-rules' }),
    );
    await this.#runSearch();
    void this.#drawRules();
  }

  async #runSearch(): Promise<void> {
    const results = this.#results;
    if (results === undefined) {
      return;
    }
    const token = ++this.#latest;
    results.replaceChildren(skeleton());
    const read = await this.host.source.list({
      query: this.#search?.value ?? '',
      kind: NOTIFICATION_KINDS.find((value) => value === this.#kind?.value) ?? 'ALL',
      status: SEND_STATUSES.find((value) => value === this.#status?.value) ?? 'ALL',
      app: (['FOOD', 'SHIP'] as const).find((value) => value === this.#app?.value) ?? 'ALL',
      from: this.#from?.value ?? '',
      to: this.#to?.value ?? '',
      page: this.#page,
    });
    if (this.#disposed || token !== this.#latest || this.#tab !== 'search') {
      return;
    }
    if (read.kind === 'not-wired') {
      results.replaceChildren(notWiredPanel(read.reason));
      return;
    }
    if (read.kind === 'failed') {
      results.replaceChildren(this.#failed(read, () => void this.#runSearch()));
      return;
    }
    if (read.rows.length === 0) {
      const filtered = [this.#search?.value, this.#from?.value, this.#to?.value].some((value) => (value ?? '').trim() !== '') || this.#kind?.value !== 'ALL' || this.#status?.value !== 'ALL' || this.#app?.value !== 'ALL';
      results.replaceChildren(filtered ? emptyPanel('Không tìm thấy thông báo', 'Thử đổi từ khóa hoặc bộ lọc.') : emptyPanel('Chưa có thông báo', 'Thông báo xuất hiện ở đây khi có sự kiện giao hàng, ví hoặc hồ sơ.'));
      return;
    }
    const pages = Math.max(1, Math.ceil(read.total / NOTIFICATION_PAGE_SIZE));
    results.replaceChildren(h('div', {}, this.#table('Danh sách thông báo', ['Thời gian', 'Nội dung', 'Người nhận', 'Kênh', 'Trạng thái', 'Thao tác'], read.rows.map((row) => this.#row(row))), this.#pager(read.total, pages)));
  }

  #row(row: NotificationRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem chi tiết: ${row.title}` }, 'Xem');
    open.addEventListener('click', () => void this.#openDetail(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Thời gian' }, formatDateTime(row.createdAt)),
      h('td', { 'data-label': 'Nội dung', class: 'cell-name' }, h('strong', {}, row.title), h('br'), h('span', { class: 'muted' }, row.body)),
      h('td', { 'data-label': 'Người nhận' }, `${NOTIFICATION_APP_LABEL[row.app]}${row.deliveryCode === null ? '' : ` · ${row.deliveryCode}`}`),
      h('td', { 'data-label': 'Kênh' }, CHANNEL_TEXT),
      h('td', { 'data-label': 'Trạng thái' }, statusBadge(row.pushStatus, row.expired, row.attempts)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  #pager(total: number, pages: number): HTMLElement {
    const from = (this.#page - 1) * NOTIFICATION_PAGE_SIZE + 1;
    const to = Math.min(this.#page * NOTIFICATION_PAGE_SIZE, total);
    const previous = secondary('Trước');
    previous.disabled = this.#page <= 1;
    previous.addEventListener('click', () => {
      this.#page -= 1;
      void this.#runSearch();
    });
    const next = secondary('Sau');
    next.disabled = this.#page >= pages;
    next.addEventListener('click', () => {
      this.#page += 1;
      void this.#runSearch();
    });
    return h(
      'nav',
      { class: 'pager', 'aria-label': 'Phân trang' },
      h('p', { class: 'pager-text', id: 'notification-count' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} thông báo`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(this.#page)}/${String(pages)}`), next),
    );
  }

  /** "Quy tắc đang áp dụng" and "Lưu trữ": read-only, from the server's settings. */
  async #drawRules(): Promise<void> {
    const slot = this.#body.querySelector('#notification-rules');
    if (slot === null) {
      return;
    }
    const read = await this.host.source.config();
    if (this.#disposed || this.#tab !== 'search' || read.kind !== 'ready') {
      return;
    }
    slot.replaceChildren(...this.#rules(read.config));
  }

  #rules(config: NotificationConfig): HTMLElement[] {
    const rule = (label: string, value: string): HTMLElement => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value));
    return [
      h(
        'section',
        { class: 'detail-block', 'aria-label': 'Quy tắc đang áp dụng' },
        h('h3', { class: 'subtitle' }, 'Quy tắc đang áp dụng'),
        h(
          'dl',
          { class: 'kvs' },
          rule('Nhắc tìm', `${config.shopReminderMinutes.join(' / ')} phút`),
          rule('Ngừng tìm', `${String(config.searchStopMinutes)} phút`),
          rule('Nhắc lấy hàng', `mỗi ${String(config.pickupReminderMinutes)} phút`),
        ),
      ),
      h('section', { class: 'detail-block', 'aria-label': 'Lưu trữ' }, h('h3', { class: 'subtitle' }, 'Lưu trữ'), h('p', {}, RETENTION_TEXT(config.visibleDays, config.purgeDays))),
    ];
  }

  // ---- chi tiết -------------------------------------------------------------------------------------------------------------

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

  async #openDetail(id: string): Promise<void> {
    this.#openId = id;
    this.#drawer.hidden = false;
    this.#drawer.replaceChildren(skeleton(3));
    const read = await this.host.source.detail(id);
    if (this.#disposed || this.#openId !== id) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#drawer.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'not-found') {
      this.#drawer.replaceChildren(this.#closeBar('Chi tiết thông báo'), emptyPanel('Không tìm thấy', 'Thông báo này không còn hoặc bạn không có quyền xem.'));
    } else if (read.kind === 'failed') {
      this.#drawer.replaceChildren(this.#closeBar('Chi tiết thông báo'), this.#failed(read, () => void this.#openDetail(id)));
    } else {
      this.#drawer.replaceChildren(...this.#detail(read.detail));
      this.#drawer.focus();
    }
  }

  #detail(d: NotificationDetail): HTMLElement[] {
    const push = d.channels.find((channel) => channel.channel === 'PUSH');
    const blocks: HTMLElement[] = [
      this.#closeBar('Chi tiết thông báo'),
      h('h3', { class: 'subtitle' }, d.title),
      definition([
        ['Loại', NOTIFICATION_KIND_LABEL[d.kind]],
        ['Ứng dụng', NOTIFICATION_APP_LABEL[d.app]],
        ['Người nhận', d.recipientUserId],
        ['Đơn giao', d.target.code ?? '—'],
        ['Tạo lúc', formatDateTime(d.createdAt)],
        ['Đã đọc', d.readAt === null ? 'Chưa' : formatDateTime(d.readAt)],
        ['Hiệu lực đến', d.validUntil === null ? 'Lưu lịch sử' : formatDateTime(d.validUntil)],
        ['Xóa sau', d.deleteAfter === null ? '—' : formatDateTime(d.deleteAfter)],
      ]),
      ...d.channels.map(channelBlock),
      h('p', { class: 'message message-notice', role: 'status' }, d.note),
    ];
    if (push?.status === 'PENDING') {
      blocks.push(h('p', { class: 'message message-notice', role: 'status' }, 'Chỉ gửi lại khi thông báo còn hiệu lực. Hệ thống tự thử lại theo cấu hình; Admin không gửi lại thủ công.'));
    }
    if (d.target.type === 'DELIVERY' && d.target.id !== null) {
      const go = secondary('Xem đơn giao');
      go.classList.add('btn-inline');
      go.addEventListener('click', () => this.host.openDeliveries());
      blocks.push(h('p', {}, go));
    }
    return blocks;
  }

  // ---- Cấu hình -------------------------------------------------------------------------------------------------------------

  async #loadConfig(): Promise<void> {
    const token = ++this.#latest;
    this.#body.replaceChildren(skeleton(4));
    const read = await this.host.source.config();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'failed') {
      this.#body.replaceChildren(this.#failed(read, () => void this.#loadConfig()));
    } else {
      this.#config = read.config;
      this.#drawConfig(read.config);
    }
  }

  #drawConfig(config: NotificationConfig, notice?: string): void {
    const edit = this.host.canEdit;
    const number = (id: string, label: string, value: number, min: number, max: number): [HTMLElement, HTMLInputElement] => {
      const input = h('input', { id, type: 'number', class: 'input', min: String(min), max: String(max), step: '1', value: String(value), ...(edit ? {} : { disabled: true }) });
      return [h('label', { class: 'field', for: id }, h('span', { class: 'field-label' }, label), input), input];
    };
    const toggle = (id: string, label: string, value: boolean): [HTMLElement, HTMLInputElement] => {
      const input = h('input', { id, type: 'checkbox', ...(value ? { checked: true } : {}), ...(edit ? {} : { disabled: true }) });
      return [h('label', { class: 'check', for: id }, input, h('span', {}, label)), input];
    };
    const [pushRow, push] = toggle('cfg-push', 'Bật thông báo đẩy', config.pushEnabled);
    const [soundRow, sound] = toggle('cfg-sound', 'Âm thanh mặc định cho tài khoản chưa chọn', config.defaultSound);
    const [visibleRow, visible] = number('cfg-visible', 'Hiển thị trong hộp thông báo (ngày)', config.visibleDays, 7, 365);
    const [purgeRow, purge] = number('cfg-purge', 'Xóa sau tổng cộng (ngày)', config.purgeDays, 7, 1095);
    const [attemptsRow, attempts] = number('cfg-attempts', 'Số lần thử gửi tối đa', config.retryMaxAttempts, 1, 10);
    const [baseRow, base] = number('cfg-base', 'Chờ giữa các lần thử (giây, nhân đôi mỗi lần)', config.retryBaseSeconds, 5, 3600);
    const error = message('error', 'cfg-error');
    const notices = message('notice', 'cfg-notice');
    setMessage(notices, notice);
    const save = primary('Lưu cấu hình', 'button');
    save.classList.add('btn-inline');
    save.addEventListener('click', () => {
      if (this.#saving) {
        return;
      }
      const request = {
        version: config.version,
        pushEnabled: push.checked,
        defaultSound: sound.checked,
        visibleDays: Number(visible.value),
        purgeDays: Number(purge.value),
        retryMaxAttempts: Number(attempts.value),
        retryBaseSeconds: Number(base.value),
      };
      const inRange = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;
      if (!inRange(request.visibleDays, 7, 365) || !inRange(request.purgeDays, request.visibleDays, 1095) || !inRange(request.retryMaxAttempts, 1, 10) || !inRange(request.retryBaseSeconds, 5, 3600)) {
        setMessage(error, 'Giá trị chưa hợp lệ: hiển thị 7–365 ngày, xóa không sớm hơn thời gian hiển thị (tối đa 1095), thử 1–10 lần, chờ 5–3600 giây.');
        return;
      }
      setMessage(error, undefined);
      void this.#save(request, save, error);
    });
    const timers = h(
      'section',
      { class: 'detail-block', 'aria-label': 'Mốc nhắc chỉ đọc' },
      h('h3', { class: 'subtitle' }, 'Mốc nhắc (chỉ đọc)'),
      definition([
        ['Nhắc quán khi đang tìm', `${config.shopReminderMinutes.join(' và ')} phút`],
        ['Ngừng tìm', `${String(config.searchStopMinutes)} phút`],
        ['Nhắc lấy hàng', `mỗi ${String(config.pickupReminderMinutes)} phút`],
      ]),
      h('p', { class: 'muted' }, 'Các mốc này do quy trình giao hàng quyết định, không chỉnh ở đây.'),
    );
    this.#body.replaceChildren(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Kênh, lưu trữ và thử lại'),
        config.providerConfigured ? undefined : h('p', { class: 'message message-warning', role: 'status' }, 'Máy chủ chưa cấu hình dịch vụ đẩy thông báo: bật kênh đẩy chưa làm thông báo đẩy được gửi.'),
        h('form', { class: 'form', novalidate: true }, pushRow, soundRow, visibleRow, purgeRow, attemptsRow, baseRow, error, notices, edit ? h('div', { class: 'form-actions' }, save) : h('p', { class: 'muted' }, 'Chỉ tài khoản SYSTEM được thay đổi cấu hình.')),
      ),
      timers,
      h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Lưu trữ'), h('p', {}, RETENTION_TEXT(config.visibleDays, config.purgeDays))),
    );
  }

  async #save(request: Omit<Parameters<NotificationSource['saveConfig']>[0], 'key'>, button: HTMLButtonElement, error: HTMLElement): Promise<void> {
    this.#saving = true;
    button.disabled = true;
    // One key per intent: after an unknown outcome the very same request (same key) is sent again.
    const key = this.#pendingKey ?? this.host.newKey();
    this.#pendingKey = key;
    const result: ConfigSaveResult = await this.host.source.saveConfig({ ...request, key });
    this.#saving = false;
    if (this.#disposed) {
      return;
    }
    button.disabled = false;
    switch (result.kind) {
      case 'ok':
        this.#pendingKey = undefined;
        this.#config = result.config;
        this.#drawConfig(result.config, 'Đã lưu cấu hình. Thay đổi áp dụng cho thông báo tạo từ bây giờ.');
        return;
      case 'conflict':
        this.#pendingKey = undefined;
        setMessage(error, 'Cấu hình vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi; hãy tải lại để xem cấu hình hiện tại.');
        return;
      case 'forbidden':
        this.#pendingKey = undefined;
        setMessage(error, 'Tài khoản này không có quyền thay đổi cấu hình.');
        return;
      case 'session-expired':
        this.host.onSessionLost();
        return;
      case 'rate-limited':
        setMessage(error, 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.');
        return;
      case 'invalid':
        this.#pendingKey = undefined;
        setMessage(error, 'Máy chủ từ chối giá trị này. Hãy kiểm tra các giới hạn.');
        return;
      case 'unknown':
        setMessage(error, 'Chưa xác nhận được kết quả. Bấm “Lưu cấu hình” để gửi lại đúng yêu cầu cũ, không tạo thêm thay đổi.');
        return;
      case 'not-wired':
        setMessage(error, 'Chức năng này chưa được nối với máy chủ.');
    }
  }
}
