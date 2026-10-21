import { formatDateTime, h, secondary } from './dom.js';

interface ErrorEntry {
  readonly time: string;
  readonly level: 'warn' | 'error';
  readonly request_id: string;
  readonly status: number;
  readonly code: string;
  readonly method?: string;
  readonly app?: string;
  readonly module?: string;
  readonly error_class?: string;
}
interface ErrorPage { readonly items: readonly ErrorEntry[]; readonly total: number; readonly storage: string }

function validError(value: unknown): ErrorEntry | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.time !== 'string' || Number.isNaN(Date.parse(row.time)) ||
      typeof row.request_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.request_id) ||
      typeof row.code !== 'string' || !/^[A-Z0-9_]{1,128}$/.test(row.code) ||
      typeof row.status !== 'number' || row.status < 400 || row.status > 599 ||
      (row.level !== 'warn' && row.level !== 'error')) return undefined;
  const optional = (key: string): string | undefined => typeof row[key] === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(row[key] as string) ? row[key] as string : undefined;
  return { time: row.time, request_id: row.request_id, code: row.code,
    status: row.status, level: row.level,
    app: optional('app'), module: optional('module'),
    method: optional('method'), error_class: optional('error_class') };
}
function parsePage(body: unknown): ErrorPage | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const page = data as { items?: unknown; total?: unknown; storage?: unknown };
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || typeof page.total !== 'number' || page.total < 0 ||
      (page.storage !== 'configured-file' && page.storage !== 'memory-only')) return undefined;
  const items = page.items.map(validError);
  if (items.some((item) => item === undefined)) return undefined;
  return { items: items as ErrorEntry[], total: page.total, storage: page.storage };
}

/** M13 #155: no raw SQL, stack, URL, password, token or request body ever reaches this UI. */
export class ErrorLogView {
  readonly root: HTMLElement;
  readonly #rows: HTMLElement;
  readonly #note: HTMLElement;
  readonly #pager: HTMLElement;
  readonly #requestId: HTMLInputElement;
  readonly #code: HTMLInputElement;
  readonly #app: HTMLSelectElement;
  readonly #status: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  #page = 1;
  #seq = 0;
  #disposed = false;
  #timer: number | undefined;

