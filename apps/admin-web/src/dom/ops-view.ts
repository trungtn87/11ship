import {
  canHandle,
  ComponentVersion,
  ConfigSave,
  DEFAULT_INCIDENT_QUERY,
  DEFAULT_LOG_QUERY,
  DisplayState,
  GatewayCheck,
  GatewayDevice,
  GatewayPage,
  IncidentAction,
  IncidentDetail,
  IncidentQuery,
  IncidentStatus,
  INCIDENT_STATUSES,
  LEVEL_LABEL,
  LogGroup,
  LogQuery,
  LogRow,
  MAINTENANCE_SCOPE_OPTIONS,
  OPS_PAGE_SIZE,
  OpsConfigPage,
  OpsDeploy,
  OpsIncident,
  OpsLevel,
  OpsMaintenance,
  OpsOverview,
  OpsRead,
  OpsSource,
  OpsWrite,
  ReleaseDraft,
  ReleaseRow,
  ReleasesPage,
  SEVERITY_LABEL,
  SOURCE_FILTERS,
  STATE_LABEL,
  STATUS_LABEL,
  WRITE_MESSAGE,
} from '../core/ops.js';
import { Route } from '../core/routes.js';
import { openDialog } from './dialog.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Vận hành hệ thống" (M13): Tổng quan, Sự cố (danh sách và chi tiết), SMS Gateway, Nhật ký, Phiên bản & cập nhật, Cấu hình. It draws what the server said
// and sends one request per click. Rules the pages keep: a missing or stale measurement is "Chưa có dữ liệu" / "Dữ liệu cũ" (never green); a cause appears only
// when the server's evidence names it; "đã đọc" is not "đã nhận xử lý"; closing never hides a check that still fails; the Discord webhook is typed once into a
// password field and never shown again; the "deploy server" control exists only as an explanation of what is missing. Every node is created with
// createElement/textContent, so no server value can become markup.

export interface OpsHost {
  readonly source: OpsSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome reuses the pending one. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly go: (route: Route) => void;
  /** What the server last said about this session ('SYSTEM' for the SYSTEM account). */
  readonly level: () => OpsLevel;
  /** Where dialogs mount (the page body by default). */
  readonly dialogHost?: HTMLElement;
}

// ---- shared pieces --------------------------------------------------------------------------------------------------------------------

type Tone = 'ok' | 'wait' | 'lock' | 'neutral';
const badge = (label: string, tone: Tone): HTMLElement => h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);

const STATE_TONE: Record<DisplayState, Tone> = { OK: 'ok', WARNING: 'wait', CRITICAL: 'lock', NO_DATA: 'neutral', STALE: 'neutral' };
export const stateBadge = (state: DisplayState): HTMLElement => badge(STATE_LABEL[state], STATE_TONE[state]);
const severityBadge = (s: 'WARNING' | 'CRITICAL'): HTMLElement => badge(SEVERITY_LABEL[s], s === 'CRITICAL' ? 'lock' : 'wait');
const STATUS_TONE: Record<IncidentStatus, Tone> = { NEW: 'lock', ACKNOWLEDGED: 'wait', IN_PROGRESS: 'wait', RECOVERED: 'ok', CLOSED: 'neutral' };
const statusBadge = (s: IncidentStatus): HTMLElement => badge(STATUS_LABEL[s], STATUS_TONE[s]);

const dash = (v: string | null | undefined): string => (v === null || v === undefined || v === '' ? '—' : v);
const when = (iso: string | null): string => (iso === null ? '—' : formatDateTime(iso));
const hhmm = (iso: string): string => formatDateTime(iso).slice(-5);

function definition(items: ReadonlyArray<readonly [string, string | HTMLElement]>): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

interface Column {
  readonly label: string;
  readonly end?: boolean;
}
function tableCard(caption: string, columns: readonly Column[], rows: readonly HTMLElement[], panel?: HTMLElement): HTMLElement {
  const head = h('tr', {}, ...columns.map((c) => h('th', { scope: 'col', class: c.end ? 'cell-end' : '' }, c.label)));
  const body = panel === undefined ? rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, panel))];
  return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...body)));
}
const cell = (label: string, ...children: (Node | string | undefined)[]): HTMLElement => h('td', { 'data-label': label }, ...children);

function notice(kind: 'warning' | 'error' | 'ok'): { element: HTMLElement; set(text: string | undefined): void } {
  const element = h('p', { class: `message message-${kind === 'ok' ? 'notice' : kind}`, role: kind === 'error' ? 'alert' : 'status', hidden: true });
  return {
    element,
    set: (text) => {
      element.textContent = text ?? '';
      element.hidden = text === undefined || text === '';
    },
  };
}

function pager(total: number, page: number, go: (page: number) => void): HTMLElement {
  const pages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  const prev = secondary('Trang trước');
  const next = secondary('Trang sau');
  prev.classList.add('btn-inline');
  next.classList.add('btn-inline');
  prev.disabled = page <= 1;
  next.disabled = page >= pages;
  prev.addEventListener('click', () => go(page - 1));
  next.addEventListener('click', () => go(page + 1));
  return h('div', { class: 'detail-actions', role: 'navigation', 'aria-label': 'Phân trang' }, prev, h('span', { class: 'hint' }, `Trang ${page}/${pages} · ${total} mục`), next);
}

function updatedBar(updatedAt: string | undefined, refresh: () => void): HTMLElement {
  const button = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
  button.addEventListener('click', refresh);
  return h('div', { class: 'toolbar' }, h('span', { class: 'hint', role: 'status' }, updatedAt === undefined ? 'Chưa tải' : `Cập nhật: ${hhmm(updatedAt)}`), button);
}

function select(id: string, label: string, options: ReadonlyArray<readonly [string, string]>, value: string): HTMLSelectElement {
  const el = h('select', { id, class: 'select', 'aria-label': label }, ...options.map(([v, text]) => h('option', { value: v }, text)));
  el.value = value;
  return el;
}

function input(id: string, label: string, type: string, value = '', extra: Record<string, string> = {}): HTMLInputElement {
  const el = h('input', { id, class: 'search-input', type, 'aria-label': label, placeholder: label, autocomplete: 'off', spellcheck: 'false', ...extra });
  el.value = value;
  return el;
}

function labelled(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', { class: 'label', for: control.id }, label), control, hint === undefined ? undefined : h('p', { class: 'hint' }, hint));
}

abstract class Page {
  protected disposed = false;
  protected latest = 0;
  protected readonly body = h('div', { class: 'tab-body' });

  protected constructor(
    protected readonly root: HTMLElement,
    protected readonly host: OpsHost,
    title: string,
    heading: string,
    ...extra: (Node | undefined)[]
  ) {
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': `${title}-title` }, h('div', { class: 'page-head' }, h('h1', { id: `${title}-title`, class: 'title', tabindex: '-1' }, heading)), ...extra, this.body));
  }

  dispose(): void {
    this.disposed = true;
  }

  abstract load(): Promise<void>;

  /** Draws a failed read and ends the session / re-checks the grants when the server says so. Returns true when the read produced data. */
  protected check<T>(read: OpsRead<T>, retry: () => void): read is { kind: 'ready'; data: T } {
    if (read.kind === 'ready') return true;
    if (read.kind === 'not-found') {
      this.body.replaceChildren(emptyPanel('Không tìm thấy', 'Mục này không tồn tại hoặc bạn không có quyền xem.'));
      return false;
    }
    if (read.failure === 'session-expired') {
      this.host.onSessionLost();
    } else if (read.failure === 'forbidden') {
      this.host.onForbidden();
    }
    this.body.replaceChildren(failurePanel(read.failure, { retry, login: this.host.login, home: this.host.home }, read.retryAfterSec));
    return false;
  }

  protected loading(): void {
    this.body.replaceChildren(skeleton(4));
  }

  protected current(token: number): boolean {
    return !this.disposed && token === this.latest;
  }
}

/** One write with the key rules of every page: a NEW intent takes a new key, an unknown outcome keeps it so a retry cannot run twice. */
class Writer {
  #pending: string | undefined;
  constructor(private readonly host: OpsHost) {}

  get pending(): boolean {
    return this.#pending !== undefined;
  }

  async run<T>(send: (key: string) => Promise<OpsWrite<T>>): Promise<OpsWrite<T>> {
    const key = this.#pending ?? this.host.newKey();
    const result = await send(key);
    if (result.kind === 'unknown') {
      this.#pending = key;
    } else {
      this.#pending = undefined;
    }
    if (result.kind === 'session-expired') {
      this.host.onSessionLost();
    } else if (result.kind === 'forbidden') {
      this.host.onForbidden();
    }
    return result;
  }

