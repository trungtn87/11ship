import { commandFailureText, CommandResult } from '../core/commands.js';
import { customRangeError, OVERVIEW_RANGE_LABEL, OVERVIEW_RANGES, OverviewRange, vietnamToday } from '../core/overview.js';
import { CellFormat, EXPORT_ERROR_TEXT, EXPORT_STATE_LABEL, ExportJob, REPORT_KIND_LABEL, REPORT_KINDS, REPORT_REFUSAL, ReportBasis, ReportData, ReportKind, ReportQuery, ReportSource } from '../core/reports.js';
import { formatVnd } from '../core/deliveries.js';
import { formatDay, formatVietnamTime } from './overview-view.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Báo cáo" (M12-E). A report states the moment it counts at, a rate shows its numerator and denominator, a figure that does not exist is a dash with its note, and a number
// that is a count of deliveries opens the delivery list with the same filter. An export is asked for with the report's own filter, runs in the background and is downloaded from the
// list below when it is DONE. Every node is created with createElement/textContent.

export interface ReportsHost {
  readonly source: ReportSource;
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  /** Opens the delivery list with a filter the report's number was counted with. */
  readonly openDeliveries: (query: Readonly<Record<string, string>>) => void;
  readonly now?: () => number;
  readonly pollMs?: number;
  readonly dialogHost?: HTMLElement;
}

