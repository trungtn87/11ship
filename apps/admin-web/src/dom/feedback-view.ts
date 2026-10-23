import {
  ActionResult,
  AdjustmentRecord,
  COMPLAINT_ACTIONS,
  COMPLAINT_CATEGORIES,
  COMPLAINT_CATEGORY_LABEL,
  COMPLAINT_STATUS_LABEL,
  COMPLAINT_STATUSES,
  ComplaintActionName,
  ComplaintActionRequest,
  ComplaintCounters,
  ComplaintDetail,
  ComplaintRow,
  ComplaintStatus,
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_REFUSAL_MESSAGE,
  FeedbackSource,
  MODERATION_REASON_LABEL,
  MODERATION_REASONS,
  ModerationReason,
  NOTE_MAX,
  REVIEW_KIND_LABEL,
  ReviewCounters,
  ReviewDetail,
  ReviewKind,
  ReviewRow,
  SUBMITTER_LABEL,
  SubmitterRole,
  TEXT_MAX,
} from '../core/feedback.js';
import { formatVnd } from '../core/deliveries.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành › Đánh giá" and "Vận hành › Phản ánh" (M11.03). It draws what the server said and sends one request per click: the pages decide no right
// and no state (the buttons follow the `can` list the server returned for this Admin and this file; the server refuses again whatever is sent). There is no
// control that edits the stars or the text of a rating and none that sets a status. Money is a separate right: its button exists only when the server says
// this Admin holds it. Every node is created with createElement/textContent (no innerHTML). While an action runs its popup is locked, so it cannot be
// sent twice; after an unknown outcome only "Thử lại" (the same Idempotency-Key) is offered. Popups close with "Quay lại", never with a bare "Hủy".

export interface FeedbackHost {
  readonly source: FeedbackSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** Where popups are mounted (the page body by default). */
  readonly dialogHost?: HTMLElement;
}

const SEARCH_PAUSE_MS = 300;

type Tone = 'ok' | 'wait' | 'lock' | 'neutral';
const badge = (label: string, tone: Tone): HTMLElement => h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
const definition = (items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement => h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
const stars = (n: number): HTMLElement => h('span', { class: 'stars', role: 'img', 'aria-label': `${String(n)} trên 5 sao` }, '★'.repeat(n) + '☆'.repeat(5 - n));
const counter = (label: string, value: number, tone: string): HTMLElement => h('div', { class: `counter counter-${tone}` }, h('span', { class: 'counter-value' }, String(value)), h('span', { class: 'counter-label' }, label));

function statusTone(status: ComplaintStatus): Tone {
  return status === 'RESOLVED' ? 'ok' : status === 'CLOSED_NO_ACTION' ? 'neutral' : status === 'PENDING' ? 'lock' : 'wait';
}

function failureText(result: ActionResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Hồ sơ vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem trạng thái hiện tại.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return FEEDBACK_REFUSAL_MESSAGE[result.code] ?? 'Máy chủ từ chối yêu cầu này.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

const clean = (value: string): string => value.normalize('NFC').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[^\S\n]+/gu, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/** Shared shell of both pages: the paging, the drawer, the failure handling. */
abstract class Page {
  protected disposed = false;
  protected latest = 0;
  protected page = 1;
  protected openId: string | undefined;
  protected handle: DialogHandle | undefined;
  protected timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly results: HTMLElement = h('div', { class: 'results' });
  protected readonly counters: HTMLElement;
  protected readonly drawer: HTMLElement;

  constructor(
    protected readonly root: HTMLElement,
    protected readonly host: FeedbackHost,
    counterLabel: string,
    drawerLabel: string,
    drawerId: string,
  ) {
    this.counters = h('div', { class: 'counters', role: 'status', 'aria-label': counterLabel });
    this.drawer = h('aside', { class: 'drawer', id: drawerId, 'aria-label': drawerLabel, hidden: true });
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.handle?.close();
  }

  protected typed(input: HTMLElement[], reload: () => void): void {
    for (const control of input) {
      control.addEventListener(control instanceof HTMLSelectElement || (control instanceof HTMLInputElement && control.type === 'date') ? 'change' : 'input', () => {
        this.page = 1;
        clearTimeout(this.timer);
        this.timer = setTimeout(reload, control instanceof HTMLSelectElement || (control instanceof HTMLInputElement && control.type === 'date') ? 0 : SEARCH_PAUSE_MS);
      });
    }
  }

  protected fail(read: { readonly failure: 'session-expired' | 'forbidden' | string; readonly retryAfterSec?: number }, retry: () => void): HTMLElement {
    if (read.failure === 'session-expired') {
      this.host.onSessionLost();
    } else if (read.failure === 'forbidden') {
      this.host.onForbidden();
    }
    return failurePanel(read.failure as Parameters<typeof failurePanel>[0], { retry, login: this.host.login, home: this.host.home }, read.retryAfterSec);
  }

  protected closeBar(title: string): HTMLElement {
    const close = secondary('Đóng');
    close.classList.add('btn-inline');
    close.addEventListener('click', () => {
      this.openId = undefined;
      this.drawer.hidden = true;
      this.drawer.replaceChildren();
    });
    return h('header', { class: 'drawer-head' }, h('h2', { class: 'subtitle' }, title), close);
  }

  protected pager(total: number, noun: string, load: () => void): HTMLElement {
    const pages = Math.max(1, Math.ceil(total / FEEDBACK_PAGE_SIZE));
    const from = (this.page - 1) * FEEDBACK_PAGE_SIZE + 1;
    const to = Math.min(this.page * FEEDBACK_PAGE_SIZE, total);
    const previous = secondary('Trước');
    previous.disabled = this.page <= 1;
    previous.addEventListener('click', () => {
      this.page -= 1;
      load();
    });
    const next = secondary('Sau');
    next.disabled = this.page >= pages;
    next.addEventListener('click', () => {
      this.page += 1;
      load();
    });
    return h(
      'nav',
      { class: 'pager', 'aria-label': 'Phân trang' },
      h('p', { class: 'pager-text' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} ${noun}`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(this.page)}/${String(pages)}`), next),
    );
  }

  protected table(caption: string, columns: readonly string[], body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
    const head = h('tr', {}, ...columns.map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)));
    const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
    return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  /** The popup of one action. One request in flight; an unknown outcome offers only the same request again. */
  protected dialog(opts: {
    readonly title: string;
    readonly description: string;
    readonly confirm: string;
    readonly fields: readonly Node[];
    /** Validates the inputs and builds the intent, or returns an error text. Called once: a retry reuses the same intent (and key). */
    readonly build: () => { readonly error: string } | { readonly send: () => Promise<ActionResult> };
    readonly onDone: () => Promise<void>;
  }): void {
    const status = message('error', 'feedback-action-status');
    const problem = message('error', 'feedback-action-error');
    const back = secondary('Quay lại');
    const confirm = primary(opts.confirm, 'button');
    let send: (() => Promise<ActionResult>) | undefined;
    let again = false;
    const lock = (working: boolean): void => {
      back.disabled = working || again;
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
      for (const field of opts.fields) {
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
          field.disabled = working || again;
        }
      }
    };
    const finish = async (): Promise<void> => {
      if (send === undefined) {
        const built = opts.build();
        if ('error' in built) {
          setMessage(problem, built.error);
          return;
        }
        setMessage(problem, undefined);
        send = built.send;
      }
      lock(true);
      confirm.textContent = 'Đang gửi…';
      const result = await send();
      if (this.disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.handle?.close();
        this.handle = undefined;
        await opts.onDone();
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
      confirm.textContent = again ? 'Thử lại' : opts.confirm;
      if (result.kind === 'conflict') {
        confirm.disabled = true;
        back.disabled = false;
      }
    };
    back.addEventListener('click', () => {
      this.handle?.close();
      this.handle = undefined;
    });
    confirm.addEventListener('click', () => void finish());
    this.handle?.close();
    this.handle = openDialog({ title: opts.title, description: opts.description, body: [...opts.fields, problem, status], actions: [back, confirm], ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }) });
  }
}