  forget(): void {
    this.#pending = undefined;
  }
}

const writeText = (r: OpsWrite<unknown>): string | undefined => (r.kind === 'ok' ? undefined : WRITE_MESSAGE[r.kind]);

function maintenanceList(items: readonly OpsMaintenance[], cancel?: (m: OpsMaintenance) => void): HTMLElement {
  if (items.length === 0) return h('p', { class: 'hint' }, 'Không có cửa sổ bảo trì.');
  const STATE: Record<OpsMaintenance['state'], [string, Tone]> = { ACTIVE: ['Đang bảo trì', 'wait'], SCHEDULED: ['Đã lên lịch', 'neutral'], ENDED: ['Đã kết thúc', 'neutral'], CANCELLED: ['Đã hủy', 'neutral'] };
  return h(
    'ul',
    { class: 'plain-list' },
    ...items.map((m) => {
      const [label, tone] = STATE[m.state];
      const row = h('li', {}, badge(label, tone), ' ', `${m.scopeLabels.join(', ')} · ${formatDateTime(m.startsAt)} → ${formatDateTime(m.endsAt)} · ${m.reason}`);
      if (cancel !== undefined && (m.state === 'ACTIVE' || m.state === 'SCHEDULED')) {
        const b = secondary('Hủy bảo trì');
        b.classList.add('btn-inline');
        b.addEventListener('click', () => cancel(m));
        row.append(' ', b);
      }
      return row;
    }),
  );
}

// ---- Tổng quan ------------------------------------------------------------------------------------------------------------------------

export class OpsOverviewView extends Page {
  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-overview', 'Tổng quan vận hành');
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.loading();
    const read = await this.host.source.overview();
    if (!this.current(token) || !this.check(read, () => void this.load())) return;
    this.draw(read.data);
  }

  private draw(o: OpsOverview): void {
    const tiles = o.components.map((c) =>
      h(
        'div',
        { class: `ops-tile ops-tile-${c.state.toLowerCase()}` },
        h('div', { class: 'ops-tile-head' }, h('span', { class: 'ops-tile-name' }, c.label), stateBadge(c.state)),
        h('p', { class: 'ops-tile-text' }, c.detail ?? (c.state === 'OK' ? 'Bình thường' : c.state === 'STALE' ? 'Đã lâu chưa có số đo mới' : 'Chưa có số đo nào')),
        c.note === null ? undefined : h('p', { class: 'hint' }, c.note),
        c.observedAt === null ? undefined : h('p', { class: 'hint' }, `Đo lúc ${hhmm(c.observedAt)}`),
      ),
    );
    const rows = o.incidents.map((i) => this.incidentRow(i));
    const incidents = tableCard(
      'Sự cố đang mở',
      [{ label: 'Mã sự cố' }, { label: 'Thời gian' }, { label: 'Thành phần' }, { label: 'Mô tả' }, { label: 'Mức độ' }, { label: 'Trạng thái' }, { label: 'Người xử lý' }],
      rows,
      rows.length === 0 ? emptyPanel('Không có sự cố đang mở', o.components.some((c) => c.state === 'NO_DATA' || c.state === 'STALE') ? 'Một số thành phần chưa có dữ liệu mới nên chưa thể coi là bình thường.' : 'Mọi kiểm tra đang bình thường.') : undefined,
    );
    const viewAll = h('a', { href: '/system-ops/incidents', class: 'table-link' }, 'Xem tất cả sự cố');
    viewAll.addEventListener('click', (e) => {
      e.preventDefault();
      this.host.go({ name: 'ops-incidents' });
    });
    const probe = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Giám sát ngoài VPS'),
      h('p', {}, badge(o.probe.label, o.probe.activated ? 'ok' : 'neutral')),
      h('p', { class: 'hint' }, o.probe.note),
      o.probe.lastReportAt === null ? undefined : h('p', { class: 'hint' }, `Báo cáo gần nhất: ${formatDateTime(o.probe.lastReportAt)}`),
    );
    const discord = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Kênh cảnh báo Discord'),
      h('p', {}, badge(o.discord.configured ? (o.discord.enabled ? 'Đang bật' : 'Đang tắt') : 'Chưa cấu hình', o.discord.configured && o.discord.enabled ? 'ok' : 'neutral')),
      h('p', { class: 'hint' }, `Đang chờ gửi: ${o.discord.pending} · Gửi thất bại 7 ngày: ${o.discord.failed7d} · Gửi thành công gần nhất: ${when(o.discord.lastSentAt)}`),
    );
    const last = o.lastUpdate;
    const update = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Lần cập nhật cuối'),
      last === null ? h('p', { class: 'hint' }, 'Chưa có báo cáo triển khai nào từ pipeline.') : h('p', {}, `${last.componentLabel} ${last.toVersion} · ${deployStatusText(last)} · ${formatDateTime(last.startedAt)}`),
    );
    const summary = h('p', { class: 'hint', role: 'status' }, `Đang mở: ${o.open} · Nghiêm trọng: ${o.critical} · Chưa nhận xử lý: ${o.unacknowledged}`);
    this.body.replaceChildren(
      updatedBar(o.updatedAt, () => void this.load()),
      o.dataNote === null ? h('span') : h('p', { class: 'message message-warning', role: 'status' }, o.dataNote),
      o.maintenance.length === 0 ? h('span') : h('div', { class: 'message message-warning', role: 'status' }, h('strong', {}, 'Đang bảo trì: '), maintenanceList(o.maintenance)),
      h('div', { class: 'ops-grid' }, ...tiles),
      h('h2', { class: 'subtitle' }, 'Sự cố đang mở'),
      summary,
      incidents,
      h('p', {}, viewAll),
      h('div', { class: 'ops-grid ops-grid-2' }, probe, discord, update),
    );
  }

  private incidentRow(i: OpsIncident): HTMLElement {
    return incidentRow(i, this.host);
  }
}

function deployStatusText(d: OpsDeploy): string {
  const status = d.status === 'SUCCEEDED' ? 'Thành công' : d.status === 'FAILED' ? 'Thất bại' : d.status === 'ROLLED_BACK' ? 'Đã quay lại bản trước' : 'Đang chạy';
  return d.healthResult === null ? status : `${status}, health check ${d.healthResult === 'PASSED' ? 'đạt' : 'không đạt'}`;
}

function incidentRow(i: OpsIncident, host: OpsHost): HTMLElement {
  const link = h('a', { href: `/system-ops/incidents/${i.code}`, class: 'table-link' }, i.code);
  link.addEventListener('click', (e) => {
    e.preventDefault();
    host.go({ name: 'ops-incident', ref: i.code });
  });
  const still = i.status === 'CLOSED' || i.status === 'RECOVERED' ? (i.checkState !== null && i.checkState !== 'OK' ? h('div', { class: 'hint' }, `Kiểm tra hiện tại: ${STATE_LABEL[i.checkState]}`) : undefined) : undefined;
  return h(
    'tr',
    {},
    cell('Mã sự cố', link),
    cell('Thời gian', formatDateTime(i.firstSeenAt)),
    cell('Thành phần', i.sourceLabel),
    cell('Mô tả', i.title, i.occurrences > 1 ? h('div', { class: 'hint' }, `${i.occurrences} lần`) : undefined, still),
    cell('Mức độ', severityBadge(i.severity)),
    cell('Trạng thái', statusBadge(i.status)),
    cell('Người xử lý', i.assigneeLabel ?? 'Chưa nhận'),
  );
}

// ---- Sự cố: danh sách -----------------------------------------------------------------------------------------------------------------

const STATUS_FILTERS: ReadonlyArray<readonly [string, string]> = [['OPEN', 'Đang mở'], ['ALL', 'Tất cả'], ...INCIDENT_STATUSES.map((s): readonly [string, string] => [s, STATUS_LABEL[s]])];

