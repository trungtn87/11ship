import { ErrorEntry, ErrorPage, errorAction, errorExplanation, errorGroupKey, errorSummary, parseErrorPage, vietnamTime } from '../core/error-log.js';
import { h, secondary } from './dom.js';

function select(options: readonly (readonly [string, string])[]): HTMLSelectElement {
  return h('select', {}, ...options.map(([value, label]) => h('option', { value }, label)));
}
let fieldId = 0;
function field(label: string, input: HTMLElement): HTMLElement {
  const id = 'error-log-field-' + (++fieldId);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input);
}
function copyId(id: string): HTMLElement {
  const copy = secondary('Sao chép mã');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(id).then(() => { copy.textContent = 'Đã sao chép'; }).catch(() => { copy.textContent = 'Hãy chọn mã để sao chép'; });
  });
  return h('span', {}, h('code', {}, id), ' ', copy);
}

/** SYSTEM-only server API. Text nodes only, including diagnostics and correlation IDs. */
export class ErrorLogView {
  readonly root: HTMLElement;
  readonly #rows = h('div', { class: 'table-wrap', style: 'overflow-x:auto' });
  readonly #detail = h('section', { 'aria-label': 'Chi tiết lỗi', 'aria-live': 'polite' });
  readonly #note = h('p', { role: 'status', class: 'lead' }, 'Đang tải nhật ký lỗi…');
  readonly #pager = h('div', { class: 'actions' });
  readonly #requestId = h('input', { type: 'search', placeholder: 'Dán mã tra cứu từ ứng dụng', maxlength: '36' });
  readonly #code = h('input', { type: 'search', placeholder: 'Ví dụ INTERNAL_ERROR', maxlength: '128' });
  readonly #module = h('input', { type: 'search', placeholder: 'Ví dụ M04', maxlength: '128' });
  readonly #app = select([['', 'Tất cả ứng dụng'], ['SHIP', '11Ship'], ['FOOD', '11Food'], ['ADMIN', 'Admin Web'], ['API', 'API khác']]);
  readonly #level = select([['', 'Tất cả mức độ'], ['error', 'Lỗi'], ['warn', 'Cảnh báo']]);
  readonly #status = h('input', { type: 'number', min: '400', max: '599', placeholder: '400–599' });
  readonly #from = h('input', { type: 'datetime-local' });
  readonly #to = h('input', { type: 'datetime-local' });
  readonly #auto = h('input', { type: 'checkbox', checked: '' });
  #page = 1;
  #seq = 0;
  #disposed = false;
  #timer: number | undefined;
  #selected: string | undefined;