// =========================================================================================================== reviews

export class ReviewListView extends Page {
  readonly #search: HTMLInputElement;
  readonly #kind: HTMLSelectElement;
  readonly #stars: HTMLSelectElement;
  readonly #visibility: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #shop: HTMLInputElement;
  readonly #shipper: HTMLInputElement;

  constructor(root: HTMLElement, host: FeedbackHost) {
    super(root, host, 'Tổng quan đánh giá', 'Chi tiết đánh giá', 'review-drawer');
    this.#search = h('input', { id: 'review-search', type: 'search', class: 'search-input', placeholder: 'Mã đơn / mã giao hàng', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo mã', maxlength: '40' });
    this.#kind = h('select', { id: 'review-kind', class: 'select', 'aria-label': 'Nguồn' }, ...(['ALL', 'SHOP_BY_CUSTOMER', 'SHIPPER_BY_CUSTOMER', 'SHIPPER_BY_SHOP'] as const).map((value) => h('option', { value }, REVIEW_KIND_LABEL[value])));
    this.#stars = h('select', { id: 'review-stars', class: 'select', 'aria-label': 'Số sao' }, h('option', { value: 'ALL' }, 'Mọi số sao'), ...[5, 4, 3, 2, 1].map((n) => h('option', { value: String(n) }, `${String(n)} sao`)));
    this.#visibility = h('select', { id: 'review-visibility', class: 'select', 'aria-label': 'Hiển thị' }, h('option', { value: 'ALL' }, 'Hiện và đã ẩn'), h('option', { value: 'VISIBLE' }, 'Đang hiển thị'), h('option', { value: 'HIDDEN' }, 'Đã ẩn'));
    this.#from = h('input', { id: 'review-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'review-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#shop = h('input', { id: 'review-shop', type: 'search', class: 'search-input', placeholder: 'Quán', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Quán', maxlength: '80' });
    this.#shipper = h('input', { id: 'review-shipper', type: 'search', class: 'search-input', placeholder: 'Shipper', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Shipper', maxlength: '80' });
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    this.typed([this.#search, this.#kind, this.#stars, this.#visibility, this.#from, this.#to, this.#shop, this.#shipper], () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'review-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'review-title' }, 'Đánh giá'), h('p', { class: 'lead lead-last' }, 'Đánh giá của khách và quán. Admin chỉ ẩn hoặc khôi phục khi có lý do và nhật ký; bản gốc luôn được giữ, sao và nhận xét không bao giờ bị sửa. Đánh giá đã ẩn không tính vào điểm.'))),
        this.counters,
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#kind, this.#stars, this.#visibility, refresh),
        h('div', { class: 'toolbar toolbar-filters' }, this.#from, this.#to, this.#shop, this.#shipper),
        this.results,
        this.drawer,
      ),
    );
  }

  async load(): Promise<void> {
    const token = ++this.latest;
    this.results.replaceChildren(this.table('Danh sách đánh giá', REVIEW_COLUMNS, { panel: skeleton() }));
    const read = await this.host.source.listReviews({
      kind: (['SHOP_BY_CUSTOMER', 'SHIPPER_BY_CUSTOMER', 'SHIPPER_BY_SHOP'] as const).find((v) => v === this.#kind.value) ?? 'ALL',
      stars: [1, 2, 3, 4, 5].find((n) => String(n) === this.#stars.value) ?? 'ALL',
      visibility: this.#visibility.value === 'VISIBLE' ? 'VISIBLE' : this.#visibility.value === 'HIDDEN' ? 'HIDDEN' : 'ALL',
      query: this.#search.value,
      from: this.#from.value,
      to: this.#to.value,
      shop: this.#shop.value,
      shipper: this.#shipper.value,
      page: this.page,
    });
    if (this.disposed || token !== this.latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.counters.replaceChildren();
      this.results.replaceChildren(this.table('Danh sách đánh giá', REVIEW_COLUMNS, { panel: notWiredPanel(read.reason) }));
      return;
    }
    if (read.kind === 'failed') {
      this.counters.replaceChildren();
      this.results.replaceChildren(this.table('Danh sách đánh giá', REVIEW_COLUMNS, { panel: this.fail(read, () => void this.load()) }));
      return;
    }
    this.#counters(read.counters);
    if (read.rows.length === 0) {
      const filtered = [this.#search.value, this.#shop.value, this.#shipper.value, this.#from.value, this.#to.value].some((v) => v.trim() !== '') || this.#kind.value !== 'ALL' || this.#stars.value !== 'ALL' || this.#visibility.value !== 'ALL';
      this.results.replaceChildren(this.table('Danh sách đánh giá', REVIEW_COLUMNS, { panel: filtered ? emptyPanel('Không tìm thấy đánh giá', 'Thử đổi từ khóa hoặc bộ lọc.') : emptyPanel('Chưa có đánh giá', 'Đánh giá xuất hiện ở đây khi khách hoặc quán gửi trong ứng dụng.') }));
      return;
    }
    this.results.replaceChildren(h('div', {}, this.table('Danh sách đánh giá', REVIEW_COLUMNS, { rows: read.rows.map((row) => this.#row(row)) }), this.pager(read.total, 'đánh giá', () => void this.load())));
  }

  #counters(c: ReviewCounters): void {
    this.counters.replaceChildren(counter('Tổng đánh giá', c.total, 'neutral'), counter('Điểm thấp (≤ 2 sao)', c.low, c.low > 0 ? 'wait' : 'neutral'), counter('Đã ẩn', c.hidden, 'neutral'));
  }

  #row(row: ReviewRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem đánh giá ${row.relatedCode}` }, 'Xem');
    open.addEventListener('click', () => void this.#open(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Nguồn' }, REVIEW_KIND_LABEL[row.kind]),
      h('td', { 'data-label': 'Đánh giá' }, stars(row.stars), row.comment === null ? undefined : h('span', { class: 'hint' }, ` ${row.comment}`)),
      h('td', { 'data-label': 'Quán', class: 'cell-name' }, row.shopName),
      h('td', { 'data-label': 'Shipper' }, row.shipperName ?? '—'),
      h('td', { 'data-label': 'Mã' }, row.relatedCode),
      h('td', { 'data-label': 'Hiển thị' }, row.visibility === 'VISIBLE' ? badge('Đang hiển thị', 'ok') : badge('Đã ẩn', 'lock')),
      h('td', { 'data-label': 'Ngày' }, formatDateTime(row.createdAt)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  async #open(id: string, note?: string): Promise<void> {
    this.openId = id;
    this.drawer.hidden = false;
    this.drawer.replaceChildren(skeleton(3));
    const read = await this.host.source.reviewDetail(id);
    if (this.disposed || this.openId !== id) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.drawer.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'not-found') {
      this.drawer.replaceChildren(this.closeBar('Đánh giá'), emptyPanel('Không tìm thấy', 'Đánh giá này không còn hoặc bạn không có quyền xem.'));
    } else if (read.kind === 'failed') {
      this.drawer.replaceChildren(this.closeBar('Đánh giá'), this.fail(read, () => void this.#open(id)));
    } else {
      this.drawer.replaceChildren(...this.#detail(read.review, note));
      this.drawer.focus();
    }
  }

  #detail(r: ReviewDetail, note?: string): HTMLElement[] {
    const blocks: HTMLElement[] = [this.closeBar(`Đánh giá ${r.relatedCode}`)];
    if (note !== undefined) {
      blocks.push(h('p', { class: 'notice', role: 'status' }, note));
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Nội dung gốc'),
        definition([
          ['Nguồn', REVIEW_KIND_LABEL[r.kind]],
          ['Số sao', stars(r.stars)],
          ['Nhận xét', r.comment ?? '(không có nhận xét)'],
          ['Người viết', r.kind === 'SHIPPER_BY_SHOP' ? 'Quán' : r.reviewerName],
          ['Quán', r.shopName],
          ['Shipper', r.shipperName ?? '—'],
          ['Giao hàng', r.deliveryCode === null ? '—' : `${r.deliveryCode} · ${r.deliveryState ?? ''}`],
          ['Hiển thị', r.visibility === 'VISIBLE' ? badge('Đang hiển thị, tính vào điểm', 'ok') : badge('Đã ẩn, không tính vào điểm', 'lock')],
          ['Gửi lúc', formatDateTime(r.createdAt)],
        ]),
        h('p', { class: 'hint' }, 'Admin không sửa sao hay nhận xét thay người gửi. Ẩn/khôi phục giữ nguyên bản gốc và ghi nhật ký.'),
      ),
    );
    if (r.kind === 'SHOP_BY_CUSTOMER') {
      blocks.push(
        h(
          'section',
          { class: 'detail-block' },
          h('h3', { class: 'subtitle' }, 'Phản hồi của quán'),
          r.reply === null
            ? h('p', { class: 'empty' }, 'Quán chưa phản hồi.')
            : h('div', {}, h('p', {}, r.reply.body), h('p', { class: 'timeline-meta' }, `Cập nhật ${formatDateTime(r.reply.updatedAt)} · phiên bản ${String(r.reply.version)}`)),
          r.replyHistory.length > 1
            ? h('ol', { class: 'timeline' }, ...r.replyHistory.map((entry) => h('li', { class: 'timeline-item' }, h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'timeline-label' }, `Bản ${String(entry.version)}`), h('p', { class: 'timeline-meta' }, formatDateTime(entry.writtenAt)), h('p', { class: 'timeline-reason' }, entry.body)))))
            : undefined,
        ),
      );
    }
    if (r.complaints.length > 0) {
      blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Phản ánh về đánh giá này'), h('ul', { class: 'plain-list' }, ...r.complaints.map((c) => h('li', {}, `${c.code} · `, badge(COMPLAINT_STATUS_LABEL[c.status], statusTone(c.status)))))));
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Lịch sử kiểm duyệt'),
        r.moderations.length === 0
          ? h('p', { class: 'empty' }, 'Chưa bị ẩn lần nào.')
          : h('ol', { class: 'timeline' }, ...r.moderations.map((m) => h('li', { class: 'timeline-item' }, h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'timeline-label' }, m.action === 'HIDE' ? 'Ẩn đánh giá' : 'Khôi phục đánh giá'), h('p', { class: 'timeline-meta' }, formatDateTime(m.at)), h('p', { class: 'timeline-reason' }, `${MODERATION_REASON_LABEL[m.reasonCode as ModerationReason] ?? m.reasonCode}${m.reasonNote === null ? '' : ` — ${m.reasonNote}`}`))))),
      ),
    );
    const actions = [...r.can].map((name) => {
      const button = secondary(name === 'hide' ? 'Ẩn đánh giá' : 'Khôi phục đánh giá');
      button.classList.add('btn-inline');
      button.addEventListener('click', () => this.#ask(r, name));
      return button;
    });
    if (actions.length > 0) {
      blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Kiểm duyệt'), h('div', { class: 'detail-actions' }, ...actions)));
    }
    return blocks;
  }

  #ask(r: ReviewDetail, name: 'hide' | 'restore'): void {
    const reason = h('select', { id: 'review-reason', class: 'select', 'aria-label': 'Lý do' }, h('option', { value: '' }, 'Chọn lý do…'), ...MODERATION_REASONS.map((value) => h('option', { value }, MODERATION_REASON_LABEL[value])));
    const note = h('textarea', { id: 'review-reason-note', class: 'textarea', rows: '3', maxlength: String(NOTE_MAX), 'aria-label': 'Chi tiết lý do' });
    const key = this.host.newKey();
    this.dialog({
      title: name === 'hide' ? 'Ẩn đánh giá' : 'Khôi phục đánh giá',
      description: name === 'hide' ? 'Đánh giá ẩn không hiện trên trang quán và không tính vào điểm. Bản gốc và lịch sử được giữ.' : 'Đánh giá được hiển thị lại và tính lại vào điểm.',
      confirm: name === 'hide' ? 'Ẩn đánh giá' : 'Khôi phục',
      fields: [h('label', { class: 'field-label', for: 'review-reason' }, 'Lý do (bắt buộc, ghi vào nhật ký kiểm toán)'), reason, h('label', { class: 'field-label', for: 'review-reason-note' }, 'Chi tiết (bắt buộc nếu chọn “Lý do khác”)'), note],
      build: () => {
        const code = MODERATION_REASONS.find((value) => value === reason.value);
        const detail = clean(note.value);
        if (code === undefined) {
          return { error: 'Hãy chọn lý do.' };
        }
        if (code === 'OTHER' && detail === '') {
          return { error: 'Lý do khác cần ghi rõ chi tiết.' };
        }
        return { send: () => this.host.source.reviewAction({ id: r.id, name, version: r.version, reasonCode: code, reasonNote: detail === '' ? null : detail, key }) };
      },
      onDone: async () => {
        await this.#open(r.id, 'Đã cập nhật.');
        await this.load();
      },
    });
  }
}

const REVIEW_COLUMNS = ['Nguồn', 'Đánh giá', 'Quán', 'Shipper', 'Mã', 'Hiển thị', 'Ngày', 'Thao tác'] as const;
const COMPLAINT_COLUMNS = ['Mã hồ sơ', 'Nội dung', 'Người gửi', 'Nhóm', 'Trạng thái', 'Ngày tạo', 'Thao tác'] as const;

// ======================================================================================================== complaints

const ACTION_LABEL: Record<ComplaintActionName, string> = {
  receive: 'Tiếp nhận',
  assign: 'Phân công',
  note: 'Ghi chú nội bộ',
  'request-info': 'Yêu cầu bổ sung',
  conclude: 'Lưu kết luận',
  close: 'Đóng không xử lý',
  'decide-reconsideration': 'Quyết định xem xét lại',
  'adjust-result': 'Điều chỉnh kết quả giao',
  'adjust-commission': 'Điều chỉnh tài chính',
};

const ACTION_TEXT: Record<ComplaintActionName, string> = {
  receive: 'Tiếp nhận hồ sơ: người gửi sẽ thấy trạng thái “Đang xử lý”.',
  assign: 'Chỉ chọn được quản trị viên có quyền xử lý phản ánh.',
  note: 'Ghi chú nội bộ chỉ hiển thị cho Admin, không bao giờ trả ra ứng dụng.',
  'request-info': 'Gửi yêu cầu cho người gửi, quán hoặc shipper. Bên được hỏi chỉ thấy câu hỏi và kết luận, không thấy nội dung phản ánh.',
  conclude: 'Kết luận được gửi cho người gửi và các bên liên quan. Kết luận không tự đổi kết quả giao hoặc số dư ví.',
  close: 'Đóng hồ sơ không xử lý (trùng, ngoài phạm vi hoặc không đủ căn cứ). Lý do bắt buộc và người gửi sẽ thấy. Đóng hồ sơ không xác nhận hàng đã về.',
  'decide-reconsideration': 'Người gửi xin xem xét lại trong 7 ngày sau khi đóng. Mở lại hoặc giữ nguyên đều cần lý do.',
  'adjust-result': 'Ghi bản điều chỉnh tham chiếu kết quả gốc. Không tạo lại hoàn thành/thu hoa hồng, không hồi sinh yêu cầu giao đã kết thúc.',
  'adjust-commission': 'Gửi yêu cầu điều chỉnh tài chính. Cần quyền tiền riêng. Thiếu số dư hoặc chưa thực hiện được thì chờ xử lý tài chính, không âm ví hay dùng tiền đang giữ.',
};

export class ComplaintListView extends Page {
  readonly #search: HTMLInputElement;
  readonly #status: HTMLSelectElement;
  readonly #category: HTMLSelectElement;
  readonly #role: HTMLSelectElement;
  readonly #assignee: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #shop: HTMLInputElement;
  readonly #shipper: HTMLInputElement;
  #handlers: readonly { readonly id: string; readonly name: string }[] = [];

  constructor(root: HTMLElement, host: FeedbackHost) {
    super(root, host, 'Tổng quan phản ánh', 'Chi tiết phản ánh', 'complaint-drawer');
    this.#search = h('input', { id: 'complaint-search', type: 'search', class: 'search-input', placeholder: 'Mã hồ sơ / mã đơn', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo mã', maxlength: '40' });
    this.#status = h('select', { id: 'complaint-status', class: 'select', 'aria-label': 'Trạng thái' }, ...(['ALL', ...COMPLAINT_STATUSES] as const).map((value) => h('option', { value }, COMPLAINT_STATUS_LABEL[value])));
    this.#category = h('select', { id: 'complaint-category', class: 'select', 'aria-label': 'Nhóm' }, ...(['ALL', ...COMPLAINT_CATEGORIES] as const).map((value) => h('option', { value }, COMPLAINT_CATEGORY_LABEL[value])));
    this.#role = h('select', { id: 'complaint-role', class: 'select', 'aria-label': 'Người gửi' }, ...(['ALL', 'CUSTOMER', 'SHOP', 'SHIPPER'] as const).map((value) => h('option', { value }, SUBMITTER_LABEL[value])));
    this.#assignee = h('select', { id: 'complaint-assignee', class: 'select', 'aria-label': 'Người xử lý' }, h('option', { value: 'ALL' }, 'Tất cả người xử lý'), h('option', { value: 'ME' }, 'Của tôi'), h('option', { value: 'NONE' }, 'Chưa phân công'));
    this.#from = h('input', { id: 'complaint-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'complaint-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#shop = h('input', { id: 'complaint-shop', type: 'search', class: 'search-input', placeholder: 'Quán', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Quán', maxlength: '80' });
    this.#shipper = h('input', { id: 'complaint-shipper', type: 'search', class: 'search-input', placeholder: 'Shipper', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Shipper', maxlength: '80' });
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    this.typed([this.#search, this.#status, this.#category, this.#role, this.#assignee, this.#from, this.#to, this.#shop, this.#shipper], () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'complaint-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'complaint-title' }, 'Phản ánh'), h('p', { class: 'lead lead-last' }, 'Tiếp nhận, xác minh và kết luận phản ánh của khách, quán và shipper. Phản ánh không tự đổi kết quả giao, hoàn hoa hồng hay bồi thường; điều chỉnh tài chính cần quyền riêng.'))),
        this.counters,
        h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#status, this.#category, this.#assignee, refresh),
        h('div', { class: 'toolbar toolbar-filters' }, this.#role, this.#from, this.#to, this.#shop, this.#shipper),
        this.results,
        this.drawer,
      ),
    );
  }

  async load(): Promise<void> {
    const token = ++this.latest;
    this.results.replaceChildren(this.table('Danh sách phản ánh', COMPLAINT_COLUMNS, { panel: skeleton() }));
    const handlers = await this.host.source.handlers();
    if (handlers.kind === 'ready' && this.#handlers.length !== handlers.handlers.length) {
      this.#handlers = handlers.handlers;
      const current = this.#assignee.value;
      this.#assignee.replaceChildren(h('option', { value: 'ALL' }, 'Tất cả người xử lý'), h('option', { value: 'ME' }, 'Của tôi'), h('option', { value: 'NONE' }, 'Chưa phân công'), ...handlers.handlers.map((handler) => h('option', { value: handler.id }, handler.name)));
      this.#assignee.value = current;
    }
    const read = await this.host.source.listComplaints({
      query: this.#search.value,
      status: COMPLAINT_STATUSES.find((v) => v === this.#status.value) ?? 'ALL',
      category: COMPLAINT_CATEGORIES.find((v) => v === this.#category.value) ?? 'ALL',
      submitterRole: (['CUSTOMER', 'SHOP', 'SHIPPER'] as const).find((v) => v === this.#role.value) ?? 'ALL',
      shop: this.#shop.value,
      shipper: this.#shipper.value,
      assignee: this.#assignee.value,
      from: this.#from.value,
      to: this.#to.value,
      page: this.page,
    });
    if (this.disposed || token !== this.latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.counters.replaceChildren();
      this.results.replaceChildren(this.table('Danh sách phản ánh', COMPLAINT_COLUMNS, { panel: notWiredPanel(read.reason) }));
      return;
    }
    if (read.kind === 'failed') {
      this.counters.replaceChildren();
      this.results.replaceChildren(this.table('Danh sách phản ánh', COMPLAINT_COLUMNS, { panel: this.fail(read, () => void this.load()) }));
      return;
    }
    this.#counters(read.counters);
    if (read.rows.length === 0) {
      const filtered = [this.#search.value, this.#shop.value, this.#shipper.value, this.#from.value, this.#to.value].some((v) => v.trim() !== '') || [this.#status, this.#category, this.#role, this.#assignee].some((s) => s.value !== 'ALL');
      this.results.replaceChildren(this.table('Danh sách phản ánh', COMPLAINT_COLUMNS, { panel: filtered ? emptyPanel('Không tìm thấy phản ánh', 'Thử đổi từ khóa hoặc bộ lọc.') : emptyPanel('Chưa có phản ánh', 'Phản ánh xuất hiện ở đây khi khách, quán hoặc shipper gửi trong ứng dụng.') }));
      return;
    }
    this.results.replaceChildren(h('div', {}, this.table('Danh sách phản ánh', COMPLAINT_COLUMNS, { rows: read.rows.map((row) => this.#row(row)) }), this.pager(read.total, 'hồ sơ', () => void this.load())));
  }

  #counters(c: ComplaintCounters): void {
    this.counters.replaceChildren(
      counter('Chờ tiếp nhận', c.pending, c.pending > 0 ? 'lock' : 'neutral'),
      counter('Đang xử lý', c.inProgress, 'wait'),
      counter('Chờ bổ sung', c.awaitingInfo, 'wait'),
      counter('Xin xem xét lại', c.reconsiderations, c.reconsiderations > 0 ? 'lock' : 'neutral'),
    );
  }

  #row(row: ComplaintRow): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Xem phản ánh ${row.code}` }, 'Xem');
    open.addEventListener('click', () => void this.#open(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Mã hồ sơ' }, row.code),
      h('td', { 'data-label': 'Nội dung', class: 'cell-name' }, row.summary),
      h('td', { 'data-label': 'Người gửi' }, badge(SUBMITTER_LABEL[row.submitterRole], 'neutral')),
      h('td', { 'data-label': 'Nhóm' }, COMPLAINT_CATEGORY_LABEL[row.category]),
      h('td', { 'data-label': 'Trạng thái' }, badge(COMPLAINT_STATUS_LABEL[row.status], statusTone(row.status)), row.reconsiderationPending ? badge('Xin xem xét lại', 'lock') : undefined),
      h('td', { 'data-label': 'Ngày tạo' }, formatDateTime(row.createdAt)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  async #open(id: string, note?: string): Promise<void> {
    this.openId = id;
    this.drawer.hidden = false;
    this.drawer.replaceChildren(skeleton(3));
    const read = await this.host.source.complaintDetail(id);
    if (this.disposed || this.openId !== id) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.drawer.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'not-found') {
      this.drawer.replaceChildren(this.closeBar('Phản ánh'), emptyPanel('Không tìm thấy', 'Hồ sơ này không còn hoặc bạn không có quyền xem.'));
    } else if (read.kind === 'failed') {
      this.drawer.replaceChildren(this.closeBar('Phản ánh'), this.fail(read, () => void this.#open(id)));
    } else {
      this.drawer.replaceChildren(...this.#detail(read.complaint, note));
      this.drawer.focus();
    }
  }

  #detail(c: ComplaintDetail, note?: string): HTMLElement[] {
    const blocks: HTMLElement[] = [this.closeBar(`${c.code} · ${COMPLAINT_CATEGORY_LABEL[c.category]}`)];
    if (note !== undefined) {
      blocks.push(h('p', { class: 'notice', role: 'status' }, note));
    }
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Nội dung phản ánh (từ người gửi)'),
        definition([
          ['Trạng thái', badge(COMPLAINT_STATUS_LABEL[c.status], statusTone(c.status))],
          ['Người gửi', SUBMITTER_LABEL[c.submitterRole]],
          ['Người xử lý', c.assignee === null ? 'Chưa phân công' : c.assignee.name],
          ...(c.awaitingFrom === null ? [] : ([['Đang chờ thông tin từ', c.awaitingFrom === 'SUBMITTER' ? 'Người gửi' : c.awaitingFrom === 'SHOP' ? 'Quán' : 'Shipper']] as const)),
          ['Tạo lúc', formatDateTime(c.createdAt)],
          ...(c.closedAt === null ? [] : ([['Đóng lúc', formatDateTime(c.closedAt)]] as const)),
        ]),
        h('p', { class: 'detail-text' }, c.body),
        c.conclusion === null ? undefined : h('div', { class: 'notice' }, h('strong', {}, 'Kết luận: '), c.conclusion),
        c.closeReason === null ? undefined : h('div', { class: 'notice' }, h('strong', {}, 'Lý do đóng: '), c.closeReason),
      ),
      this.#evidence(c),
      this.#related(c),
      this.#thread(c),
      this.#money(c),
    );
    const actions = COMPLAINT_ACTIONS.filter((name) => c.can.has(name)).map((name) => {
      const button = name === 'conclude' ? primary(ACTION_LABEL[name], 'button') : secondary(ACTION_LABEL[name]);
      button.classList.add('btn-inline');
      button.addEventListener('click', () => this.#ask(c, name));
      return button;
    });
    blocks.push(
      h(
        'section',
        { class: 'detail-block' },
        h('h3', { class: 'subtitle' }, 'Xử lý'),
        h('p', { class: 'hint' }, 'Kết luận không tự đổi kết quả giao hoặc số dư ví. Quyền xử lý phản ánh không bao gồm quyền tiền hay khóa tài khoản.'),
        actions.length === 0 ? h('p', { class: 'hint' }, 'Tài khoản này chỉ được xem hồ sơ này.') : h('div', { class: 'detail-actions' }, ...actions),
      ),
    );
    return blocks;
  }

  #evidence(c: ComplaintDetail): HTMLElement {
    const pictures = c.thread.flatMap((line) => line.attachments.map((a) => ({ id: a.id, by: line.authorType })));
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Hình ảnh, bằng chứng'),
      pictures.length === 0
        ? h('p', { class: 'empty' }, 'Không có ảnh.')
        : h('div', { class: 'evidence' }, ...pictures.map((p, index) => h('a', { href: this.host.source.pictureUrl(c.id, p.id), target: '_blank', rel: 'noopener noreferrer', class: 'evidence-link' }, h('img', { src: this.host.source.pictureUrl(c.id, p.id), alt: `Ảnh minh chứng ${String(index + 1)}`, loading: 'lazy', width: '96', height: '96' })))),
    );
  }

  #related(c: ComplaintDetail): HTMLElement {
    const d = c.delivery;
    if (d === null) {
      return h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Đơn liên quan'), definition([['Mã', c.relatedCode], ['Quán', c.shopName]]), h('p', { class: 'hint' }, 'Chưa có yêu cầu giao gắn với hồ sơ này.'));
    }
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Thông tin đơn liên quan'),
      definition([
        ['Mã giao hàng', d.code],
        ['Kết quả gốc', d.state],
        ['Shipper', d.shipperName ?? '—'],
        ['Phí giao chốt', d.feeVnd === null ? 'Chưa xác định phí' : formatVnd(d.feeVnd)],
        ['Tình trạng hàng', d.incidentStatus === null ? 'Không có hồ sơ xử lý hàng' : `${d.incidentStatus === 'OPEN' ? 'Đang mở' : 'Đã đóng'} · ${d.custody ?? ''}`],
        ...(c.chain.length > 1 ? ([['Các lần giao', c.chain.map((x) => `${x.code} (${x.state})`).join(' → ')]] as const) : []),
      ]),
      h('h4', { class: 'subtitle' }, 'Lịch sử nhận / hủy / giao'),
      h('ol', { class: 'timeline' }, ...d.assignments.map((a) => h('li', { class: 'timeline-item' }, h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'timeline-label' }, `${a.shipperName} · ${a.status}`), h('p', { class: 'timeline-meta' }, `Nhận ${formatDateTime(a.acceptedAt)}${a.endedAt === null ? '' : ` · kết thúc ${formatDateTime(a.endedAt)}`}`))))),
      h('ol', { class: 'timeline' }, ...d.timeline.map((e) => h('li', { class: 'timeline-item' }, h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }), h('div', {}, h('p', { class: 'timeline-label' }, e.type), h('p', { class: 'timeline-meta' }, `${formatDateTime(e.at)} · ${e.actor}`), e.note === null ? undefined : h('p', { class: 'timeline-reason' }, e.note))))),
      c.review === null ? undefined : h('div', { class: 'notice' }, h('strong', {}, 'Đánh giá bị phản ánh: '), stars(c.review.stars), ` ${c.review.comment ?? ''} (${c.review.visibility === 'VISIBLE' ? 'đang hiển thị' : 'đã ẩn'})`),
    );
  }

  #thread(c: ComplaintDetail): HTMLElement {
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Nhật ký và trao đổi'),
      h(
        'ol',
        { class: 'timeline' },
        ...c.thread.map((line) =>
          h(
            'li',
            { class: 'timeline-item' },
            h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
            h('div', {}, h('p', { class: 'timeline-label' }, `${THREAD_LABEL[line.kind] ?? line.kind}${line.visibility === 'INTERNAL' ? ' (nội bộ)' : ''}`), h('p', { class: 'timeline-meta' }, `${formatDateTime(line.createdAt)} · ${line.authorType}${line.audienceRole === null ? '' : ` → ${line.audienceRole}`}`), line.body === null ? undefined : h('p', { class: 'timeline-reason' }, line.body)),
          ),
        ),
      ),
      c.reconsiderations.length === 0 ? undefined : h('ul', { class: 'plain-list' }, ...c.reconsiderations.map((r) => h('li', {}, `Xin xem xét lại ${formatDateTime(r.requestedAt)} — ${r.status}: ${r.reason}${r.decisionReason === null ? '' : ` → ${r.decisionReason}`}`))),
    );
  }

  #money(c: ComplaintDetail): HTMLElement {
    return h(
      'section',
      { class: 'detail-block' },
      h('h3', { class: 'subtitle' }, 'Điều chỉnh'),
      c.adjustments.length === 0
        ? h('p', { class: 'empty' }, 'Chưa có điều chỉnh.')
        : h('ul', { class: 'plain-list' }, ...c.adjustments.map((a) => h('li', {}, adjustmentText(a), ' ', badge(a.status === 'EXECUTED' ? 'Đã thực hiện' : a.status === 'RECORDED' ? 'Đã ghi nhận' : 'Chờ xử lý tài chính', a.status === 'PENDING_FINANCE' ? 'wait' : 'ok')))),
      h('p', { class: 'hint' }, c.financeAllowed ? 'Tài khoản này có quyền điều chỉnh tài chính. Hệ thống chỉ gửi yêu cầu; ví và sổ cái do phân hệ Ví xử lý.' : 'Điều chỉnh tài chính yêu cầu quyền riêng; tài khoản này chưa được cấp.'),
    );
  }