export class OpsIncidentsView extends Page {
  #query: IncidentQuery = DEFAULT_INCIDENT_QUERY;
  readonly #results = h('div', {});
  #status!: HTMLSelectElement;
  #severity!: HTMLSelectElement;
  #source!: HTMLSelectElement;
  #assignee!: HTMLSelectElement;
  #from!: HTMLInputElement;
  #to!: HTMLInputElement;
  #search!: HTMLInputElement;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-incidents', 'Sự cố');
    this.#status = select('ops-inc-status', 'Trạng thái', STATUS_FILTERS, 'OPEN');
    this.#severity = select('ops-inc-severity', 'Mức độ', [['', 'Mọi mức độ'], ['CRITICAL', 'Nghiêm trọng'], ['WARNING', 'Cảnh báo']], '');
    this.#source = select('ops-inc-source', 'Nguồn', SOURCE_FILTERS, '');
    this.#assignee = select('ops-inc-assignee', 'Người phụ trách', [['', 'Mọi người phụ trách'], ['NONE', 'Chưa có người nhận']], '');
    this.#from = input('ops-inc-from', 'Từ ngày', 'date');
    this.#to = input('ops-inc-to', 'Đến ngày', 'date');
    this.#search = input('ops-inc-search', 'Mã sự cố (SC-013)', 'search', '', { maxlength: '24' });
    for (const el of [this.#status, this.#severity, this.#source, this.#assignee, this.#from, this.#to]) el.addEventListener('change', () => this.#changed());
    this.#search.addEventListener('input', () => {
      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#changed(), 300);
    });
    this.body.replaceChildren(h('div', { class: 'toolbar toolbar-filters' }, this.#status, this.#severity, this.#source, this.#assignee, this.#from, this.#to, this.#search), this.#results);
  }

  override dispose(): void {
    super.dispose();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  #changed(): void {
    this.#query = {
      status: this.#status.value as IncidentQuery['status'],
      severity: this.#severity.value as IncidentQuery['severity'],
      source: this.#source.value,
      assignee: this.#assignee.value as IncidentQuery['assignee'],
      from: this.#from.value,
      to: this.#to.value,
      search: this.#search.value,
      page: 1,
    };
    void this.load();
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.#results.replaceChildren(skeleton(4));
    const read = await this.host.source.incidents(this.#query);
    if (!this.current(token)) return;
    if (read.kind !== 'ready') {
      if (read.kind === 'failed' && read.failure === 'session-expired') this.host.onSessionLost();
      if (read.kind === 'failed' && read.failure === 'forbidden') this.host.onForbidden();
      this.#results.replaceChildren(read.kind === 'failed' ? failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) : emptyPanel('Không có kết quả', 'Thử đổi bộ lọc.'));
      return;
    }
    const { rows, total } = read.data;
    const table = tableCard(
      'Danh sách sự cố',
      [{ label: 'Mã sự cố' }, { label: 'Thời gian' }, { label: 'Thành phần' }, { label: 'Mô tả' }, { label: 'Mức độ' }, { label: 'Trạng thái' }, { label: 'Người xử lý' }],
      rows.map((r) => incidentRow(r, this.host)),
      rows.length === 0 ? emptyPanel('Không có sự cố phù hợp', 'Thử đổi bộ lọc hoặc khoảng thời gian.') : undefined,
    );
    this.#results.replaceChildren(updatedBar(new Date().toISOString(), () => void this.load()), table, pager(total, this.#query.page, (page) => {
      this.#query = { ...this.#query, page };
      void this.load();
    }));
  }
}

// ---- Sự cố: chi tiết ------------------------------------------------------------------------------------------------------------------

export class OpsIncidentDetailView extends Page {
  readonly #writer = new Writer(this.host);
  readonly #message = notice('error');
  #busy = false;

  constructor(
    root: HTMLElement,
    host: OpsHost,
    private readonly ref: string,
  ) {
    super(root, host, 'ops-incident', 'Chi tiết sự cố');
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.loading();
    const read = await this.host.source.incident(this.ref);
    if (!this.current(token) || !this.check(read, () => void this.load())) return;
    this.draw(read.data);
  }

  async #act(detail: IncidentDetail, action: IncidentAction): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    this.#message.set(undefined);
    const result = await this.#writer.run((key) => this.host.source.incidentAction(detail.incident.id, key, action));
    this.#busy = false;
    if (this.disposed) return;
    if (result.kind === 'ok') {
      await this.load();
      return;
    }
    this.#message.set(writeText(result));
    if (result.kind === 'conflict') {
      this.#writer.forget();
    }
  }

  private draw(d: IncidentDetail): void {
    const i = d.incident;
    const can = d.actions;
    const buttons: HTMLElement[] = [];
    const add = (label: string, enabled: boolean, run: () => void, kind: 'primary' | 'secondary' = 'secondary'): void => {
      if (!enabled) return;
      const b = kind === 'primary' ? primary(label, 'button') : secondary(label);
      b.classList.add('btn-inline');
      b.addEventListener('click', run);
      buttons.push(b);
    };
    add('Nhận xử lý', can.acknowledge, () => void this.#act(d, { kind: 'acknowledge', version: i.version }), 'primary');
    add('Bắt đầu xử lý', can.start && i.status !== 'NEW', () => void this.#act(d, { kind: 'start', version: i.version }));
    const note = h('textarea', { id: 'ops-note', class: 'search-input', rows: '2', maxlength: '500', 'aria-label': 'Ghi chú', placeholder: 'Ghi chú xử lý (không nhập mật khẩu, OTP hay khóa)' });
    const noteBtn = secondary('Thêm ghi chú');
    noteBtn.classList.add('btn-inline');
    noteBtn.addEventListener('click', () => {
      const text = note.value.trim();
      if (text !== '') void this.#act(d, { kind: 'note', text }).then(() => undefined);
    });
    const snooze = select('ops-snooze', 'Tạm hoãn nhắc', [['30', '30 phút'], ['60', '1 giờ'], ['120', '2 giờ'], ['240', '4 giờ'], ['1440', '24 giờ']], '60');
    const snoozeBtn = secondary('Tạm hoãn nhắc');
    snoozeBtn.classList.add('btn-inline');
    snoozeBtn.addEventListener('click', () => void this.#act(d, { kind: 'snooze', version: i.version, minutes: Number(snooze.value) }));
    add('Đóng sự cố…', can.close, () => this.#closeDialog(d));

    const stillFailing = d.currentCheck.state !== 'OK';
    const timeline = h(
      'ol',
      { class: 'ops-timeline' },
      ...d.timeline.map((e) => h('li', { class: `ops-timeline-${e.level.toLowerCase()}` }, h('span', { class: 'ops-timeline-time' }, formatDateTime(e.at)), ' ', h('strong', {}, e.message), e.actor === null ? undefined : h('span', { class: 'hint' }, ` · ${e.actor}`))),
    );
    const notices =
      d.notices.length === 0
        ? h('p', { class: 'hint' }, 'Chưa có tin Discord nào cho sự cố này.')
        : tableCard('Lịch sử gửi Discord', [{ label: 'Loại tin' }, { label: 'Kết quả' }, { label: 'Số lần thử' }, { label: 'Tạo lúc' }], d.notices.map((n) => h('tr', {}, cell('Loại tin', n.kindLabel), cell('Kết quả', n.outcome, n.errorCode === null ? undefined : h('div', { class: 'hint' }, `Mã lỗi: ${n.errorCode}`)), cell('Số lần thử', String(n.attempts)), cell('Tạo lúc', when(n.sentAt ?? n.createdAt)))));
    const evidenceEntries = Object.entries(d.currentCheck.value).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 10);

    this.body.replaceChildren(
      h('div', { class: 'detail-head' }, h('h2', { class: 'subtitle' }, `${i.code} · ${i.title}`), severityBadge(i.severity), ' ', statusBadge(i.status)),
      h('p', { class: 'message message-warning', role: 'status' }, d.readNote),
      stillFailing && (i.status === 'CLOSED' || i.status === 'RECOVERED' || i.status === 'ACKNOWLEDGED' || i.status === 'IN_PROGRESS')
        ? h('p', { class: 'message message-error', role: 'alert' }, `Kiểm tra hiện tại: ${STATE_LABEL[d.currentCheck.state]}${d.currentCheck.evidence === null ? '' : ` — ${d.currentCheck.evidence}`}. Trạng thái xử lý không thay đổi tình trạng thật của hệ thống.`)
        : h('span'),
      i.closedWhileFailing ? h('p', { class: 'message message-warning', role: 'status' }, 'Sự cố này được đóng thủ công khi kiểm tra chưa xác nhận bình thường. Nếu lỗi còn, một sự cố mới liên kết sẽ được mở.') : h('span'),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Thông tin sự cố'), definition([
        ['Mô tả / ảnh hưởng', dash(i.impact)],
        ['Thành phần', i.sourceLabel],
        ['Mức độ', severityBadge(i.severity)],
        ['Phát hiện lần đầu', formatDateTime(i.firstSeenAt)],
        ['Lần cuối', formatDateTime(i.lastSeenAt)],
        ['Số lần', String(i.occurrences)],
        ['Phát hiện bởi', i.detectedBy === 'EXTERNAL_PROBE' ? 'Giám sát ngoài VPS' : i.detectedBy === 'APP_REPORT' ? 'Báo cáo từ app' : 'Kiểm tra nội bộ'],
        ['Người phụ trách', i.assigneeLabel ?? 'Chưa nhận xử lý'],
        ['Đã mở xem lần đầu', i.firstViewedAt === null ? 'Chưa' : formatDateTime(i.firstViewedAt)],
        ['Nhận xử lý lúc', when(i.acknowledgedAt)],
        ['Phục hồi lúc', when(i.recoveredAt)],
        ['Đóng lúc', when(i.closedAt)],
        ['Tạm hoãn đến', when(i.snoozedUntil)],
        ['Đang bảo trì', i.inMaintenance ? 'Có (tạm ngừng gửi Discord)' : 'Không'],
      ])),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Bằng chứng / giá trị đo'), definition([
        ['Kết luận', d.evidenceText ?? 'Chưa có'],
        ['Kiểm tra hiện tại', h('span', {}, stateBadge(d.currentCheck.state), ' ', d.currentCheck.evidence ?? '')],
        ['Đo lúc', when(d.currentCheck.observedAt)],
        ...evidenceEntries.map(([k, v]): readonly [string, string] => [k, String(v)]),
      ])),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Trạng thái xử lý'), timeline),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Thông báo Discord'), notices, d.link === null ? undefined : h('p', { class: 'hint' }, `Liên kết trong tin Discord: ${d.link} (cần đăng nhập Admin và có quyền)`)),
      d.recentErrors.length === 0 ? h('span') : h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Lỗi kỹ thuật gần đây của nguồn này'), h('ul', { class: 'plain-list' }, ...d.recentErrors.map((e) => h('li', {}, `${formatDateTime(e.at)} · ${e.message}`)))),
      can.note || buttons.length > 0 || can.snooze
        ? h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Xử lý'), this.#message.element, h('div', { class: 'detail-actions' }, ...buttons), can.note ? labelled('Ghi chú', note) : undefined, can.note ? h('div', { class: 'detail-actions' }, noteBtn) : undefined, can.snooze ? h('div', { class: 'detail-actions' }, snooze, snoozeBtn) : undefined, this.#writer.pending ? h('p', { class: 'hint' }, 'Thao tác trước chưa rõ kết quả: bấm lại sẽ gửi lại cùng yêu cầu, không chạy hai lần.') : undefined)
        : h('section', { class: 'detail-block' }, h('p', { class: 'hint' }, `Quyền của bạn: ${LEVEL_LABEL[this.host.level()]}. Bạn chỉ có thể xem sự cố này.`)),
    );
  }

  #closeDialog(d: IncidentDetail): void {
    const stillFailing = d.currentCheck.state !== 'OK' && d.incident.status !== 'RECOVERED';
    const confirm = h('input', { type: 'checkbox', id: 'ops-close-confirm' });
    const reason = h('textarea', { id: 'ops-close-note', class: 'search-input', rows: '2', maxlength: '300', 'aria-label': 'Lý do đóng', placeholder: 'Lý do đóng' });
    const msg = notice('error');
    const cancel = secondary('Hủy');
    const ok = primary('Đóng sự cố', 'button');
    const dialog = openDialog({
      title: `Đóng ${d.incident.code}`,
      description: stillFailing ? `Kiểm tra hiện tại: ${STATE_LABEL[d.currentCheck.state]}. Đóng sự cố không làm lỗi biến mất; nếu lỗi còn, một sự cố mới sẽ được mở.` : 'Sự cố đã phục hồi. Đóng để kết thúc theo dõi.',
      body: [msg.element, ...(stillFailing ? [h('label', { class: 'check-row', for: 'ops-close-confirm' }, confirm, ' Tôi xác nhận kiểm tra chưa bình thường và vẫn muốn đóng'), reason] : [reason])],
      actions: [cancel, ok],
      onDismiss: () => dialog.close(),
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
    });
    cancel.addEventListener('click', () => dialog.close());
    ok.addEventListener('click', () => {
      const note = reason.value.trim();
      if (stillFailing && (!confirm.checked || note === '')) {
        msg.set('Hãy tick xác nhận và ghi lý do.');
        return;
      }
      dialog.close();
      void this.#act(d, { kind: 'close', version: d.incident.version, confirmStillFailing: stillFailing, note });
    });
  }
}

