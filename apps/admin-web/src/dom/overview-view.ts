import { customRangeError, Metric, MetricLink, notReadyText, Overview, OVERVIEW_RANGE_LABEL, OVERVIEW_RANGES, OverviewRange, OverviewSource, SuccessRate, vietnamToday } from '../core/overview.js';
import { formatVnd } from '../core/deliveries.js';
import { h, primary, secondary } from './dom.js';
import { icon } from './icons.js';
import { failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Tổng quan › Điều hành" (M12-A). It draws what the server said and nothing else: a figure is a number only when its status is OK; otherwise the card
// says why there is no number ("—" with the reason), so a failed load, a missing right and an unbuilt module can never look like 0. Period figures and
// current-state figures are separate sections with their own labels, and the time of the read is always shown. Clicking a figure opens the list the
// number was counted from (the server gives the link and the list answers with the same filter). Every node is created with createElement/textContent.

export interface OverviewHost {
  readonly source: OverviewSource;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly open: (link: MetricLink) => void;
  /** "Danh sách hồ sơ đang chờ": the page that lists the files behind the to-do figures (Vận hành › Thông báo › Việc cần xử lý). */
  readonly openQueue: () => void;
  /** The wall clock, for the "no later than today" check of a custom range (the server checks again on its own clock). */
  readonly now?: () => number;
}

const VIETNAM = 'Asia/Ho_Chi_Minh';

/** dd/MM/yyyy HH:mm:ss on the Vietnam clock, whatever the browser's own zone is. */
export function formatVietnamTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: VIETNAM, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** `YYYY-MM-DD` as dd/MM/yyyy (no zone arithmetic: it is already a Vietnam calendar day). */
export function formatDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match === null ? day : `${match[3]}/${match[2]}/${match[1]}`;
}

type Format = 'count' | 'vnd' | 'signed-vnd';