function formatCell(value: number | string | null, format: CellFormat): string {
  if (value === null) {
    return '—';
  }
  if (typeof value === 'string') {
    return value;
  }
  switch (format) {
    case 'vnd':
      return formatVnd(value);
    case 'signed-vnd':
      return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatVnd(Math.abs(value))}`;
    case 'percent':
      return `${value.toLocaleString('vi-VN')}%`;
    case 'seconds':
      return value < 90 ? `${String(value)} giây` : `${(Math.round((value / 60) * 10) / 10).toLocaleString('vi-VN')} phút`;
    default:
      return value.toLocaleString('vi-VN');
  }
}

const sizeText = (bytes: number | null): string => (bytes === null ? '' : bytes < 1024 ? `${String(bytes)} B` : `${(Math.round((bytes / 1024) * 10) / 10).toLocaleString('vi-VN')} KB`);

export class ReportsView {
  readonly #body: HTMLElement;
  readonly #exports: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #custom: HTMLElement;
  readonly #customError: HTMLElement;
  readonly #basis: HTMLSelectElement;
  readonly #kinds = new Map<ReportKind, HTMLButtonElement>();
  readonly #ranges = new Map<OverviewRange, HTMLButtonElement>();
  #kind: ReportKind = 'deliveries';
  #range: OverviewRange = 'today';
  #latest = 0;
  #disposed = false;
  #poll: ReturnType<typeof setTimeout> | undefined;
  /** The key of the export intent in flight: a retry after an unknown answer sends the SAME key; a new filter or format starts a new intent. */
  #pending: { signature: string; key: string } | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ReportsHost,
  ) {
    this.#body = h('div', { class: 'rp-body', 'aria-live': 'polite' });
    this.#exports = h('section', { class: 'ov-section', 'aria-labelledby': 'rp-exports-title' });
    this.#notice = h('p', { class: 'notice', role: 'status', hidden: true });
    this.#from = h('input', { id: 'report-from', type: 'date', class: 'search-input', 'aria-label': 'Từ ngày' });
    this.#to = h('input', { id: 'report-to', type: 'date', class: 'search-input', 'aria-label': 'Đến ngày' });
    this.#customError = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const apply = primary('Áp dụng', 'button');
    apply.classList.add('btn-inline');
    apply.addEventListener('click', () => this.#applyCustom());
    this.#custom = h('div', { class: 'toolbar toolbar-filters ov-custom', hidden: true }, this.#from, this.#to, apply);
    this.#basis = h('select', { id: 'report-basis', class: 'select', 'aria-label': 'Mốc thời gian' }, h('option', { value: 'created' }, 'Theo ngày tạo'), h('option', { value: 'ended' }, 'Theo ngày kết thúc'));
    this.#basis.addEventListener('change', () => void this.load());
    const tabs = h('div', { class: 'ov-ranges', role: 'group', 'aria-label': 'Loại báo cáo' });
    for (const kind of REPORT_KINDS) {
      const button = h('button', { type: 'button', class: 'ov-range', 'aria-pressed': String(kind === this.#kind) }, REPORT_KIND_LABEL[kind]);
      button.addEventListener('click', () => {
        this.#kind = kind;
        for (const [key, node] of this.#kinds) {
          node.setAttribute('aria-pressed', String(key === kind));
        }
        void this.load();
      });
      this.#kinds.set(kind, button);
      tabs.append(button);
    }
    const ranges = h('div', { class: 'ov-ranges', role: 'group', 'aria-label': 'Khoảng thời gian' });
    for (const range of OVERVIEW_RANGES) {
      const button = h('button', { type: 'button', class: 'ov-range', 'aria-pressed': String(range === this.#range) }, OVERVIEW_RANGE_LABEL[range]);
      button.addEventListener('click', () => this.#selectRange(range));
      this.#ranges.set(range, button);
      ranges.append(button);
    }
    const csv = secondary('Xuất CSV');
    csv.id = 'report-export-csv';
    csv.addEventListener('click', () => void this.#export('csv'));
    const xlsx = secondary('Xuất Excel');
    xlsx.id = 'report-export-xlsx';
    xlsx.addEventListener('click', () => void this.#export('xlsx'));
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'report-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'report-title' }, 'Báo cáo'), h('p', { class: 'lead lead-last' }, 'Order và delivery được tính riêng. Tiền hàng và phí ship giữa các bên, cũng như tiền nạp ví, không phải doanh thu nền tảng; hoa hồng, hoàn và điều chỉnh lấy từ sổ cái ví. Mỗi báo cáo ghi rõ mốc thời gian theo giờ Việt Nam.'))),
        h('div', { class: 'toolbar ov-toolbar' }, tabs),
        h('div', { class: 'toolbar ov-toolbar' }, ranges, this.#basis, csv, xlsx),
        this.#custom,
        this.#customError,
        this.#notice,
        this.#body,
        this.#exports,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#poll !== undefined) {
      clearTimeout(this.#poll);
    }
  }

  #say(text: string | undefined): void {
    this.#notice.textContent = text ?? '';
    this.#notice.hidden = text === undefined;
  }

  #selectRange(range: OverviewRange): void {
    this.#range = range;
    for (const [key, node] of this.#ranges) {
      node.setAttribute('aria-pressed', String(key === range));
    }
    this.#custom.hidden = range !== 'custom';
    this.#customError.hidden = true;
    if (range === 'custom') {
      const today = vietnamToday((this.host.now ?? Date.now)());
      this.#from.max = today;
      this.#to.max = today;
      if (this.#from.value === '') {
        this.#from.value = today;
      }
      if (this.#to.value === '') {
        this.#to.value = today;
      }
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

  #query(): ReportQuery {
    const basis: ReportBasis = this.#basis.value === 'ended' ? 'ended' : 'created';
    return this.#range === 'custom' ? { kind: this.#kind, range: 'custom', from: this.#from.value, to: this.#to.value, basis } : { kind: this.#kind, range: this.#range, basis };
  }

  /** The basis switch only means something for the delivery and shop reports; the others have one fixed moment. */
  #syncBasis(): void {
    const used = this.#kind === 'deliveries' || this.#kind === 'shops';
    this.#basis.disabled = !used;
    this.#basis.title = used ? '' : 'Báo cáo này có một mốc thời gian cố định (ghi ở đầu báo cáo).';
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#syncBasis();
    this.#body.setAttribute('aria-busy', 'true');
    this.#body.replaceChildren(skeleton(4));
    const read = await this.host.source.read(this.#query());
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
    this.#body.replaceChildren(...this.#render(read.report));
    void this.loadExports();
  }

  #render(report: ReportData): HTMLElement[] {
    const period = report.period.fromDay === report.period.toDay ? formatDay(report.period.fromDay) : `${formatDay(report.period.fromDay)} – ${formatDay(report.period.toDay)}`;
    const cards = report.summary.map((item) => {
      const children = [h('span', { class: 'ov-label' }, item.label), h('span', { class: 'ov-value' }, formatCell(item.value, item.format)), item.note === null ? undefined : h('span', { class: item.value === null ? 'ov-reason' : 'ov-note' }, item.note)];
      const tone = item.value === null ? 'muted' : 'neutral';
      if (item.link === null) {
        return h('div', { class: `ov-card ov-${tone}` }, ...children);
      }
      const link = item.link;
      const button = h('button', { type: 'button', class: `ov-card ov-link ov-${tone}`, 'aria-label': `${item.label}: ${formatCell(item.value, item.format)}. Mở danh sách` }, ...children);
      button.addEventListener('click', () => this.host.openDeliveries(link));
      return button;
    });
    const head = h('tr', {}, ...report.columns.map((column) => h('th', { scope: 'col', class: column.format === 'text' ? '' : 'cell-end' }, column.label)), report.rows.some((row) => row.link !== null) ? h('th', { scope: 'col', class: 'cell-end' }, 'Danh sách') : undefined);
    const rows = report.rows.map((row) => {
      const link = row.link;
      const open = link === null ? undefined : secondary('Mở');
      if (open !== undefined && link !== null) {
        open.classList.add('btn-inline');
        open.addEventListener('click', () => this.host.openDeliveries(link));
      }
      return h('tr', {}, ...row.cells.map((cell, index) => h('td', { 'data-label': report.columns[index]?.label ?? '', class: report.columns[index]?.format === 'text' ? '' : 'cell-end' }, formatCell(cell, report.columns[index]?.format ?? 'text'))), open === undefined ? (report.rows.some((r) => r.link !== null) ? h('td', {}) : undefined) : h('td', { class: 'cell-end' }, open));
    });
    const parts: (HTMLElement | undefined)[] = [
      h('p', { class: 'ov-stamp', id: 'report-stamp' }, `Kỳ: ${period} · ${report.basisLabel} · tạo lúc ${formatVietnamTime(report.generatedAt)} (giờ Việt Nam)`),
      h('div', { class: 'ov-grid' }, ...cards),
      report.columns.length === 0
        ? undefined
        : report.rows.length === 0
          ? h('p', { class: 'empty', id: 'report-empty' }, 'Không có dòng nào trong kỳ này.')
          : h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, report.title), h('thead', {}, head), h('tbody', {}, ...rows))),
      report.truncated ? h('p', { class: 'hint' }, 'Chỉ hiển thị 200 dòng đầu. Xuất file để lấy đủ.') : undefined,
      h('ul', { class: 'plain-list' }, ...report.notes.map((note) => h('li', {}, note))),
    ];
    return parts.filter((node): node is HTMLElement => node !== undefined);
  }

  // ---- exports -------------------------------------------------------------------------------------------------------------------

  async #export(format: 'csv' | 'xlsx'): Promise<void> {
    const query = this.#query();
    if (query.range === 'custom') {
      const error = customRangeError(query.from ?? '', query.to ?? '', (this.host.now ?? Date.now)());
      if (error !== undefined) {
        this.#customError.textContent = error;
        this.#customError.hidden = false;
        return;
      }
    }
    // The same filter and format is the SAME intent: pressing again after a lost answer sends the same Idempotency-Key and can create no second job.
    const signature = JSON.stringify([query, format]);
    if (this.#pending === undefined || this.#pending.signature !== signature) {
      this.#pending = { signature, key: this.host.newKey() };
    }
    const result: CommandResult = await this.host.source.createExport({ query, format, key: this.#pending.key });
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'ok') {
      this.#pending = undefined;
      this.#say('Đã nhận yêu cầu xuất. File được tạo ở nền; tải ở danh sách bên dưới khi sẵn sàng.');
      void this.loadExports();
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
    this.#say(commandFailureText(result, REPORT_REFUSAL));
  }

  async loadExports(): Promise<void> {
    const read = await this.host.source.listExports();
    if (this.#disposed) {
      return;
    }
    const title = h('h2', { class: 'subtitle', id: 'rp-exports-title' }, 'File đã xuất');
    if (read.kind === 'not-wired') {
      this.#exports.replaceChildren(title, notWiredPanel(read.reason));
      return;
    }
    if (read.kind === 'failed') {
      this.#exports.replaceChildren(title, read.failure === 'forbidden' ? h('p', { class: 'hint' }, 'Tài khoản này không có quyền xuất báo cáo.') : failurePanel(read.failure, { retry: () => void this.loadExports(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      }
      return;
    }
    this.#exports.replaceChildren(title, read.jobs.length === 0 ? h('p', { class: 'empty' }, 'Chưa có file nào được xuất.') : h('ul', { class: 'rp-jobs' }, ...read.jobs.map((job) => this.#job(job))));
    if (this.#poll !== undefined) {
      clearTimeout(this.#poll);
      this.#poll = undefined;
    }
    if (read.jobs.some((job) => job.state === 'QUEUED' || job.state === 'RUNNING')) {
      this.#poll = setTimeout(() => void this.loadExports(), this.host.pollMs ?? 3000);
    }
  }

  #job(job: ExportJob): HTMLElement {
    const detail = job.state === 'FAILED' ? (EXPORT_ERROR_TEXT[job.errorCode ?? ''] ?? 'Không tạo được file.') : job.state === 'DONE' ? `${job.fileName ?? ''} · ${String(job.rowCount ?? 0)} dòng · ${sizeText(job.fileBytes)} · tải được đến ${job.expiresAt === null ? '—' : formatDateTime(job.expiresAt)}` : '';
    let action: HTMLElement | undefined;
    if (job.state === 'DONE') {
      const button = primary('Tải về', 'button');
      button.classList.add('btn-inline');
      button.setAttribute('aria-label', `Tải ${job.fileName ?? 'file'}`);
      button.addEventListener('click', () => void this.#download(job, button));
      action = button;
    }
    return h(
      'li',
      { class: 'rp-job' },
      h('span', { class: 'rp-job-title' }, `${REPORT_KIND_LABEL[job.kind]} · ${job.format === 'csv' ? 'CSV' : 'Excel'}`),
      h('span', { class: `badge ${job.state === 'DONE' ? 'badge-ok' : job.state === 'FAILED' ? 'badge-lock' : 'badge-wait'}` }, EXPORT_STATE_LABEL[job.state]),
      h('span', { class: 'cell-sub' }, `${formatDateTime(job.createdAt)}${detail === '' ? '' : ` · ${detail}`}`),
      action,
    );
  }

  async #download(job: ExportJob, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const result = await this.host.source.download(job.id);
    button.disabled = false;
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'failed') {
      if (result.status === 401) {
        this.host.onSessionLost();
        return;
      }
      this.#say(result.status === 403 ? 'Quyền xuất đã bị thu hồi nên không tải được file.' : result.code === 'REPORT_EXPORT_EXPIRED' ? 'File đã hết hạn tải. Hãy xuất lại.' : 'Không tải được file. Hãy thử lại.');
      void this.loadExports();
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const link = h('a', { href: url, download: result.fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.#say(`Đã tải ${result.fileName}.`);
  }
}