// ---- SMS Gateway ----------------------------------------------------------------------------------------------------------------------

export class OpsGatewayView extends Page {
  readonly #writer = new Writer(this.host);
  readonly #message = notice('error');

  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-gateway', 'SMS Gateway');
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.loading();
    const read = await this.host.source.gateway();
    if (!this.current(token) || !this.check(read, () => void this.load())) return;
    this.draw(read.data);
  }

  private device(d: GatewayDevice, page: GatewayPage): HTMLElement {
    const check = (c: GatewayCheck, label: string): HTMLElement => h('li', {}, h('strong', {}, `${label}: `), stateBadge(c.state), ' ', c.evidence ?? '');
    const tile = (label: string, value: string, extra?: HTMLElement): HTMLElement => h('div', { class: 'ops-tile ops-tile-plain' }, h('span', { class: 'ops-tile-name' }, label), h('p', { class: 'ops-tile-value' }, value), extra);
    const date = input(`ops-topup-${d.id}`, 'Ngày nạp SIM gần nhất', 'date', d.topupNotedOn ?? '');
    const save = secondary('Lưu ngày nạp');
    save.classList.add('btn-inline');
    save.addEventListener('click', () => {
      void this.#writer.run((key) => this.host.source.topupNote(d.id, key, date.value === '' ? null : date.value)).then((r) => {
        if (this.disposed) return;
        if (r.kind === 'ok') void this.load();
        else this.#message.set(writeText(r));
      });
    });
    return h(
      'section',
      { class: 'detail-block' },
      h('div', { class: 'detail-head' }, h('h2', { class: 'subtitle' }, d.label), stateBadge(d.state), ' ', h('span', { class: 'hint' }, `Phiên bản ${dash(d.appVersion)}`)),
      h(
        'div',
        { class: 'ops-grid' },
        tile('Pin', d.batteryPercent === null ? 'Chưa xác định' : `${d.batteryPercent}%`),
        tile('Trạng thái sạc', d.charging === null ? 'Chưa xác định' : d.charging ? 'Đang sạc' : 'Không sạc'),
        tile('Lần liên lạc cuối', d.lastContactAt === null ? 'Chưa có' : formatDateTime(d.lastContactAt)),
        tile('Phiên bản', dash(d.appVersion)),
      ),
      definition([
        ['Quyền SMS', d.smsPermission === null ? 'Chưa xác định' : d.smsPermission ? 'Đã cấp' : 'Chưa cấp'],
        ['SIM', d.simStateLabel],
        ['Số dư SIM', d.simBalanceLabel],
        ['Ngày nạp gần nhất (ghi tay)', d.topupNotedOn ?? 'Chưa ghi'],
        ['Tác vụ hiện tại', dash(d.currentTask)],
        ['Kết quả đang chờ báo', d.pendingReports === null ? 'Chưa xác định' : String(d.pendingReports)],
        ['Đang tạm dừng nhận việc', d.paused === null ? 'Chưa xác định' : d.paused ? 'Có' : 'Không'],
        ['Lỗi gần nhất', dash(d.lastErrorCode)],
        ['Máy báo lần cuối', when(d.telemetryAt)],
      ]),
      h('h3', { class: 'subtitle' }, 'Kết quả kiểm tra'),
      h('ul', { class: 'plain-list' }, check(d.checks.contact, 'Liên lạc'), check(d.checks.battery, 'Pin'), check(d.checks.power, 'Nguồn'), check(d.checks.sms_failures, 'Gửi SMS')),
      page.level === 'SYSTEM' ? h('div', { class: 'detail-actions' }, labelled('Ngày nạp SIM gần nhất (chủ thiết bị ghi tay)', date, 'Android không đọc được số dư SIM nên hiển thị "Chưa xác định".'), save) : undefined,
    );
  }

  private draw(p: GatewayPage): void {
    const jobs = tableCard(
      `Hàng đợi OTP (${p.queue.purposesLabel})`,
      [{ label: 'Thời gian' }, { label: 'Loại' }, { label: 'Trạng thái' }, { label: 'Mô tả' }],
      p.queue.jobs.map((j) => h('tr', {}, cell('Thời gian', hhmm(j.at)), cell('Loại', j.purposeLabel), cell('Trạng thái', badge(j.statusLabel, j.status === 'FAILED' ? 'lock' : j.status === 'SENT' ? 'ok' : 'wait')), cell('Mô tả', `Số …${j.recipientTail}${j.resultCode === null ? '' : ` · ${j.resultCode}`}`))),
      p.queue.jobs.length === 0 ? emptyPanel('Chưa có OTP nào trong hàng đợi', 'OTP chỉ dùng cho Đăng ký / Quên mật khẩu.') : undefined,
    );
    const queueState = h('p', {}, stateBadge(p.queue.otpState), ' ', p.queue.otpEvidence ?? '');
    const dc = p.discord;
    const discordBlock =
      dc === null
        ? undefined
        : h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Kênh cảnh báo Discord'), definition([['Trạng thái', dc.configured ? (dc.enabled ? 'Đã kết nối, đang bật' : 'Đã cấu hình, đang tắt') : 'Chưa cấu hình'], ['Webhook', dc.webhookMasked ?? 'Chưa có'], ['Mức gửi tối thiểu', dc.minSeverity === 'CRITICAL' ? 'Nghiêm trọng' : 'Cảnh báo']]), h('p', { class: 'hint' }, 'Chỉ SYSTEM chỉnh cấu hình. Giá trị webhook không bao giờ được hiển thị lại.'));
    const cfgLink = h('a', { href: '/system-ops/config', class: 'table-link' }, 'Cấu hình Discord, ngưỡng và bảo trì');
    cfgLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.host.go({ name: 'ops-config' });
    });
    this.body.replaceChildren(
      updatedBar(p.updatedAt, () => void this.load()),
      this.#message.element,
      p.devices.length === 0 ? emptyPanel('Chưa ghép Gateway nào', 'Ghép cặp một máy Gateway bằng công cụ vận hành (xem runbook SMS Gateway).') : h('div', {}, ...p.devices.map((d) => this.device(d, p))),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Hàng đợi OTP'), h('p', { class: 'hint' }, `Đang chờ: ${p.queue.queued} · Đang xử lý: ${p.queue.claimed} · Lỗi trong 1 giờ: ${p.queue.failedLastHour}`), queueState, jobs),
      discordBlock ?? h('span'),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Bảo trì'), maintenanceList(p.maintenance), h('p', {}, cfgLink)),
    );
  }
}