function formatValue(value: number, format: Format): string {
  switch (format) {
    case 'vnd':
      return formatVnd(value);
    case 'signed-vnd':
      return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatVnd(Math.abs(value))}`;
    default:
      return value.toLocaleString('vi-VN');
  }
}

interface CardSpec {
  readonly label: string;
  readonly metric: Metric | undefined;
  readonly format?: Format;
  readonly note?: string;
  readonly tone?: 'wait' | 'ok' | 'lock' | 'neutral';
}

const TODO_LABEL: Record<string, string> = {
  shipper_profiles_pending: 'Hồ sơ shipper chờ duyệt',
  shop_profiles_pending: 'Hồ sơ quán chờ duyệt',
  topups_pending: 'Yêu cầu nạp tiền chờ xử lý',
  withdrawals_pending: 'Yêu cầu rút tiền chờ xử lý',
  deliveries_stopped: 'Delivery đã ngừng tìm shipper, chưa gọi lại',
  custody_open: 'Giao thất bại, hàng chưa xử lý xong',
  complaints_unhandled: 'Phản ánh chưa xử lý',
};
const TODO_ORDER = ['shipper_profiles_pending', 'shop_profiles_pending', 'topups_pending', 'withdrawals_pending', 'deliveries_stopped', 'custody_open', 'complaints_unhandled'];

export class OverviewView {
  readonly #body: HTMLElement;
  readonly #custom: HTMLElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #customError: HTMLElement;
  readonly #buttons = new Map<OverviewRange, HTMLButtonElement>();
  #range: OverviewRange = 'today';
  #latest = 0;
  #disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: OverviewHost,
  ) {
    this.#body = h('div', { class: 'ov-body', 'aria-live': 'polite' });
    this.#from = h('input', { id: 'overview-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'overview-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#customError = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const apply = primary('Áp dụng', 'button');
    apply.classList.add('btn-inline');
    apply.addEventListener('click', () => this.#applyCustom());
    this.#custom = h('div', { class: 'toolbar toolbar-filters ov-custom', hidden: true }, this.#from, this.#to, apply);
    const group = h('div', { class: 'ov-ranges', role: 'group', 'aria-label': 'Khoảng thời gian' });
    for (const range of OVERVIEW_RANGES) {
      const button = h('button', { type: 'button', class: 'ov-range', 'aria-pressed': String(range === this.#range) }, OVERVIEW_RANGE_LABEL[range]);
      button.addEventListener('click', () => this.#select(range));
      this.#buttons.set(range, button);
      group.append(button);
    }
    const refresh = secondary('Làm mới');
    refresh.prepend(icon('refresh', 18));
    refresh.classList.add('btn-inline');
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'overview-title' },
        h(
          'header',
          { class: 'page-head' },
          h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'overview-title' }, 'Điều hành'), h('p', { class: 'lead lead-last' }, 'Số liệu trong kỳ và tình hình hiện tại của hệ thống. Bấm vào một con số để mở danh sách tạo ra con số đó. Mốc thời gian theo giờ Việt Nam.')),
        ),
        h('div', { class: 'toolbar ov-toolbar' }, group, refresh),
        this.#custom,
        this.#customError,
        this.#body,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
  }

  #select(range: OverviewRange): void {
    this.#range = range;
    for (const [value, button] of this.#buttons) {
      button.setAttribute('aria-pressed', String(value === range));
    }
    this.#custom.hidden = range !== 'custom';
    this.#customError.hidden = true;
    if (range === 'custom') {
      const today = vietnamToday((this.host.now ?? Date.now)());
      if (this.#to.value === '') {
        this.#to.value = today;
      }
      if (this.#from.value === '') {
        this.#from.value = today;
      }
      this.#from.max = today;
      this.#to.max = today;
      return;
    }
    void this.load();
  }

  #applyCustom(): void {
    const error = customRangeError(this.#from.value, this.#to.value, (this.host.now ?? Date.now)());
    this.#customError.textContent = error ?? '';
    this.#customError.hidden = error === undefined;
    if (error === undefined) {
      void this.load();
    }
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#body.setAttribute('aria-busy', 'true');
    this.#body.replaceChildren(skeleton(4));
    const read = await this.host.source.read(this.#range === 'custom' ? { range: 'custom', from: this.#from.value, to: this.#to.value } : { range: this.#range });
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    this.#body.removeAttribute('aria-busy');
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason));
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
    this.#body.replaceChildren(...this.#render(read.overview));
  }

  #render(o: Overview): HTMLElement[] {
    const metric = (group: string, key: string): Metric | undefined => o.groups[group]?.metrics[key];
    const period = o.period.fromDay === o.period.toDay ? formatDay(o.period.fromDay) : `${formatDay(o.period.fromDay)} – ${formatDay(o.period.toDay)}`;
    const stamp = h('p', { class: 'ov-stamp', id: 'overview-stamp' }, `Cập nhật lúc ${formatVietnamTime(o.generatedAt)} (giờ Việt Nam)`);
    const periodCards: CardSpec[] = [
      { label: 'Order phát sinh', metric: metric('orders', 'created') },
      { label: 'Delivery tạo mới', metric: metric('deliveries_period', 'created'), note: 'Theo ngày tạo' },
      { label: 'Giao thành công', metric: metric('deliveries_period', 'completed'), note: 'Theo ngày kết thúc', tone: 'ok' },
      { label: 'Giao thất bại', metric: metric('deliveries_period', 'failed'), note: 'Theo ngày kết thúc', tone: 'lock' },
      { label: 'Hoa hồng đã thu', metric: metric('money_period', 'commission_vnd'), format: 'vnd', note: 'Theo ngày ghi sổ cái' },
      { label: 'Điều chỉnh (ròng)', metric: metric('money_period', 'adjustment_net_vnd'), format: 'signed-vnd', note: 'Theo ngày ghi sổ cái' },
      { label: 'Nạp ví đã duyệt', metric: metric('money_period', 'topup_vnd'), format: 'vnd', note: 'Tiền nạp không phải doanh thu' },
    ];
    const currentCards: CardSpec[] = [
      { label: 'Order chờ xác nhận', metric: metric('orders', 'awaiting_confirmation') },
      { label: 'Đang tìm shipper', metric: metric('deliveries_now', 'searching'), tone: 'wait' },
      { label: 'Chờ lấy hàng', metric: metric('deliveries_now', 'waiting_pickup'), tone: 'wait' },
      { label: 'Đang giao', metric: metric('deliveries_now', 'delivering'), tone: 'ok' },
      { label: 'Quán đang nhận đơn', metric: metric('partners_now', 'shops_online') },
      { label: 'Shipper bật nhận đơn', metric: metric('partners_now', 'shippers_accepting') },
      { label: 'Shipper đủ điều kiện nhận', metric: metric('partners_now', 'shippers_eligible'), note: 'Điều kiện chung; khoảng cách xét theo từng đơn' },
      { label: 'Nạp chờ xử lý', metric: metric('money_now', 'topup_pending'), tone: 'wait' },
      { label: 'Rút chờ xử lý', metric: metric('money_now', 'withdrawal_pending'), tone: 'wait' },
      { label: 'Tổng số dư ví', metric: metric('money_now', 'wallet_balance_vnd'), format: 'vnd' },
      { label: 'Đang giữ (hold)', metric: metric('money_now', 'wallet_held_vnd'), format: 'vnd' },
      { label: 'Khả dụng', metric: metric('money_now', 'wallet_available_vnd'), format: 'vnd' },
    ];
    return [
      stamp,
      h(
        'section',
        { class: 'ov-section', 'aria-labelledby': 'ov-period-title' },
        h('h2', { class: 'subtitle', id: 'ov-period-title' }, 'Phát sinh trong kỳ'),
        h('p', { class: 'ov-scope' }, `Kỳ: ${period}. Chỉ tính những gì xảy ra trong kỳ, theo mốc ghi ở từng ô.`),
        h('div', { class: 'ov-grid' }, ...periodCards.map((card) => this.#card(card)), this.#rateCard(o.successRate, metric('deliveries_period', 'completed'))),
      ),
      h(
        'section',
        { class: 'ov-section', 'aria-labelledby': 'ov-now-title' },
        h('h2', { class: 'subtitle', id: 'ov-now-title' }, 'Trạng thái hiện tại'),
        h('p', { class: 'ov-scope' }, 'Tình hình tại thời điểm cập nhật, không phụ thuộc kỳ đã chọn.'),
        h('div', { class: 'ov-grid' }, ...currentCards.map((card) => this.#card(card))),
      ),
      this.#todo(o),
    ];
  }

  #card(spec: CardSpec): HTMLElement {
    const metric = spec.metric;
    const link = metric?.status === 'OK' ? metric.link : undefined;
    let value: string;
    let reason: string | undefined;
    switch (metric?.status) {
      case 'OK':
        value = formatValue(metric.value, spec.format ?? 'count');
        break;
      case 'FORBIDDEN':
        value = '—';
        reason = 'Bạn không có quyền xem số này';
        break;
      case 'NOT_READY':
        value = '—';
        reason = notReadyText(metric.reason);
        break;
      default:
        value = '—';
        reason = 'Không tải được số này';
    }
    const tone = metric?.status === 'OK' ? spec.tone ?? 'neutral' : 'muted';
    const children = [
      h('span', { class: 'ov-label' }, spec.label),
      h('span', { class: 'ov-value', ...(metric?.status === 'OK' ? {} : { 'aria-label': `${spec.label}: không có số liệu` }) }, value),
      reason === undefined ? (spec.note === undefined ? undefined : h('span', { class: 'ov-note' }, spec.note)) : h('span', { class: 'ov-reason' }, reason),
    ];
    if (link === undefined) {
      return h('div', { class: `ov-card ov-${tone}` }, ...children);
    }
    const button = h('button', { type: 'button', class: `ov-card ov-link ov-${tone}`, 'aria-label': `${spec.label}: ${value}. Mở danh sách` }, ...children);
    button.addEventListener('click', () => this.host.open(link));
    return button;
  }

  #rateCard(rate: SuccessRate, completed: Metric | undefined): HTMLElement {
    if ('status' in rate) {
      return this.#card({ label: 'Tỷ lệ giao thành công', metric: rate.status === 'NOT_READY' ? { status: 'NOT_READY', reason: '' } : { status: rate.status } });
    }
    const percent = rate.denominator === 0 ? '—' : `${(Math.round((rate.numerator / rate.denominator) * 1000) / 10).toLocaleString('vi-VN')}%`;
    const link = completed?.status === 'OK' ? completed.link : undefined;
    const children = [
      h('span', { class: 'ov-label' }, 'Tỷ lệ giao thành công'),
      h('span', { class: 'ov-value' }, percent),
      h('span', { class: 'ov-note' }, rate.denominator === 0 ? 'Chưa có delivery kết thúc trong kỳ' : `${rate.numerator.toLocaleString('vi-VN')} thành công / ${rate.denominator.toLocaleString('vi-VN')} đã kết thúc (thành công + thất bại)`),
    ];
    if (link === undefined) {
      return h('div', { class: 'ov-card ov-neutral' }, ...children);
    }
    const button = h('button', { type: 'button', class: 'ov-card ov-link ov-neutral', 'aria-label': `Tỷ lệ giao thành công: ${percent}. Mở danh sách giao thành công` }, ...children);
    button.addEventListener('click', () => this.host.open(link));
    return button;
  }

  #todo(o: Overview): HTMLElement {
    const byKey = new Map(o.todo.map((item) => [item.key, item.metric]));
    const rows = TODO_ORDER.map((key) => {
      const metric = byKey.get(key);
      const label = TODO_LABEL[key] ?? key;
      let status: HTMLElement;
      let action: HTMLElement | undefined;
      switch (metric?.status) {
        case 'OK': {
          status = h('span', { class: `ov-todo-count${metric.value > 0 ? ' ov-todo-open' : ''}` }, metric.value.toLocaleString('vi-VN'));
          const link = metric.link;
          if (link !== undefined) {
            const open = secondary('Mở danh sách');
            open.classList.add('btn-inline');
            open.setAttribute('aria-label', `${label}: ${String(metric.value)}. Mở danh sách`);
            open.addEventListener('click', () => this.host.open(link));
            action = open;
          }
          break;
        }
        case 'FORBIDDEN':
          status = h('span', { class: 'ov-reason' }, 'Bạn không có quyền xem mục này');
          break;
        case 'NOT_READY':
          status = h('span', { class: 'ov-reason' }, notReadyText(metric.reason));
          break;
        default:
          status = h('span', { class: 'ov-reason' }, 'Không tải được mục này');
      }
      return h('li', { class: 'ov-todo-row' }, h('span', { class: 'ov-todo-label' }, label), status, action);
    });
    const files = secondary('Xem danh sách hồ sơ đang chờ');
    files.classList.add('btn-inline');
    files.addEventListener('click', () => this.host.openQueue());
    return h('section', { class: 'ov-section', 'aria-labelledby': 'ov-todo-title' }, h('h2', { class: 'subtitle', id: 'ov-todo-title' }, 'Việc cần xử lý'), h('ul', { class: 'ov-todo' }, ...rows), h('p', {}, files));
  }
}
