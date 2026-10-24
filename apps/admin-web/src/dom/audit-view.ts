import { AuditItem, AuditOutcome, AuditQuery, OperationsSource } from '../core/operations.js';
import { customRangeError, vietnamToday } from '../core/overview.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Hệ thống › Nhật ký" (M12-F). READ ONLY: no row has an edit or a delete control, and the page has no write at all. The server already redacts secret-looking keys; every
// value is still shown as text (never as HTML). A filter change starts a new list; "Tải thêm" continues the SAME filter with the server's cursor.

export interface AuditHost {
  readonly source: OperationsSource;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly now?: () => number;
}

const OUTCOME_LABEL: Record<AuditOutcome, string> = { SUCCESS: 'Thành công', DENIED: 'Bị từ chối', FAILURE: 'Thất bại' };
const RANGES: ReadonlyArray<readonly [AuditQuery['range'], string]> = [['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['7d', '7 ngày'], ['custom', 'Tùy chọn']];

const metadataText = (value: Readonly<Record<string, unknown>>): string => {
  const entries = Object.entries(value);
  return entries.length === 0 ? '(không có)' : entries.map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n');
};

export class AuditView {
  readonly #body: HTMLElement;
  readonly #more: HTMLElement;
  readonly #range: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #action: HTMLInputElement;
  readonly #actor: HTMLInputElement;
  readonly #outcome: HTMLSelectElement;
  readonly #custom: HTMLElement;
  readonly #error: HTMLElement;
  #items: AuditItem[] = [];
  #latest = 0;
  #disposed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: AuditHost,
  ) {
    this.#body = h('div', { class: 'au-body', 'aria-live': 'polite' });
    this.#more = h('div', { class: 'au-more' });
    this.#error = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    this.#range = h('select', { id: 'audit-range', class: 'select', 'aria-label': 'Khoảng thời gian' }, ...RANGES.map(([value, label]) => h('option', { value, ...(value === '7d' ? { selected: true } : {}) }, label)));
    this.#from = h('input', { id: 'audit-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'audit-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#action = h('input', { id: 'audit-action', type: 'search', class: 'search-input', maxlength: '128', placeholder: 'Hành động (vd: admin.report)', 'aria-label': 'Hành động' });
    this.#actor = h('input', { id: 'audit-actor', type: 'search', class: 'search-input', maxlength: '128', placeholder: 'Mã người thực hiện', 'aria-label': 'Mã người thực hiện' });
    this.#outcome = h('select', { id: 'audit-outcome', class: 'select', 'aria-label': 'Kết quả' }, h('option', { value: '' }, 'Mọi kết quả'), ...(['SUCCESS', 'DENIED', 'FAILURE'] as const).map((value) => h('option', { value }, OUTCOME_LABEL[value])));
    this.#custom = h('div', { class: 'toolbar toolbar-filters', hidden: true }, this.#from, this.#to);
    const apply = primary('Lọc', 'button');
    apply.classList.add('btn-inline');
    apply.addEventListener('click', () => this.#apply());
    this.#range.addEventListener('change', () => {
      this.#custom.hidden = this.#range.value !== 'custom';
      if (this.#range.value === 'custom' && this.#from.value === '') {
        const today = vietnamToday((this.host.now ?? Date.now)());
        this.#from.max = today;
        this.#to.max = today;
        this.#from.value = today;
        this.#to.value = today;
      }
    });
    for (const input of [this.#action, this.#actor]) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          this.#apply();
        }
      });
    }
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'audit-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'audit-title' }, 'Nhật ký'), h('p', { class: 'lead lead-last' }, 'Ghi lại ai đã làm gì và khi nào, theo giờ Việt Nam. Chỉ xem: nhật ký không có chức năng sửa hay xóa, và không chứa mật khẩu, mã OTP hay khóa bí mật.'))),
        h('div', { class: 'toolbar toolbar-filters' }, this.#range, this.#action, this.#actor, this.#outcome, apply),
        this.#custom,
        this.#error,
        this.#body,
        this.#more,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
  }

  #query(cursor?: string): AuditQuery {
    const range = this.#range.value as AuditQuery['range'];
    const outcome = this.#outcome.value;
    const text = (input: HTMLInputElement): string | undefined => (input.value.trim() === '' ? undefined : input.value.trim());
    const action = text(this.#action);
    const actorId = text(this.#actor);
    return {
      range,
      ...(range === 'custom' ? { from: this.#from.value, to: this.#to.value } : {}),
      ...(action === undefined ? {} : { action }),
      ...(actorId === undefined ? {} : { actorId }),
      ...(outcome === '' ? {} : { outcome: outcome as AuditOutcome }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  }

  #apply(): void {
    if (this.#range.value === 'custom') {
      const error = customRangeError(this.#from.value, this.#to.value, (this.host.now ?? Date.now)());
      this.#error.textContent = error ?? '';
      this.#error.hidden = error === undefined;
      if (error !== undefined) {
        return;
      }
    } else {
      this.#error.hidden = true;
    }
    void this.load();
  }

  async load(cursor?: string): Promise<void> {
    const token = ++this.#latest;
    if (cursor === undefined) {
      this.#items = [];
      this.#more.replaceChildren();
      this.#body.setAttribute('aria-busy', 'true');
      this.#body.replaceChildren(skeleton(5));
    }
    // "Hôm nay"/"Hôm qua" are sent as the same day twice; the server's default window (7 days) is used for "7 ngày".
    const query = this.#query(cursor);
    const wire = this.#wireRange(query);
    const read = await this.host.source.readAudit(wire);
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
      this.#body.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(cursor), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#items = [...this.#items, ...read.page.items];
    this.#render(read.page.fromDay, read.page.toDay, read.page.generatedAt);
    this.#more.replaceChildren();
    const next = read.page.nextCursor;
    if (next !== null) {
      const button = secondary('Tải thêm');
      button.id = 'audit-more';
      button.addEventListener('click', () => {
        button.disabled = true;
        void this.load(next);
      });
      this.#more.append(button);
    }
  }

  /** today / yesterday are custom days on the wire (the server's named ranges for the audit are the default 7 days and custom). */
  #wireRange(query: AuditQuery): AuditQuery {
    if (query.range === 'today' || query.range === 'yesterday') {
      const today = vietnamToday((this.host.now ?? Date.now)());
      const day = query.range === 'today' ? today : new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      return { ...query, range: 'custom', from: day, to: day };
    }
    return query;
  }

  #render(fromDay: string, toDay: string, generatedAt: string): void {
    const period = fromDay === toDay ? fromDay : `${fromDay} – ${toDay}`;
    if (this.#items.length === 0) {
      this.#body.replaceChildren(h('p', { class: 'ov-stamp' }, `Kỳ: ${period}`), h('p', { class: 'empty', id: 'audit-empty' }, 'Không có bản ghi nào khớp bộ lọc trong kỳ này.'));
      return;
    }
    const rows = this.#items.map((item) => {
      const detail = h('details', {}, h('summary', {}, 'Chi tiết'), h('pre', { class: 'au-meta' }, `request_id: ${item.requestId}\nresource_version: ${item.resourceVersion ?? '—'}\n${metadataText(item.metadata)}`));
      return h(
        'tr',
        { class: `au-row au-${item.outcome.toLowerCase()}` },
        h('td', { 'data-label': 'Thời gian' }, formatDateTime(item.occurredAt)),
        h('td', { 'data-label': 'Người thực hiện' }, h('span', {}, item.actorType), item.actorId === null ? undefined : h('span', { class: 'cell-sub' }, item.actorId)),
        h('td', { 'data-label': 'Hành động' }, h('code', {}, item.action)),
        h('td', { 'data-label': 'Đối tượng' }, item.resourceType === null ? '—' : `${item.resourceType}${item.resourceId === null ? '' : ` · ${item.resourceId}`}`),
        h('td', { 'data-label': 'Kết quả' }, h('span', { class: `badge ${item.outcome === 'SUCCESS' ? 'badge-ok' : 'badge-lock'}` }, OUTCOME_LABEL[item.outcome]), item.reasonCode === null ? undefined : h('span', { class: 'cell-sub' }, item.reasonCode)),
        h('td', { 'data-label': 'Nội dung' }, detail),
      );
    });
    this.#body.replaceChildren(
      h('p', { class: 'ov-stamp' }, `Kỳ: ${period} · ${String(this.#items.length)} bản ghi mới nhất trước · cập nhật lúc ${formatDateTime(generatedAt)} (giờ Việt Nam)`),
      h('div', { class: 'table-card' }, h('table', { class: 'table', id: 'audit-table' }, h('caption', { class: 'sr-only' }, 'Nhật ký hoạt động'), h('thead', {}, h('tr', {}, ...['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Kết quả', 'Nội dung'].map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, ...rows))),
    );
  }
}