// ---- Nhật ký --------------------------------------------------------------------------------------------------------------------------

export class OpsLogsView extends Page {
  #query: LogQuery = DEFAULT_LOG_QUERY;
  readonly #results = h('div', {});
  readonly #fields: Record<string, HTMLSelectElement | HTMLInputElement>;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-logs', 'Nhật ký');
    const groups: Array<readonly [string, string]> = [['', 'Kỹ thuật và sự cố'], ['TECHNICAL', 'Kỹ thuật (API, Gateway, app, worker, M14)'], ['INCIDENT', 'Sự cố (phát hiện, gửi, xử lý, phục hồi)'], ...(host.level() === 'SYSTEM' ? ([['ADMIN', 'Quản trị (ai làm gì)']] as Array<readonly [string, string]>) : [])];
    this.#fields = {
      group: select('ops-log-group', 'Nhóm log', groups, ''),
      source: select('ops-log-source', 'Nguồn', SOURCE_FILTERS, ''),
      level: select('ops-log-level', 'Mức', [['', 'Mọi mức'], ['ERROR', 'Lỗi'], ['WARN', 'Cảnh báo'], ['INFO', 'Thông tin']], ''),
      code: input('ops-log-code', 'Mã lỗi', 'search', '', { maxlength: '48' }),
      deliveryCode: input('ops-log-delivery', 'Mã đơn', 'search', '', { maxlength: '32' }),
      userId: input('ops-log-user', 'Tài khoản (mã)', 'search', '', { maxlength: '36' }),
      appVersion: input('ops-log-version', 'Phiên bản', 'search', '', { maxlength: '32' }),
      from: input('ops-log-from', 'Từ ngày', 'date'),
      to: input('ops-log-to', 'Đến ngày', 'date'),
    };
    for (const el of Object.values(this.#fields)) {
      el.addEventListener(el instanceof HTMLSelectElement || el.type === 'date' ? 'change' : 'input', () => {
        if (this.#timer !== undefined) clearTimeout(this.#timer);
        this.#timer = setTimeout(() => this.#changed(), el instanceof HTMLSelectElement ? 0 : 300);
      });
    }
    this.body.replaceChildren(h('div', { class: 'toolbar toolbar-filters' }, ...Object.values(this.#fields)), this.#results);
  }

  override dispose(): void {
    super.dispose();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  #changed(): void {
    const v = (k: string): string => (this.#fields[k] as HTMLInputElement).value;
    this.#query = { group: v('group') as LogGroup, source: v('source'), level: v('level') as LogQuery['level'], code: v('code'), deliveryCode: v('deliveryCode'), userId: v('userId'), appVersion: v('appVersion'), from: v('from'), to: v('to'), page: 1 };
    void this.load();
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.#results.replaceChildren(skeleton(4));
    const read = await this.host.source.logs(this.#query);
    if (!this.current(token)) return;
    if (read.kind !== 'ready') {
      if (read.kind === 'failed' && read.failure === 'session-expired') this.host.onSessionLost();
      this.#results.replaceChildren(read.kind === 'failed' ? failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) : emptyPanel('Không có kết quả', 'Thử đổi bộ lọc.'));
      return;
    }
    const row = (r: LogRow): HTMLElement =>
      h('tr', {}, cell('Thời gian', formatDateTime(r.at)), cell('Mức', badge(r.level === 'ERROR' ? 'Lỗi' : r.level === 'WARN' ? 'Cảnh báo' : 'Thông tin', r.level === 'ERROR' ? 'lock' : r.level === 'WARN' ? 'wait' : 'neutral')), cell('Nguồn', r.sourceLabel), cell('Mã lỗi', dash(r.code)), cell('Nội dung', r.message, r.actor === null ? undefined : h('div', { class: 'hint' }, r.actor)), cell('Mã đơn', dash(r.deliveryCode)), cell('Tài khoản', r.userId === null ? '—' : `…${r.userId.slice(-6)}`), cell('Phiên bản', dash(r.appVersion)));
    this.#results.replaceChildren(
      updatedBar(new Date().toISOString(), () => void this.load()),
      tableCard('Nhật ký vận hành', [{ label: 'Thời gian' }, { label: 'Mức' }, { label: 'Nguồn' }, { label: 'Mã lỗi' }, { label: 'Nội dung' }, { label: 'Mã đơn' }, { label: 'Tài khoản' }, { label: 'Phiên bản' }], read.data.rows.map(row), read.data.rows.length === 0 ? emptyPanel('Không có dòng nhật ký', 'Không có dòng nào khớp bộ lọc trong thời gian lưu giữ.') : undefined),
      h('p', { class: 'hint' }, 'Nhật ký chỉ ghi thêm, không ai sửa được. Mật khẩu, OTP, token, webhook không bao giờ được ghi; số điện thoại luôn bị che.'),
      pager(read.data.total, this.#query.page, (page) => {
        this.#query = { ...this.#query, page };
        void this.load();
      }),
    );
  }
}

// ---- Phiên bản & cập nhật -------------------------------------------------------------------------------------------------------------

type ReleaseTab = 'android' | 'server' | 'history';
const ANDROID = ['FOOD', 'SHIP', 'GATEWAY'];

export class OpsReleasesView extends Page {
  #tab: ReleaseTab = 'android';
  #page = 1;
  #data: ReleasesPage | undefined;
  #selected: string | undefined;
  readonly #writer = new Writer(this.host);
  readonly #message = notice('error');
  readonly #tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Phiên bản và cập nhật' });
  readonly #content = h('div', {});

  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-releases', 'Phiên bản & cập nhật');
    this.body.replaceChildren(this.#tabs, this.#message.element, this.#content);
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.#content.replaceChildren(skeleton(4));
    const read = await this.host.source.releases(this.#page);
    if (!this.current(token)) return;
    if (read.kind !== 'ready') {
      if (read.kind === 'failed' && read.failure === 'session-expired') this.host.onSessionLost();
      if (read.kind === 'failed' && read.failure === 'forbidden') this.host.onForbidden();
      this.#content.replaceChildren(read.kind === 'failed' ? failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec) : emptyPanel('Không có dữ liệu', ''));
      return;
    }
    this.#data = read.data;
    this.#draw();
  }

  #draw(): void {
    const data = this.#data;
    if (data === undefined) return;
    this.#tabs.replaceChildren(
      ...(
        [
          ['android', 'Ứng dụng Android'],
          ['server', 'Server'],
          ['history', 'Lịch sử'],
        ] as const
      ).map(([id, label]) => {
        const b = h('button', { type: 'button', role: 'tab', class: `tab${this.#tab === id ? ' tab-active' : ''}`, 'aria-selected': this.#tab === id ? 'true' : 'false' }, label);
        b.addEventListener('click', () => {
          this.#tab = id;
          this.#draw();
        });
        return b;
      }),
    );
    const content = this.#tab === 'android' ? this.#android(data) : this.#tab === 'server' ? this.#server(data) : this.#history(data);
    this.#content.replaceChildren(updatedBar(data.updatedAt, () => void this.load()), content);
  }

  #statusCell(c: ComponentVersion): HTMLElement {
    const tone: Tone = c.status === 'CURRENT' ? 'ok' : c.status === 'UPDATE_AVAILABLE' ? 'wait' : 'neutral';
    return badge(c.statusLabel, tone);
  }

  #android(data: ReleasesPage): HTMLElement {
    const comps = data.components.filter((c) => ANDROID.includes(c.component));
    const selected = comps.find((c) => c.component === this.#selected) ?? comps[0];
    const rows = comps.map((c) => {
      const tr = h('tr', { class: c === selected ? 'row-selected' : '' }, cell('Thành phần', c.label), cell('Đang chạy', c.running === null ? 'Chưa có báo cáo từ thiết bị' : `${c.running.versionName} (${c.running.reporters} thiết bị)`), cell('Bản phát hành', c.published === null ? 'Chưa phát hành' : c.published.versionName), cell('Trạng thái', this.#statusCell(c)));
      tr.addEventListener('click', () => {
        this.#selected = c.component;
        this.#draw();
      });
      return tr;
    });
    const p = selected?.published ?? null;
    const detail = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, p === null ? `${selected?.label ?? ''}: chưa có bản phát hành` : `${p.componentLabel} ${p.versionName}`),
      p === null
        ? h('p', { class: 'hint' }, 'Chưa có bản nào được phát hành. "Có bản mới" chỉ hiện khi có bản đã phát hành và thiết bị đã báo phiên bản cũ hơn.')
        : h(
            'div',
            {},
            p.priority === 'NORMAL' ? undefined : badge(p.priority === 'REQUIRED' ? 'Bắt buộc cập nhật' : 'Khuyến nghị cập nhật', p.priority === 'REQUIRED' ? 'lock' : 'wait'),
            definition([
              ['Ngày phát hành', when(p.releasedAt)],
              ['Kích thước', p.artifact?.sizeBytes == null ? '—' : `${(p.artifact.sizeBytes / 1_048_576).toFixed(1)} MB`],
              ['Mã kiểm tra SHA-256', p.artifact?.sha256 ?? '—'],
              ['Lý do bắt buộc', dash(p.requiredReason)],
            ]),
            h('h3', { class: 'subtitle' }, 'Nội dung cập nhật'),
            h('p', { class: 'summary' }, p.releaseNotes),
            p.hasDbMigration && p.rollbackWarning !== null ? h('p', { class: 'message message-warning' }, p.rollbackWarning) : undefined,
            this.#downloadControl(p),
          ),
    );
    return h('div', {}, tableCard('Danh sách phiên bản Android', [{ label: 'Thành phần' }, { label: 'Đang chạy' }, { label: 'Bản phát hành' }, { label: 'Trạng thái' }], rows), detail, h('p', { class: 'hint' }, data.androidNote), h('div', { class: 'message message-warning', role: 'status' }, h('strong', {}, 'Gateway: '), data.gatewayRule));
  }

  #downloadControl(p: ReleaseRow): HTMLElement {
    if (p.status !== 'PUBLISHED' || p.artifact === null) return h('p', { class: 'hint' }, 'Chưa có tệp để tải.');
    if (p.component === 'GATEWAY') return h('p', { class: 'hint' }, 'Gateway tự tải bản cập nhật từ máy chủ khi đã dừng nhận việc mới và không còn tác vụ hay kết quả tồn; không có đường tải công khai.');
    const link = h('a', { href: `/v1/app-updates/download/${p.id}`, class: 'btn btn-primary btn-inline', download: p.artifact.name }, icon('file', 18), 'Tải APK');
    return h('div', { class: 'detail-actions' }, link, h('span', { class: 'hint' }, 'App kiểm tra mã SHA-256 trước khi mở cài đặt. Android vẫn yêu cầu người dùng xác nhận cài.'));
  }

  #server(data: ReleasesPage): HTMLElement {
    const comps = data.components.filter((c) => !ANDROID.includes(c.component));
    const table = tableCard(
      'Phiên bản server',
      [{ label: 'Thành phần' }, { label: 'Đang chạy' }, { label: 'Bản phát hành' }, { label: 'Trạng thái' }],
      comps.map((c) => h('tr', {}, cell('Thành phần', c.label), cell('Đang chạy', c.running === null ? 'Chưa có báo cáo từ dịch vụ' : c.running.versionName), cell('Bản phát hành', c.published === null ? 'Chưa phát hành' : c.published.versionName), cell('Trạng thái', this.#statusCell(c)))),
    );
    const deploy = h('button', { type: 'button', class: 'btn btn-secondary btn-inline', disabled: true, 'aria-disabled': 'true' }, icon('lock', 18), 'Triển khai (SYSTEM)');
    const last = data.deploys[0];
    return h(
      'div',
      {},
      table,
      h(
        'section',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Triển khai server'),
        h('p', {}, deploy),
        data.deployControl.available ? undefined : h('div', { class: 'message message-warning', role: 'status' }, h('strong', {}, 'Chưa dùng được vì: '), h('ul', { class: 'plain-list' }, ...data.deployControl.missing.map((m) => h('li', {}, m)))),
        last === undefined ? h('p', { class: 'hint' }, 'Chưa có báo cáo triển khai nào.') : h('p', {}, h('strong', {}, 'Kết quả triển khai gần nhất: '), `${last.componentLabel} ${last.toVersion} · ${deployStatusText(last)} · ${formatDateTime(last.startedAt)}`),
        h('p', { class: 'hint' }, 'Quay lại bản ứng dụng trước và quay lại cơ sở dữ liệu là hai việc khác nhau: thay đổi cơ sở dữ liệu cần đánh giá riêng, không có khôi phục tự động.'),
      ),
    );
  }

  #history(data: ReleasesPage): HTMLElement {
    const system = this.host.level() === 'SYSTEM';
    const deploys = tableCard(
      'Lịch sử cập nhật',
      [{ label: 'Thời gian' }, { label: 'Thành phần' }, { label: 'Phiên bản' }, { label: 'Kết quả' }, { label: 'Health check' }],
      data.deploys.map((d) => h('tr', {}, cell('Thời gian', formatDateTime(d.startedAt)), cell('Thành phần', d.componentLabel), cell('Phiên bản', `${d.fromVersion === null ? '' : `${d.fromVersion} → `}${d.toVersion}`), cell('Kết quả', badge(deployStatusText(d), d.status === 'SUCCEEDED' ? 'ok' : d.status === 'RUNNING' ? 'wait' : 'lock'), d.hasDbMigration ? h('div', { class: 'hint' }, 'Có thay đổi cơ sở dữ liệu') : undefined), cell('Health check', d.healthResult === null ? 'Chưa báo' : d.healthResult === 'PASSED' ? 'Đạt' : 'Không đạt', d.healthDetail === null ? undefined : h('div', { class: 'hint' }, d.healthDetail)))),
      data.deploys.length === 0 ? emptyPanel('Chưa có lịch sử triển khai', 'Pipeline triển khai báo kết quả về đây khi chạy.') : undefined,
    );
    const releases = tableCard(
      'Các bản phát hành',
      [{ label: 'Thành phần' }, { label: 'Phiên bản' }, { label: 'Ngày' }, { label: 'Trạng thái' }, { label: 'Thiết bị đang chạy' }, ...(system ? [{ label: 'Thao tác', end: true }] : [])],
      data.releases.map((r) => this.#releaseRow(r, system)),
      data.releases.length === 0 ? emptyPanel('Chưa có bản phát hành nào', system ? 'Đăng ký bản đầu tiên bên dưới.' : 'SYSTEM sẽ đăng ký bản phát hành.') : undefined,
    );
    return h('div', {}, h('h2', { class: 'subtitle' }, 'Triển khai'), deploys, h('h2', { class: 'subtitle' }, 'Bản phát hành'), releases, pager(data.total, this.#page, (page) => {
        this.#page = page;
        void this.load();
      }), system ? this.#form(data) : h('span'));
  }

  #releaseRow(r: ReleaseRow, system: boolean): HTMLElement {
    const actions: HTMLElement[] = [];
    const act = (label: string, to: 'publish' | 'withdraw'): void => {
      const b = secondary(label);
      b.classList.add('btn-inline');
      b.addEventListener('click', () => {
        void this.#writer.run((key) => this.host.source.releaseStatus(r.id, key, r.version, to)).then((res) => {
          if (this.disposed) return;
          this.#message.set(writeText(res));
          if (res.kind === 'ok') void this.load();
        });
      });
      actions.push(b);
    };
    if (r.status === 'DRAFT') act('Phát hành', 'publish');
    if (r.status === 'PUBLISHED') act('Thu hồi', 'withdraw');
    return h(
      'tr',
      {},
      cell('Thành phần', r.componentLabel),
      cell('Phiên bản', `${r.versionName}${r.versionCode === null ? '' : ` (${r.versionCode})`}`, r.hasDbMigration ? h('div', { class: 'hint' }, 'Có thay đổi cơ sở dữ liệu') : undefined),
      cell('Ngày', when(r.releasedAt)),
      cell('Trạng thái', badge(r.status === 'PUBLISHED' ? 'Đã phát hành' : r.status === 'DRAFT' ? 'Bản nháp' : 'Đã thu hồi', r.status === 'PUBLISHED' ? 'ok' : 'neutral')),
      cell('Thiết bị đang chạy', r.reportersRunning === null ? '—' : r.reportersRunning === 0 ? 'Chưa có báo cáo' : String(r.reportersRunning)),
      ...(system ? [h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, ...actions)] : []),
    );
  }

  #form(data: ReleasesPage): HTMLElement {
    const f = {
      component: select('rel-component', 'Thành phần', [['FOOD', '11Food'], ['SHIP', '11Ship'], ['GATEWAY', 'SMS Gateway'], ['WEB_ADMIN', 'Web Admin'], ['BACKEND', 'Backend / worker'], ['M14', 'Dịch vụ M14'], ['MAP_PACK', 'Gói bản đồ']], 'SHIP'),
      versionName: input('rel-version', 'Mã phiên bản (vd 1.0.2)', 'text', '', { maxlength: '32' }),
      versionCode: input('rel-code', 'versionCode (Android)', 'text', '', { inputmode: 'numeric', maxlength: '10' }),
      artifact: input('rel-artifact', 'Tên tệp APK trong thư mục phát hành của server', 'text', '', { maxlength: '96' }),
      priority: select('rel-priority', 'Mức cập nhật', [['NORMAL', 'Bình thường'], ['RECOMMENDED', 'Khuyến nghị'], ['REQUIRED', 'Bắt buộc']], 'RECOMMENDED'),
      reason: input('rel-reason', 'Lý do bắt buộc (tương thích/bảo mật)', 'text', '', { maxlength: '200' }),
      minCode: input('rel-min', 'versionCode tối thiểu còn được dùng', 'text', '', { inputmode: 'numeric', maxlength: '10' }),
      notes: h('textarea', { id: 'rel-notes', class: 'search-input', rows: '3', maxlength: '2000', 'aria-label': 'Nội dung cập nhật', placeholder: 'Nội dung cập nhật' }),
      rollback: input('rel-rollback', 'Ghi chú quay lại bản trước', 'text', '', { maxlength: '300' }),
      db: h('input', { type: 'checkbox', id: 'rel-db' }),
    };
    const save = primary('Đăng ký bản nháp', 'button');
    save.addEventListener('click', () => {
      const draft: ReleaseDraft = { component: f.component.value, versionName: f.versionName.value, versionCode: f.versionCode.value, releaseNotes: f.notes.value, artifactName: f.artifact.value, priority: f.priority.value as ReleaseDraft['priority'], requiredReason: f.reason.value, minSupportedVersionCode: f.minCode.value, hasDbMigration: f.db.checked, rollbackNote: f.rollback.value };
      void this.#writer.run((key) => this.host.source.createRelease(key, draft)).then((res) => {
        if (this.disposed) return;
        this.#message.set(writeText(res));
        if (res.kind === 'ok') void this.load();
      });
    });
    return h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Đăng ký bản phát hành'),
      h('p', { class: 'hint' }, data.artifactsAvailable ? 'Máy chủ tự đọc tệp trong thư mục phát hành của chính nó để tính SHA-256 và kích thước; không nhận đường dẫn hay liên kết tùy ý.' : 'Máy chủ chưa cấu hình thư mục phát hành (OPS_ARTIFACT_DIR): chưa đăng ký được bản có tệp APK.'),
      labelled('Thành phần', f.component),
      labelled('Mã phiên bản', f.versionName),
      labelled('versionCode', f.versionCode),
      labelled('Tên tệp APK', f.artifact),
      labelled('Mức cập nhật', f.priority),
      labelled('Lý do bắt buộc', f.reason),
      labelled('versionCode tối thiểu', f.minCode),
      labelled('Nội dung cập nhật', f.notes),
      labelled('Ghi chú quay lại', f.rollback),
      h('label', { class: 'check-row', for: 'rel-db' }, f.db, ' Bản này có thay đổi cơ sở dữ liệu (quay lại cần đánh giá riêng)'),
      h('div', { class: 'detail-actions' }, save),
    );
  }
}