  constructor(private readonly onSessionLost: () => void) {
    // datetime-local controls use device time, while every log timestamp is explicitly Vietnam time.
    const localInput = (date: Date): string => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    this.#from.value = localInput(new Date(Date.now() - 86400000));
    const find = secondary('Tra cứu');
    find.addEventListener('click', () => { this.#page = 1; void this.load(); });
    const refresh = secondary('Làm mới');
    refresh.addEventListener('click', () => void this.load());
    const more = h('details', {}, h('summary', {}, 'Lọc thêm'),
      field('Phân hệ', this.#module), field('HTTP status', this.#status), field('Mã lỗi', this.#code));
    const form = h('form', { class: 'form error-log-filters' },
      field('Từ lúc (giờ thiết bị)', this.#from), field('Đến lúc (giờ thiết bị)', this.#to),
      field('Ứng dụng', this.#app), field('Mức độ', this.#level), field('Mã tra cứu', this.#requestId), more,
      h('div', { class: 'actions' }, find, refresh, h('label', { class: 'error-log-auto' }, this.#auto, 'Tự cập nhật mỗi 30 giây')));
    form.addEventListener('submit', (e) => { e.preventDefault(); this.#page = 1; void this.load(); });
    this.root = h('section', { class: 'content error-log-content' }, h('h1', { class: 'title' }, 'Nhật ký lỗi'),
      h('p', { class: 'lead' }, 'Chỉ SYSTEM được xem. Thời gian nhật ký theo giờ Việt Nam. Lỗi giống nhau được gộp trong khoảng đang lọc.'),
      form, this.#note, this.#rows, this.#pager, this.#detail);
    void this.load();
    // Keep an open detail stable for reading/copying; resume on closing it.
    this.#timer = window.setInterval(() => {
      if (this.#auto.checked && !this.#selected && document.visibilityState === 'visible') void this.load();
    }, 30000);
  }
  dispose(): void {
    this.#disposed = true;
    this.#seq += 1;
    if (this.#timer !== undefined) window.clearInterval(this.#timer);
  }
  async load(): Promise<void> {
    const seq = ++this.#seq;
    const params = new URLSearchParams({ page: String(this.#page), limit: '30' });
    for (const [key, value] of [
      ['request_id', this.#requestId.value.trim().toLowerCase()], ['code', this.#code.value.trim().toUpperCase()],
      ['app', this.#app.value], ['level', this.#level.value], ['module', this.#module.value.trim().toUpperCase()], ['status', this.#status.value],
    ]) if (value) params.set(key, value);
    let from: number | undefined;
    let to: number | undefined;
    for (const [key, value] of [['from', this.#from.value], ['to', this.#to.value]]) {
      if (value) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) { this.#note.textContent = 'Thời gian không hợp lệ.'; return; }
        params.set(key, date.toISOString());
        if (key === 'from') from = date.getTime(); else to = date.getTime();
      }
    }
    if (from !== undefined && to !== undefined && from > to) { this.#note.textContent = 'Thời điểm bắt đầu phải trước thời điểm kết thúc.'; return; }
    try {
      const response = await window.fetch('/v1/admin/monitoring/errors?' + params.toString(), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { accept: 'application/json' },
      });
      if (this.#disposed || seq !== this.#seq) return;
      if (response.status === 401) { this.#rows.replaceChildren(); this.#detail.replaceChildren(); this.onSessionLost(); return; }
      if (!response.ok) {
        this.#rows.replaceChildren(); this.#detail.replaceChildren(); this.#pager.replaceChildren();
        this.#note.textContent = response.status === 403 ? 'Chỉ SYSTEM có quyền xem nhật ký lỗi.' : 'Không đọc được nhật ký lỗi (HTTP ' + response.status + ').'; return;
      }
      const parsed = parseErrorPage(await response.json() as unknown);
      if (this.#disposed || seq !== this.#seq) return;
      if (!parsed) { this.#note.textContent = 'Máy chủ trả dữ liệu không đúng định dạng.'; return; }
      this.render(parsed);
    } catch {
      if (!this.#disposed && seq === this.#seq) this.#note.textContent = 'Mất kết nối máy chủ. Dữ liệu đang hiển thị chưa được cập nhật.';
    }
  }
  private render(page: ErrorPage): void {
    this.#note.textContent = 'Có ' + page.total + ' nhóm lỗi. ' +
      (page.storage === 'memory-only' ? 'Hiện chỉ lưu tạm; log sẽ mất sau khi khởi động lại.' : 'Nhật ký đã bật lưu qua khởi động lại, có giới hạn lưu giữ.');
    const headings = ['Thời gian', 'Ứng dụng', 'Nội dung', 'Mức độ', 'Lặp lại'];
    const table = h('table', { class: 'table error-log-table' }, h('thead', {}, h('tr', {}, ...headings.map((t) => h('th', { scope: 'col' }, t)))));
    const body = h('tbody');
    for (const item of page.items) {
      const open = secondary('Xem chi tiết');
      open.addEventListener('click', () => { this.#selected = errorGroupKey(item); this.showDetail(item); });
      body.append(h('tr', {}, h('td', { 'data-label': 'Thời gian' }, vietnamTime(item.time)),
        h('td', { 'data-label': 'Ứng dụng' }, ({ SHIP: '11Ship', FOOD: '11Food', ADMIN: 'Admin Web' } as Record<string, string>)[item.app ?? ''] ?? 'API khác'),
        h('td', { 'data-label': 'Nội dung' }, h('div', {}, errorSummary(item), h('div', {}, open))),
        h('td', { 'data-label': 'Mức độ' }, item.level === 'error' ? 'Lỗi' : 'Cảnh báo'), h('td', { 'data-label': 'Lặp lại' }, item.count + ' lần')));
    }
    if (!page.items.length) body.append(h('tr', {}, h('td', { colspan: '5' }, 'Không có lỗi trong phạm vi đã chọn.')));
    table.append(body); this.#rows.replaceChildren(table);
    const previous = secondary('Trang trước'); previous.disabled = this.#page <= 1;
    previous.addEventListener('click', () => { this.#page -= 1; void this.load(); });
    const next = secondary('Trang sau'); next.disabled = this.#page * 30 >= page.total;
    next.addEventListener('click', () => { this.#page += 1; void this.load(); });
    this.#pager.replaceChildren(previous, h('span', {}, 'Trang ' + this.#page), next);
    const selected = page.items.find((r) => errorGroupKey(r) === this.#selected);
    if (selected) this.showDetail(selected); else { this.#selected = undefined; this.#detail.replaceChildren(); }
  }
  private showDetail(item: ErrorEntry): void {
    const close = secondary('Đóng chi tiết');
    close.addEventListener('click', () => { this.#selected = undefined; this.#detail.replaceChildren(); });
    const technical = h('details', {}, h('summary', {}, 'Thông tin kỹ thuật'),
      h('p', {}, 'Mã lỗi: ', h('code', {}, item.code)), h('p', {}, 'HTTP status: ' + item.status),
      h('p', {}, 'Phân hệ: ' + (item.module ?? 'Chưa xác định')),
      h('p', {}, 'API: ' + (item.method ?? '') + ' ' + (item.route ?? 'Chưa ghi nhận route mẫu')),
      h('p', {}, 'Loại lỗi: ' + (item.error_class ?? 'Chưa xác định')),
      h('p', {}, 'Thời gian UTC: ' + new Date(item.time).toISOString()));
    const occurrences = h('div');
    const showOccurrences = (offset: number): void => {
      const list = h('ul');
      for (const event of item.occurrences.slice(offset, offset + 20)) list.append(h('li', {}, vietnamTime(event.time), ' · ', copyId(event.request_id)));
      const previous = secondary('Các lần trước'); previous.disabled = offset === 0;
      previous.addEventListener('click', () => showOccurrences(Math.max(0, offset - 20)));
      const next = secondary('Các lần tiếp'); next.disabled = offset + 20 >= item.count;
      next.addEventListener('click', () => showOccurrences(offset + 20));
      occurrences.replaceChildren(list, h('div', { class: 'actions' }, previous, next));
    };
    showOccurrences(0);
    this.#detail.replaceChildren(h('h2', {}, 'Chi tiết lỗi'), close,
      h('p', {}, 'Thao tác: ' + errorAction(item)), h('p', {}, 'Kết quả: ' + errorSummary(item)),
      h('p', {}, 'Nguyên nhân: ' + errorExplanation(item.code)), h('p', {}, 'Gần nhất: ' + vietnamTime(item.time)),
      h('p', {}, 'Mã tra cứu gần nhất: ', copyId(item.request_id)), technical,
      h('details', {}, h('summary', {}, 'Các lần xảy ra (' + item.count + ')'), occurrences),
      h('p', { class: 'lead' }, 'Tự cập nhật tạm dừng khi đang mở chi tiết.'));
  }
}