  #ask(c: ComplaintDetail, name: ComplaintActionName): void {
    const key = this.host.newKey();
    const text = h('textarea', { id: 'complaint-text', class: 'textarea', rows: '4', maxlength: String(name === 'adjust-result' || name === 'adjust-commission' ? NOTE_MAX : TEXT_MAX), 'aria-label': 'Nội dung' });
    const fields: Node[] = [];
    const base = (over: Partial<ComplaintActionRequest>): ComplaintActionRequest => ({ id: c.id, name, version: c.version, key, ...over });
    const labelled = (label: string, control: HTMLElement, id: string): void => {
      fields.push(h('label', { class: 'field-label', for: id }, label), control);
    };
    const textLabel: Partial<Record<ComplaintActionName, string>> = {
      note: 'Ghi chú nội bộ (chỉ Admin thấy)',
      'request-info': 'Nội dung yêu cầu',
      conclude: 'Kết luận gửi các bên (người gửi và bên liên quan đều đọc được)',
      close: 'Lý do đóng (bắt buộc, người gửi sẽ thấy)',
      'decide-reconsideration': 'Lý do quyết định (bắt buộc)',
      'adjust-result': 'Lý do điều chỉnh (bắt buộc, ghi vào nhật ký)',
      'adjust-commission': 'Lý do điều chỉnh (bắt buộc, ghi vào nhật ký)',
    };
    const from = h('select', { id: 'complaint-from-role', class: 'select', 'aria-label': 'Yêu cầu từ' }, h('option', { value: 'SUBMITTER' }, 'Người gửi'), h('option', { value: 'SHOP' }, 'Quán'), ...(c.shipperName === null ? [] : [h('option', { value: 'SHIPPER' }, 'Shipper')]));
    const decision = h('select', { id: 'complaint-decision', class: 'select', 'aria-label': 'Quyết định' }, h('option', { value: 'REOPEN' }, 'Mở lại hồ sơ'), h('option', { value: 'REJECT' }, 'Giữ nguyên kết quả'));
    const result = h('select', { id: 'complaint-result', class: 'select', 'aria-label': 'Kết quả đúng' }, h('option', { value: 'NOT_DELIVERED' }, 'Chưa giao được'), h('option', { value: 'DELIVERED' }, 'Đã giao thành công'));
    const direction = h('select', { id: 'complaint-direction', class: 'select', 'aria-label': 'Hướng điều chỉnh' }, h('option', { value: 'REFUND_TO_SHIPPER' }, 'Hoàn cho shipper'), h('option', { value: 'CHARGE_TO_SHIPPER' }, 'Thu thêm từ shipper'));
    const amount = h('input', { id: 'complaint-amount', type: 'text', inputmode: 'numeric', class: 'search-input', placeholder: 'Số tiền (đ)', 'aria-label': 'Số tiền' });
    const assignee = h('select', { id: 'complaint-assign', class: 'select', 'aria-label': 'Người phụ trách' }, h('option', { value: '' }, 'Bỏ phân công'), ...this.#handlers.map((handler) => h('option', { value: handler.id }, handler.name)));
    const reviewed = h('input', { id: 'complaint-reviewed', type: 'checkbox' });
    if (name === 'request-info') {
      labelled('Yêu cầu bổ sung từ', from, 'complaint-from-role');
    }
    if (name === 'decide-reconsideration') {
      labelled('Quyết định', decision, 'complaint-decision');
    }
    if (name === 'adjust-result') {
      labelled('Kết quả đúng', result, 'complaint-result');
    }
    if (name === 'adjust-commission') {
      labelled('Hướng điều chỉnh', direction, 'complaint-direction');
      labelled('Số tiền', amount, 'complaint-amount');
    }
    if (name === 'assign') {
      labelled('Người phụ trách', assignee, 'complaint-assign');
    }
    if (textLabel[name] !== undefined) {
      labelled(textLabel[name] as string, text, 'complaint-text');
    }
    if (name === 'adjust-result' || name === 'adjust-commission') {
      fields.push(h('label', { class: 'field-label', for: 'complaint-reviewed' }, reviewed, ` Đã đối chiếu toàn bộ lịch sử giao${c.chain.length > 1 ? ` (có ${String(c.chain.length)} lần giao trong chuỗi)` : ''}`));
    }
    this.dialog({
      title: ACTION_LABEL[name],
      description: ACTION_TEXT[name],
      confirm: ACTION_LABEL[name],
      fields,
      build: () => {
        const body = clean(text.value);
        if (textLabel[name] !== undefined && body === '') {
          return { error: 'Nội dung là bắt buộc.' };
        }
        let request: ComplaintActionRequest;
        switch (name) {
          case 'assign':
            request = base({ assigneeId: assignee.value === '' ? null : assignee.value });
            break;
          case 'request-info':
            request = base({ body, from: from.value === 'SHOP' ? 'SHOP' : from.value === 'SHIPPER' ? 'SHIPPER' : 'SUBMITTER' });
            break;
          case 'decide-reconsideration':
            request = base({ body, decision: decision.value === 'REJECT' ? 'REJECT' : 'REOPEN' });
            break;
          case 'adjust-result':
            request = base({ body, correctedResult: result.value === 'DELIVERED' ? 'DELIVERED' : 'NOT_DELIVERED', historyReviewed: reviewed.checked });
            break;
          case 'adjust-commission': {
            const digits = amount.value.replace(/[.\s]/g, '');
            if (!/^[0-9]{1,8}$/.test(digits) || Number(digits) < 1 || Number(digits) > 10_000_000) {
              return { error: 'Nhập số tiền hợp lệ (1 đến 10.000.000đ).' };
            }
            request = base({ body, direction: direction.value === 'CHARGE_TO_SHIPPER' ? 'CHARGE_TO_SHIPPER' : 'REFUND_TO_SHIPPER', amountVnd: Number(digits), historyReviewed: reviewed.checked });
            break;
          }
          case 'receive':
            request = base({});
            break;
          default:
            request = base({ body });
        }
        return { send: () => this.host.source.complaintAction(request) };
      },
      onDone: async () => {
        await this.#open(c.id, 'Đã cập nhật.');
        await this.load();
      },
    });
  }
}