// ---- Cấu hình và bảo trì --------------------------------------------------------------------------------------------------------------

const GROUP_LABEL: Record<string, string> = { gateway: 'SMS Gateway', server: 'Máy chủ', alert: 'Cảnh báo và nhắc', app: 'App, M08, M14', retention: 'Thời gian lưu' };
const UNIT: Record<string, string> = { seconds: 'giây', minutes: 'phút', hours: 'giờ', days: 'ngày', percent: '%', count: 'lần' };

export class OpsConfigView extends Page {
  readonly #writer = new Writer(this.host);
  readonly #message = notice('error');
  readonly #ok = notice('ok');
  #saving = false;

  constructor(root: HTMLElement, host: OpsHost) {
    super(root, host, 'ops-config', 'Cấu hình và bảo trì');
  }

  async load(): Promise<void> {
    const token = (this.latest += 1);
    this.loading();
    const read = await this.host.source.config();
    if (!this.current(token) || !this.check(read, () => void this.load())) return;
    this.draw(read.data);
  }

  private draw(c: OpsConfigPage): void {
    const edit = c.editable;
    const inputs = new Map<string, HTMLInputElement>();
    const groups = new Map<string, HTMLElement[]>();
    for (const s of c.settings) {
      const el = h('input', { id: `cfg-${s.key}`, class: 'search-input', type: 'number', min: String(s.min), max: String(s.max), step: '1', 'aria-label': s.label, disabled: !edit });
      el.value = String(s.value);
      inputs.set(s.key, el);
      const unit = UNIT[s.unit] ?? s.unit;
      const row = h('div', { class: 'field' }, h('label', { class: 'label', for: el.id }, `${s.label} (${unit})`), el, h('p', { class: 'hint' }, `Mặc định ${s.default} ${unit} · từ ${s.min} đến ${s.max}${s.implDefault ? ' · giá trị mặc định do hệ thống đề xuất, thiết kế chưa quy định' : ''}`));
      groups.set(s.group, [...(groups.get(s.group) ?? []), row]);
    }
    const dc = c.discord;
    const enabled = h('input', { type: 'checkbox', id: 'cfg-discord-enabled', disabled: !edit });
    enabled.checked = dc?.enabled ?? false;
    const severity = select('cfg-discord-min', 'Mức gửi tối thiểu', [['WARNING', 'Cảnh báo trở lên'], ['CRITICAL', 'Chỉ nghiêm trọng']], dc?.minSeverity ?? 'WARNING');
    severity.disabled = !edit;
    const webhook = h('input', { id: 'cfg-webhook', class: 'search-input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: dc?.webhookConfigured ? '•••••••••••••••• (đã cấu hình, nhập để thay)' : 'Dán URL webhook Discord', 'aria-label': 'Webhook Discord', maxlength: '220', disabled: !edit });
    const clear = h('input', { type: 'checkbox', id: 'cfg-webhook-clear', disabled: !edit || !(dc?.webhookConfigured ?? false) });
    const save = primary('Lưu cấu hình', 'button');
    save.disabled = !edit;
    const test = secondary('Gửi thử Discord');
    test.disabled = !edit || !(dc?.webhookConfigured ?? false);
    save.addEventListener('click', () => {
      if (this.#saving) return;
      const settings: Record<string, number> = {};
      for (const s of c.settings) {
        const v = inputs.get(s.key)?.value ?? '';
        const n = Number(v);
        if (v.trim() === '' || !Number.isInteger(n) || n < s.min || n > s.max) {
          this.#message.set(`"${s.label}" phải là số nguyên từ ${s.min} đến ${s.max}.`);
          return;
        }
        if (n !== s.value) settings[s.key] = n;
      }
      const typed = webhook.value.trim();
      const request: Omit<ConfigSave, 'key'> = { version: c.version, settings, discordEnabled: enabled.checked, minSeverity: severity.value as 'WARNING' | 'CRITICAL', webhook: clear.checked ? null : typed === '' ? undefined : typed };
      this.#saving = true;
      this.#message.set(undefined);
      this.#ok.set(undefined);
      void this.#writer.run((key) => this.host.source.saveConfig({ ...request, key })).then((r) => {
        this.#saving = false;
        if (this.disposed) return;
        if (r.kind === 'ok') {
          webhook.value = '';
          this.#ok.set('Đã lưu cấu hình. Thay đổi được ghi vào nhật ký quản trị (không ghi giá trị webhook).');
          this.draw(r.data);
          this.#ok.set('Đã lưu cấu hình. Thay đổi được ghi vào nhật ký quản trị (không ghi giá trị webhook).');
          return;
        }
        this.#message.set(writeText(r));
      });
    });
    test.addEventListener('click', () => {
      this.#message.set(undefined);
      void this.#writer.run((key) => this.host.source.discordTest(key)).then((r) => {
        if (this.disposed) return;
        if (r.kind === 'ok') this.#ok.set(`Kết quả gửi thử: ${r.data.outcomeText}`);
        else this.#message.set(writeText(r));
      });
    });