  constructor(private readonly onSessionLost: () => void) {
    this.#requestId = h('input', { type: 'search', placeholder: 'Mã tra cứu (request ID)', maxlength: '36' });
    this.#code = h('input', { type: 'search', placeholder: 'Mã lỗi, ví dụ INTERNAL_ERROR', maxlength: '128' });
    this.#app = h('select', {},
      ...[['', 'Tất cả ứng dụng'], ['SHIP', '11Ship'], ['FOOD', '11Food'], ['ADMIN', 'Admin'], ['API', 'API khác']]
        .map(([value, label]) => h('option', { value }, label)));
    this.#status = h('select', {},
      ...[['', 'Mọi HTTP status'], ['400', '400'], ['401', '401'], ['403', '403'], ['404', '404'], ['409', '409'], ['422', '422'], ['429', '429'], ['500', '500'], ['503', '503']]
        .map(([value, label]) => h('option', { value }, label)));
    this.#from = h('input', { type: 'datetime-local', title: 'Từ thời điểm (giờ thiết bị)' });
    this.#to = h('input', { type: 'datetime-local', title: 'Đến thời điểm (giờ thiết bị)' });
    const find = secondary('Tra cứu');
    find.addEventListener('click', () => { this.#page = 1; void this.load(); });
    const refresh = secondary('Làm mới');
    refresh.addEventListener('click', () => void this.load());
    const form = h('form', { class: 'form' },
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Request ID'), this.#requestId),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Mã lỗi'), this.#code),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Ứng dụng'), this.#app),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'HTTP'), this.#status),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Từ lúc'), this.#from),
      h('div', { class: 'field' }, h('label', { class: 'label' }, 'Đến lúc'), this.#to),
      h('div', { class: 'actions' }, find, refresh));
    form.addEventListener('submit', (e) => { e.preventDefault(); this.#page = 1; void this.load(); });
    this.#note = h('p', { role: 'status', class: 'lead' }, 'Đang tải nhật ký lỗi…');
    this.#rows = h('div', { class: 'table-wrap', style: 'overflow-x:auto' });
    this.#pager = h('div', { class: 'actions' });
    this.root = h('section', { class: 'content' },
      h('h1', { class: 'title' }, 'Nhật ký lỗi'),
      h('p', { class: 'lead' }, 'Chỉ tài khoản SYSTEM được tra cứu lỗi máy chủ. Mã tra cứu lấy từ phản hồi API (X-Request-ID).'),
      form, this.#note, this.#rows, this.#pager);
    void this.load();
    this.#timer = window.setInterval(() => { if (document.visibilityState === 'visible') void this.load(); }, 30000);
  }

  dispose(): void {
    this.#disposed = true;
    this.#seq += 1;
    if (this.#timer !== undefined) window.clearInterval(this.#timer);
  }

  async load(): Promise<void> {
    const seq = ++this.#seq;
    const params = new URLSearchParams({ page: String(this.#page), limit: '30' });
    const requestId = this.#requestId.value.trim().toLowerCase();
    const code = this.#code.value.trim().toUpperCase();
    if (requestId) params.set('request_id', requestId);
    if (code) params.set('code', code);
    if (this.#app.value) params.set('app', this.#app.value);
    if (this.#status.value) params.set('status', this.#status.value);
    for (const [key, value] of [['from', this.#from.value], ['to', this.#to.value]]) {
      if (value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          this.#note.textContent = 'Thời gian không hợp lệ.';
          return;
        }
        params.set(key, date.toISOString());
      }
    }
    try {
      const response = await window.fetch('/v1/admin/monitoring/errors?' + params.toString(), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { accept: 'application/json' },
      });
      if (this.#disposed || seq !== this.#seq) return;
      if (response.status === 401) { this.onSessionLost(); return; }
      if (!response.ok) { this.#note.textContent = response.status === 403 ? 'Chỉ SYSTEM có quyền xem nhật ký lỗi.' : 'Không đọc được nhật ký lỗi (HTTP ' + response.status + ').'; return; }
      const parsed = parsePage(await response.json() as unknown);
      if (this.#disposed || seq !== this.#seq) return;
      if (parsed === undefined) { this.#note.textContent = 'Máy chủ trả dữ liệu không đúng định dạng.'; return; }
      this.render(parsed);
    } catch {
      if (!this.#disposed && seq === this.#seq) this.#note.textContent = 'Mất kết nối máy chủ. Hãy thử lại.';
    }
  }

  private render(page: ErrorPage): void {
    this.#note.textContent = 'Có ' + page.total + ' lỗi. ' +
      (page.storage === 'memory-only' ? 'Lưu tạm trong RAM; sẽ mất sau khi khởi động lại VPS.' : 'Dữ liệu lưu trong nhật ký trên VPS, có giới hạn.');
    this.#rows.replaceChildren();
    const headings = ['Thời gian', 'Ứng dụng', 'HTTP', 'Mã lỗi', 'API/Phân hệ', 'Request ID'];
    const table = h('table', { class: 'table' }, h('thead', {}, h('tr', {}, ...headings.map((t) => h('th', {}, t)))));
    const body = h('tbody');
    for (const item of page.items) {
      const id = h('code', {}, item.request_id);
      const copy = secondary('Sao chép');
      copy.addEventListener('click', () => { void navigator.clipboard?.writeText(item.request_id).catch(() => undefined); });
      body.append(h('tr', {},
        h('td', {}, formatDateTime(item.time)),
        h('td', {}, item.app ?? '—'),
        h('td', {}, String(item.status)),
        h('td', {}, item.code),
        h('td', {}, (item.method ?? '—') + ' · ' + (item.module ?? '—')),
        h('td', {}, id, copy)));
    }
    if (page.items.length === 0) body.append(h('tr', {}, h('td', { colspan: '6' }, 'Không có lỗi trong phạm vi đã chọn.')));
    table.append(body);
    this.#rows.append(table);
    const previous = secondary('Trang trước');
    previous.disabled = this.#page <= 1;
    previous.addEventListener('click', () => { this.#page -= 1; void this.load(); });
    const next = secondary('Trang sau');
    next.disabled = this.#page * 30 >= page.total;
    next.addEventListener('click', () => { this.#page += 1; void this.load(); });
    this.#pager.replaceChildren(previous, h('span', {}, 'Trang ' + this.#page), next);
  }
}