const THREAD_LABEL: Record<string, string> = {
  SUBMITTED: 'Đã gửi',
  APPENDED: 'Gửi thêm (trùng vấn đề đang mở)',
  SUPPLEMENT: 'Người gửi bổ sung',
  PARTY_RESPONSE: 'Bên liên quan giải trình',
  RECEIVED: 'Đã tiếp nhận',
  REQUEST_INFO: 'Yêu cầu bổ sung',
  CONCLUSION: 'Kết luận',
  CLOSED: 'Đóng không xử lý',
  REOPEN_REQUEST: 'Xin xem xét lại',
  REOPEN_DECISION: 'Quyết định xem xét lại',
  ASSIGNED: 'Phân công',
  NOTE: 'Ghi chú',
  ADJUSTMENT: 'Điều chỉnh',
};

function adjustmentText(a: AdjustmentRecord): string {
  if (a.kind === 'DELIVERY_RESULT') {
    return `Điều chỉnh kết quả giao: kết quả gốc “${a.originalState}” → ${a.correctedResult === 'DELIVERED' ? 'đã giao' : 'chưa giao được'}${a.successorCount > 0 ? ` (đã đối chiếu ${String(a.successorCount)} lần giao sau)` : ''}. ${a.reason}`;
  }
  return `Điều chỉnh tài chính ${a.direction === 'REFUND_TO_SHIPPER' ? 'hoàn cho shipper' : 'thu thêm từ shipper'} ${a.amountVnd === null ? '' : formatVnd(a.amountVnd)}${a.pendingReason === 'INSUFFICIENT_BALANCE' ? ' — thiếu số dư' : a.pendingReason === null ? '' : ' — chưa thực hiện được'}. ${a.reason}`;
}

export type { ReviewKind, SubmitterRole };