    // maintenance
    const scopes = MAINTENANCE_SCOPE_OPTIONS.map(([value, label]) => ({ value, label, box: h('input', { type: 'checkbox', id: `mnt-${value}` }) }));
    const reason = input('mnt-reason', 'Lý do bảo trì', 'text', '', { maxlength: '200' });
    const ends = input('mnt-ends', 'Kết thúc lúc', 'datetime-local');
    const create = primary('Tạo bảo trì', 'button');
    create.addEventListener('click', () => {
      const picked = scopes.filter((s) => s.box.checked).map((s) => s.value);
      if (picked.length === 0 || reason.value.trim().length < 3 || ends.value === '' || Number.isNaN(Date.parse(ends.value))) {
        this.#message.set('Chọn ít nhất một phạm vi, ghi lý do và giờ kết thúc.');
        return;
      }
      const key = this.host.newKey();
      void this.host.source.createMaintenance({ key, scopes: picked, reason: reason.value, endsAt: ends.value }).then((r) => {
        if (this.disposed) return;
        if (r.kind === 'ok') void this.load();
        else this.#message.set(writeText(r));
      });
    });
    const maintenance = h(
      'section',
      { class: 'detail-block' },
      h('h2', { class: 'subtitle' }, 'Bảo trì'),
      h('p', { class: 'hint' }, 'Bảo trì tạm ngừng gửi Discord cho phạm vi đã chọn đến giờ kết thúc, tối đa 72 giờ; nhật ký và kiểm tra vẫn chạy. Hết giờ cảnh báo tự bật lại; lỗi ngoài phạm vi vẫn được báo.'),
      maintenanceList(c.maintenance, edit ? (m) => void this.host.source.cancelMaintenance(m.id, this.host.newKey()).then((r) => (r.kind === 'ok' ? this.load() : this.#message.set(writeText(r)))) : undefined),
      edit ? h('div', {}, h('div', { class: 'chips' }, ...scopes.map((s) => h('label', { class: 'check-row', for: `mnt-${s.value}` }, s.box, ` ${s.label}`))), labelled('Lý do', reason), labelled('Kết thúc lúc', ends), h('div', { class: 'detail-actions' }, create)) : undefined,
    );

    const access =
      c.access === null
        ? undefined
        : h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Quyền vận hành hệ thống của quản trị viên'), h('p', { class: 'hint' }, 'Mặc định quản trị viên không thấy mục này. Cấp quyền từng người ở trang Quản trị viên (nút "Quyền vận hành").'), c.access.length === 0 ? h('p', { class: 'hint' }, 'Chưa cấp quyền cho ai.') : h('ul', { class: 'plain-list' }, ...c.access.map((a) => h('li', {}, `${a.label ?? a.userId}: ${LEVEL_LABEL[a.level]}`))));

    this.body.replaceChildren(
      updatedBar(c.updatedAt, () => void this.load()),
      edit ? h('span') : h('p', { class: 'message message-warning', role: 'status' }, `Bạn chỉ xem cấu hình (quyền: ${LEVEL_LABEL[c.level]}). Chỉ SYSTEM chỉnh cấu hình.`),
      this.#message.element,
      this.#ok.element,
      ...[...groups.entries()].map(([g, rows]) => h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, GROUP_LABEL[g] ?? g), ...rows)),
      dc === null
        ? h('span')
        : h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Kênh cảnh báo Discord'), h('p', { class: 'hint' }, `Webhook: ${dc.webhookConfigured ? `đã cấu hình${dc.webhookUpdatedAt === null ? '' : ` (đổi lúc ${formatDateTime(dc.webhookUpdatedAt)})`}` : 'chưa cấu hình'}. Giá trị không bao giờ hiển thị lại. Không có cấu hình thì hệ thống không gửi Discord.`), h('label', { class: 'check-row', for: 'cfg-discord-enabled' }, enabled, ' Bật gửi cảnh báo qua Discord'), labelled('Mức gửi tối thiểu', severity), labelled('Webhook Discord', webhook, 'Dùng một kênh chung trước. Chỉ nhận địa chỉ discord.com/api/webhooks/…'), h('label', { class: 'check-row', for: 'cfg-webhook-clear' }, clear, ' Xóa webhook đã lưu'), h('div', { class: 'detail-actions' }, test)),
      h('div', { class: 'detail-actions' }, save),
      maintenance,
      access ?? h('span'),
    );
  }
}

