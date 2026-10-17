import {
  activateText,
  CATALOG_FILTER_LABEL,
  CATALOG_PAGE_SIZE,
  CATALOG_STATUS_LABEL,
  CatalogDialog,
  CatalogFilter,
  CatalogScreen,
  CategoryDraft,
  CategoryRow,
  deactivateText,
  NAME_MAX,
} from '../core/catalog.js';
import { DialogHandle, openDialog } from './dialog.js';
import { h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Danh mục › Nhóm món". It draws the model of core/catalog.ts and nothing else: no value of its own, no request, nothing stored. The
// popups edit a DRAFT kept by the controller; the view never rewrites what was typed. Every node is created with createElement/textContent
// (no innerHTML). While a save runs the popup is locked (fields and buttons disabled, Esc ignored), so it cannot be sent twice.

export interface CatalogHooks {
  readonly wired: boolean;
  /** Search text or status filter changed (no request yet: the caller waits for the typing pause). */
  filter(next: Partial<Pick<CatalogFilter, 'query' | 'status'>>): void;
  refresh(): void;
  retry(): void;
  page(page: number): void;
  create(): void;
  edit(id: string): void;
  toggle(id: string): void;
  /** The form changed (no request). */
  draft(draft: CategoryDraft): void;
  submit(): void;
  cancel(): void;
  retrySave(): void;
  recheck(): void;
  reload(): void;
  showTwin(): void;
  login(): void;
  home(): void;
}

interface Column {
  readonly label: string;
  readonly end?: boolean;
  readonly numeric?: boolean;
}

const COLUMNS: readonly Column[] = [{ label: 'Tên nhóm' }, { label: 'Thứ tự', numeric: true }, { label: 'Số món', numeric: true }, { label: 'Trạng thái' }, { label: 'Thao tác', end: true }];

function tableCard(caption: string, body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
  const head = h('tr', {}, ...COLUMNS.map((column) => h('th', { scope: 'col', class: [column.end ? 'cell-end' : '', column.numeric ? 'cell-num' : ''].join(' ').trim() }, column.label)));
  const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(COLUMNS.length) }, body.panel))];
  return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...rows)));
}

function statusBadge(status: 'ACTIVE' | 'INACTIVE'): HTMLElement {
  return h('span', { class: `badge ${status === 'ACTIVE' ? 'badge-ok' : 'badge-lock'}` }, icon(status === 'ACTIVE' ? 'check' : 'lock', 14), CATALOG_STATUS_LABEL[status]);
}

/**
 * The part of a dialog that decides whether it must be drawn again. Neither the typed draft nor the field errors are part of it: typing
 * (which also clears a refusal) must not rebuild the popup, or the caret and the focus would jump. Errors are patched in place.
 */
function signature(dialog: CatalogDialog | undefined): string {
  if (dialog === undefined) {
    return '';
  }
  const common = [dialog.kind, dialog.phase, dialog.message ?? '', dialog.kind === 'form' ? (dialog.id ?? dialog.mode) : dialog.id];
  return JSON.stringify(dialog.kind === 'form' ? [...common, dialog.mode] : [...common, dialog.to]);
}

interface FormParts {
  readonly nameInput: HTMLInputElement;
  readonly orderInput: HTMLInputElement;
  readonly nameError: HTMLElement;
  readonly orderError: HTMLElement;
  readonly twin: HTMLButtonElement;
}

export class CatalogView {
  readonly #search: HTMLInputElement;
  readonly #status: HTMLSelectElement;
  readonly #refresh: HTMLButtonElement;
  readonly #add: HTMLButtonElement;
  readonly #notice: HTMLElement;
  readonly #results: HTMLElement;
  #handle: DialogHandle | undefined;
  #shown = '';
  #parts: FormParts | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: CatalogHooks,
    /** Where popups are mounted. The page body by default; the design preview mounts them inside its desktop frame. */
    private readonly dialogHost?: HTMLElement,
  ) {
    this.#search = h('input', { id: 'catalog-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo tên nhóm', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo tên nhóm', maxlength: '80' });
    this.#status = h(
      'select',
      { id: 'catalog-status', class: 'select', 'aria-label': 'Trạng thái' },
      ...(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((value) => h('option', { value }, CATALOG_FILTER_LABEL[value])),
    );
    this.#refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#add = h('button', { type: 'button', class: 'btn btn-primary btn-inline', id: 'catalog-add' }, '+ Thêm nhóm');
    this.#notice = message('notice', 'catalog-notice');
    this.#notice.setAttribute('role', 'status');
    this.#results = h('div', { class: 'results' });
    this.#search.addEventListener('input', () => this.hooks.filter({ query: this.#search.value }));
    this.#status.addEventListener('change', () => this.hooks.filter({ status: this.#status.value === 'ACTIVE' || this.#status.value === 'INACTIVE' ? this.#status.value : 'ALL' }));
    this.#refresh.addEventListener('click', () => this.hooks.refresh());
    this.#add.addEventListener('click', () => this.hooks.create());
    const toolbar = h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#status, this.#refresh);
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'catalog-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'catalog-title' }, 'Nhóm món'), h('p', { class: 'lead lead-last' }, 'Nhóm món dùng chung cho mọi quán. Chủ quán chọn một nhóm khi thêm món.')), this.#add),
        toolbar,
        this.#notice,
        this.#results,
      ),
    );
  }

  /** Closes the popup (the page is left). */
  dispose(): void {
    this.#handle?.close();
    this.#handle = undefined;
  }

  render(screen: CatalogScreen): void {
    const filter = screen.filter;
    if (this.#search !== document.activeElement && this.#search.value !== filter.query) {
      this.#search.value = filter.query;
    }
    this.#status.value = filter.status;
    const usable = this.hooks.wired && screen.list.kind !== 'not-wired';
    this.#search.disabled = !usable;
    this.#status.disabled = !usable;
    this.#add.disabled = !usable;
    this.#refresh.disabled = !usable || screen.list.kind === 'loading';
    setMessage(this.#notice, screen.notice);
    this.#results.replaceChildren(this.#table(screen));
    this.#dialog(screen.dialog);
  }

  // ---- the list ----------------------------------------------------------------------------------------------------------

  #table(screen: CatalogScreen): HTMLElement {
    const caption = 'Danh sách nhóm món';
    const list = screen.list;
    switch (list.kind) {
      case 'not-wired':
        return tableCard(caption, { panel: notWiredPanel(list.reason) });
      case 'loading':
        return tableCard(caption, { panel: skeleton() });
      case 'failed':
        return tableCard(caption, { panel: failurePanel(list.failure, { retry: () => this.hooks.retry(), login: () => this.hooks.login(), home: () => this.hooks.home() }, list.retryAfterSec) });
      case 'empty':
        return tableCard(caption, {
          panel: list.filtered ? emptyPanel('Không tìm thấy nhóm món', 'Thử đổi từ khóa hoặc bộ lọc trạng thái.') : emptyPanel('Chưa có nhóm món', 'Bấm “+ Thêm nhóm” để tạo nhóm đầu tiên. Chủ quán chỉ thêm được món khi có ít nhất một nhóm đang dùng.'),
        });
      case 'ready': {
        const card = tableCard(caption, { rows: list.rows.map((row) => this.#row(row)) });
        return h('div', {}, card, this.#pager(screen.filter.page, list.pages, list.total));
      }
    }
  }

  #row(row: CategoryRow): HTMLElement {
    const edit = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Sửa nhóm ${row.name}` }, 'Sửa');
    edit.addEventListener('click', () => this.hooks.edit(row.id));
    const toggle = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `${row.status === 'ACTIVE' ? 'Ngừng dùng' : 'Kích hoạt'} nhóm ${row.name}` }, row.status === 'ACTIVE' ? 'Ngừng dùng' : 'Kích hoạt');
    toggle.addEventListener('click', () => this.hooks.toggle(row.id));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Tên nhóm', class: 'cell-name' }, row.name),
      h('td', { 'data-label': 'Thứ tự', class: 'cell-num' }, String(row.sortOrder)),
      h('td', { 'data-label': 'Số món', class: 'cell-num' }, String(row.itemCount)),
      h('td', { 'data-label': 'Trạng thái' }, statusBadge(row.status)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, edit, toggle)),
    );
  }

  #pager(page: number, pages: number, total: number): HTMLElement {
    const from = (page - 1) * CATALOG_PAGE_SIZE + 1;
    const to = Math.min(page * CATALOG_PAGE_SIZE, total);
    const previous = secondary('Trước');
    previous.disabled = page <= 1;
    previous.addEventListener('click', () => this.hooks.page(page - 1));
    const next = secondary('Sau');
    next.disabled = page >= pages;
    next.addEventListener('click', () => this.hooks.page(page + 1));
    return h(
      'nav',
      { class: 'pager', 'aria-label': 'Phân trang' },
      h('p', { class: 'pager-text', id: 'catalog-count' }, `Hiển thị ${String(from)}–${String(to)} / ${String(total)} nhóm`),
      h('div', { class: 'pager-buttons' }, previous, h('span', { class: 'pager-page', 'aria-current': 'page' }, `Trang ${String(page)}/${String(pages)}`), next),
    );
  }

  // ---- the popups --------------------------------------------------------------------------------------------------------

  #dialog(dialog: CatalogDialog | undefined): void {
    const next = signature(dialog);
    if (next === this.#shown) {
      if (dialog !== undefined && dialog.kind === 'form') {
        this.#patch(dialog);
      }
      return;
    }
    this.#shown = next;
    this.#handle?.close();
    this.#handle = undefined;
    this.#parts = undefined;
    if (dialog === undefined) {
      return;
    }
    this.#handle = dialog.kind === 'form' ? this.#form(dialog) : this.#toggleDialog(dialog);
  }

  /** The popup stays; only what the controller says about the fields (errors, the inactive twin) changes. */
  #patch(dialog: Extract<CatalogDialog, { kind: 'form' }>): void {
    const parts = this.#parts;
    if (parts === undefined) {
      return;
    }
    setMessage(parts.nameError, dialog.errors.name);
    setMessage(parts.orderError, dialog.errors.sortOrder);
    for (const [input, text] of [[parts.nameInput, dialog.errors.name], [parts.orderInput, dialog.errors.sortOrder]] as const) {
      if (text === undefined) {
        input.removeAttribute('aria-invalid');
      } else {
        input.setAttribute('aria-invalid', 'true');
      }
    }
    parts.twin.hidden = dialog.inactiveTwin !== true;
  }

  #form(dialog: Extract<CatalogDialog, { kind: 'form' }>): DialogHandle {
    const working = dialog.phase === 'working';
    const finished = dialog.phase === 'unknown' || dialog.phase === 'conflict';
    const locked = working || finished;
    const nameInput = h('input', { id: 'category-name', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'category-name-error category-name-count' });
    nameInput.value = dialog.draft.name;
    const orderInput = h('input', { id: 'category-order', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'category-order-hint category-order-error' });
    orderInput.value = dialog.draft.sortOrder;
    const statusSelect = h(
      'select',
      { id: 'category-status', class: 'select', 'aria-label': 'Trạng thái' },
      ...(['ACTIVE', 'INACTIVE'] as const).map((value) => h('option', { value }, CATALOG_STATUS_LABEL[value])),
    );
    statusSelect.value = dialog.draft.status;
    for (const control of [nameInput, orderInput, statusSelect]) {
      control.disabled = locked;
    }
    const count = h('p', { id: 'category-name-count', class: 'hint hint-end' }, `${String([...dialog.draft.name].length)}/${String(NAME_MAX)}`);
    const nameError = message('error', 'category-name-error');
    const orderError = message('error', 'category-order-error');
    setMessage(nameError, dialog.errors.name);
    setMessage(orderError, dialog.errors.sortOrder);
    if (dialog.errors.name !== undefined) {
      nameInput.setAttribute('aria-invalid', 'true');
    }
    if (dialog.errors.sortOrder !== undefined) {
      orderInput.setAttribute('aria-invalid', 'true');
    }
    const read = (): CategoryDraft => ({ name: nameInput.value, sortOrder: orderInput.value, status: statusSelect.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE' });
    nameInput.addEventListener('input', () => {
      count.textContent = `${String([...nameInput.value].length)}/${String(NAME_MAX)}`;
      this.hooks.draft(read());
    });
    orderInput.addEventListener('input', () => this.hooks.draft(read()));
    statusSelect.addEventListener('change', () => this.hooks.draft(read()));

    const status = message(dialog.phase === 'unknown' || dialog.phase === 'conflict' ? 'warning' : 'error', 'category-status-message');
    setMessage(status, dialog.message);
    const cancel = secondary('Hủy');
    cancel.disabled = working || dialog.phase === 'unknown';
    cancel.addEventListener('click', () => this.hooks.cancel());
    const extra: HTMLElement[] = [];
    let confirm: HTMLButtonElement;
    if (dialog.phase === 'unknown') {
      confirm = primary('Thử lại', 'button');
      confirm.addEventListener('click', () => this.hooks.retrySave());
      const recheck = secondary('Kiểm tra lại danh sách');
      recheck.addEventListener('click', () => this.hooks.recheck());
      extra.push(recheck);
    } else if (dialog.phase === 'conflict') {
      confirm = primary('Tải lại danh sách', 'button');
      confirm.addEventListener('click', () => this.hooks.reload());
    } else {
      confirm = primary(working ? 'Đang lưu…' : 'Lưu', 'button');
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
      confirm.addEventListener('click', () => this.hooks.submit());
    }
    const twin = h('button', { type: 'button', class: 'btn btn-secondary btn-inline', id: 'category-twin', hidden: dialog.inactiveTwin !== true }, 'Xem nhóm cũ');
    twin.addEventListener('click', () => this.hooks.showTwin());
    this.#parts = { nameInput, orderInput, nameError, orderError, twin };
    const handle = openDialog({
      host: this.dialogHost,
      title: dialog.mode === 'create' ? 'Thêm nhóm món' : 'Sửa nhóm món',
      onDismiss: working || dialog.phase === 'unknown' ? undefined : () => this.hooks.cancel(),
      body: [
        h('div', { class: 'field' }, h('label', { for: 'category-name', class: 'label' }, 'Tên nhóm'), h('div', { class: 'input-wrap' }, nameInput), nameError, twin, count),
        h('div', { class: 'field' }, h('label', { for: 'category-order', class: 'label' }, 'Thứ tự'), h('div', { class: 'input-wrap' }, orderInput), h('p', { id: 'category-order-hint', class: 'hint' }, 'Số nguyên không âm. Nhóm có số nhỏ hơn hiện trước trong bộ chọn của chủ quán.'), orderError),
        h('div', { class: 'field' }, h('label', { for: 'category-status', class: 'label' }, 'Trạng thái'), statusSelect, h('p', { class: 'hint' }, 'Nhóm ngừng dùng không chọn được cho món mới; món đang thuộc nhóm được giữ nguyên.')),
        status,
      ],
      actions: [cancel, ...extra, confirm],
    });
    if (dialog.errors.name !== undefined) {
      nameInput.focus();
    } else if (dialog.errors.sortOrder !== undefined) {
      orderInput.focus();
    }
    return handle;
  }

  #toggleDialog(dialog: Extract<CatalogDialog, { kind: 'toggle' }>): DialogHandle {
    const deactivate = dialog.to === 'INACTIVE';
    const working = dialog.phase === 'working';
    const status = message(dialog.phase === 'unknown' || dialog.phase === 'conflict' ? 'warning' : 'error', 'category-status-message');
    setMessage(status, dialog.message);
    const cancel = secondary('Hủy');
    cancel.disabled = working || dialog.phase === 'unknown';
    cancel.addEventListener('click', () => this.hooks.cancel());
    const extra: HTMLElement[] = [];
    let confirm: HTMLButtonElement;
    if (dialog.phase === 'unknown') {
      confirm = primary('Thử lại', 'button');
      confirm.addEventListener('click', () => this.hooks.retrySave());
      const recheck = secondary('Kiểm tra lại danh sách');
      recheck.addEventListener('click', () => this.hooks.recheck());
      extra.push(recheck);
    } else if (dialog.phase === 'conflict') {
      confirm = primary('Tải lại danh sách', 'button');
      confirm.addEventListener('click', () => this.hooks.reload());
    } else {
      const label = deactivate ? 'Ngừng dùng' : 'Kích hoạt';
      confirm = deactivate ? h('button', { type: 'button', class: 'btn btn-danger-solid' }, label) : primary(label, 'button');
      confirm.disabled = working;
      confirm.textContent = working ? 'Đang lưu…' : label;
      confirm.setAttribute('aria-busy', String(working));
      confirm.addEventListener('click', () => this.hooks.submit());
    }
    return openDialog({
      host: this.dialogHost,
      title: deactivate ? 'Ngừng dùng nhóm món' : 'Kích hoạt lại nhóm món',
      onDismiss: working || dialog.phase === 'unknown' ? undefined : () => this.hooks.cancel(),
      body: [
        h('p', { class: `dialog-warning dialog-warning-${deactivate ? 'danger' : 'info'}`, role: 'note', id: 'category-toggle-text' }, icon(deactivate ? 'alert' : 'info', 18), h('span', {}, deactivate ? deactivateText(dialog.name) : activateText(dialog.name))),
        deactivate && dialog.itemCount > 0 ? h('p', { class: 'hint' }, `Hiện có ${String(dialog.itemCount)} món thuộc nhóm này.`) : undefined,
        status,
      ].filter((node): node is HTMLElement => node !== undefined),
      actions: [cancel, ...extra, confirm],
    });
  }
}