// ---- the dialog on the administrators page --------------------------------------------------------------------------------------------

/** SYSTEM gives or takes back an administrator's access to "Vận hành hệ thống": none, view only, or view and handle incidents. */
export function openOpsAccessDialog(host: OpsHost, admin: { readonly id: string; readonly fullName: string }): { close(): void } {
  const msg = notice('error');
  const level = select('ops-access-level', 'Quyền vận hành hệ thống', [['NONE', 'Không có quyền'], ['VIEW', 'Chỉ xem'], ['HANDLE', 'Xem và xử lý sự cố']], 'NONE');
  const cancel = secondary('Đóng');
  const save = primary('Lưu quyền', 'button');
  save.disabled = true;
  let version = 0;
  let alive = true;
  const writer = new Writer(host);
  const dialog = openDialog({
    title: `Quyền vận hành hệ thống của ${admin.fullName}`,
    description: 'Cho phép xem sự cố, nhận xử lý, ghi chú và xác nhận kết quả. Không cho sửa cấu hình, webhook, bảo trì hay phát hành.',
    body: [msg.element, level],
    actions: [cancel, save],
    onDismiss: () => stop(),
    ...(host.dialogHost === undefined ? {} : { host: host.dialogHost }),
  });
  const stop = (): void => {
    alive = false;
    dialog.close();
  };
  cancel.addEventListener('click', stop);
  void host.source.config().then((read) => {
    if (!alive) return;
    if (read.kind !== 'ready') {
      msg.set('Không đọc được quyền hiện tại. Đóng và thử lại.');
      return;
    }
    const row = read.data.access?.find((a) => a.userId === admin.id);
    level.value = row?.level ?? 'NONE';
    version = row?.version ?? 0;
    save.disabled = false;
  });
  save.addEventListener('click', () => {
    save.disabled = true;
    void writer.run((key) => host.source.setAccess(admin.id, level.value as OpsLevel, version, key)).then((r) => {
      if (!alive) return;
      if (r.kind === 'ok') {
        stop();
        return;
      }
      msg.set(writeText(r));
      save.disabled = false;
    });
  });
  return { close: stop };
}

export const NOT_WIRED_NOTE = notWiredPanel;
export { canHandle };
export type { OpsRead };
