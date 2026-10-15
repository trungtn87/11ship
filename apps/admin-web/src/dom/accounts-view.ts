import {
  ADMINISTRATOR_STATUS_LABEL,
  AdministratorFilter,
  AdministratorRow,
  AdministratorStatus,
  AdministratorsScreen,
  EMPTY_ADMIN_FILTER,
  ListState,
  LockDialog,
  REASON_MAX,
  UserDetail,
  UserDetailScreen,
  UserFilter,
  UserRole,
  USER_ROLE_LABEL,
  USER_STATUS_LABEL,
  UserRow,
  UsersScreen,
  validateReason,
} from '../core/accounts.js';
import { formatRoute } from '../core/routes.js';
import { openDialog, DialogHandle } from './dialog.js';
import { h, message, primary, secondary, setMessage } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton, statePanel } from './states.js';

// DOM of the account pages: users (D81), one user (D86) with the lock/unlock dialogs (D87/D88), and the administrators
// list. They draw the models of core/accounts.ts and nothing else: no data of their own, no request, nothing stored.
// Controls that would change something are enabled only when the caller says the page is wired; until then they are
// disabled and the page says why. Every node is created with createElement/textContent (no innerHTML).

export interface AccountsHooks {
  /** false = nothing is wired yet: filters and actions are disabled (the not-wired panel gives the reason). */
  readonly wired: boolean;
  filter(filter: UserFilter): void;
  refresh(): void;
  retry(): void;
  login(): void;
  home(): void;
  open(id: string): void;
  loadMore(): void;
  /** Roles the viewing admin may filter by (the server's available_role_filters). Absent = all three (design preview). */
  readonly roles?: readonly UserRole[];
}

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** dd/mm/yyyy in the operating area's time zone (Cao Bằng, UTC+7). Unparseable input is shown as is. */
export function formatDateVn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  } catch {
    return iso;
  }
}

/** dd/mm/yyyy HH:mm in the operating area's time zone. */
export function formatDateTimeVn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  try {
    return `${formatDateVn(iso)} ${new Intl.DateTimeFormat('vi-VN', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)}`;
  } catch {
    return iso;
  }
}

/** The role chips of a user, colored per role as in the M01 Design (customer neutral, shop owner yellow, driver charcoal). */
function roleChips(roles: readonly UserRole[]): HTMLElement {
  return h('span', { class: 'chips' }, ...roles.map((role) => h('span', { class: `chip chip-${role.toLowerCase().replace('_', '-')}` }, USER_ROLE_LABEL[role])));
}

function pageHead(title: string, subtitle: string, id: string, action?: HTMLElement): HTMLElement {
  return h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id }, title), h('p', { class: 'lead lead-last' }, subtitle)), action);
}

function statusBadge(status: 'ACTIVE' | 'LOCKED' | 'PENDING', label: string): HTMLElement {
  const kind = status === 'ACTIVE' ? 'ok' : status === 'LOCKED' ? 'lock' : 'wait';
  return h('span', { class: `badge badge-${kind}` }, icon(status === 'ACTIVE' ? 'check' : status === 'LOCKED' ? 'lock' : 'clock', 14), label);
}

interface Column {
  readonly label: string;
  readonly end?: boolean;
}

/** A table whose header is always drawn; the body is rows, or one panel (loading, empty, failed...) spanning all columns. */
function tableCard(caption: string, columns: readonly Column[], body: { readonly rows: readonly HTMLElement[] } | { readonly panel: HTMLElement }): HTMLElement {
  const head = h('tr', {}, ...columns.map((column) => h('th', { scope: 'col', class: column.end ? 'cell-end' : '' }, column.label)));
  const rows = 'rows' in body ? body.rows : [h('tr', { class: 'row-panel' }, h('td', { colspan: String(columns.length) }, body.panel))];
  return h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, caption), h('thead', {}, head), h('tbody', {}, ...rows)));
}

function cell(label: string, ...children: (Node | string | undefined)[]): HTMLElement {
  return h('td', { 'data-label': label }, ...children);
}

// ---- D81: users -----------------------------------------------------------------------------------------------------

export class UsersView {
  readonly #hooks: AccountsHooks;
  readonly #search: HTMLInputElement;
  readonly #role: HTMLSelectElement;
  readonly #status: HTMLSelectElement;
  readonly #refresh: HTMLButtonElement;
  readonly #results: HTMLElement;
  readonly #hint: HTMLElement;
  #filter: UserFilter = { query: '', role: 'ALL', status: 'ALL' };

  constructor(
    private readonly root: HTMLElement,
    hooks: AccountsHooks,
  ) {
    this.#hooks = hooks;
    this.#search = h('input', { id: 'users-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo tên hoặc số điện thoại', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo tên hoặc số điện thoại', maxlength: '120' });
    this.#role = h(
      'select',
      { id: 'users-role', class: 'select', 'aria-label': 'Vai trò' },
      h('option', { value: 'ALL' }, 'Vai trò'),
      ...(hooks.roles ?? (['CUSTOMER', 'SHOP_OWNER', 'DRIVER'] as const)).map((role) => h('option', { value: role }, USER_ROLE_LABEL[role])),
    );
    this.#status = h(
      'select',
      { id: 'users-status', class: 'select', 'aria-label': 'Trạng thái' },
      h('option', { value: 'ALL' }, 'Trạng thái'),
      ...(['ACTIVE', 'LOCKED'] as const).map((status) => h('option', { value: status }, USER_STATUS_LABEL[status])),
    );
    this.#refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#hint = message('notice', 'users-hint');
    this.#results = h('div', { class: 'results' });
    const emit = (): void => this.#hooks.filter(this.#read());
    this.#search.addEventListener('input', emit);
    this.#role.addEventListener('change', emit);
    this.#status.addEventListener('change', emit);
    this.#refresh.addEventListener('click', () => this.#hooks.refresh());
    const toolbar = h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#role, this.#status, this.#refresh);
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'users-title' }, pageHead('Người dùng', 'Quản lý tài khoản khách hàng, chủ quán và shipper', 'users-title'), toolbar, this.#hint, this.#results));
  }

  #read(): UserFilter {
    const role = this.#role.value;
    const status = this.#status.value;
    return {
      query: this.#search.value,
      role: role === 'CUSTOMER' || role === 'SHOP_OWNER' || role === 'DRIVER' ? role : 'ALL',
      status: status === 'ACTIVE' || status === 'LOCKED' ? status : 'ALL',
    };
  }

  render(screen: UsersScreen): void {
    this.#filter = screen.filter;
    if (this.#search !== document.activeElement && this.#search.value !== screen.filter.query) {
      this.#search.value = screen.filter.query;
    }
    this.#role.value = screen.filter.role;
    this.#status.value = screen.filter.status;
    const usable = this.#hooks.wired && screen.state.kind !== 'not-wired';
    for (const control of [this.#search, this.#role, this.#status, this.#refresh]) {
      control.disabled = !usable;
    }
    this.#refresh.disabled = !usable || screen.state.kind === 'loading';
    setMessage(this.#hint, screen.state.kind === 'not-wired' ? 'Tìm kiếm và bộ lọc sẽ dùng được khi danh sách được nối với máy chủ.' : undefined);
    this.#results.replaceChildren(this.#table(screen.state));
  }

  #table(state: ListState<UserRow>): HTMLElement {
    const columns: readonly Column[] = [{ label: 'Họ tên' }, { label: 'Số điện thoại' }, { label: 'Vai trò' }, { label: 'Trạng thái' }, { label: 'Ngày tạo' }, { label: 'Thao tác', end: true }];
    const caption = 'Danh sách người dùng';
    switch (state.kind) {
      case 'not-wired':
        return tableCard(caption, columns, { panel: notWiredPanel(state.reason) });
      case 'loading':
        return tableCard(caption, columns, { panel: skeleton() });
      case 'empty':
        return tableCard(caption, columns, {
          panel: emptyPanel(this.#filter.status === 'LOCKED' ? 'Chưa có người dùng đang khóa' : 'Chưa có người dùng phù hợp', 'Thử thay đổi điều kiện tìm kiếm'),
        });
      case 'failed':
        return tableCard(caption, columns, { panel: failurePanel(state.failure, { retry: () => this.#hooks.retry(), login: () => this.#hooks.login(), home: () => this.#hooks.home() }, state.retryAfterSec) });
      case 'rows': {
        const card = tableCard(caption, columns, { rows: state.rows.map((row) => this.#row(row)) });
        if (state.nextCursor === null) {
          return card;
        }
        const more = secondary(state.loadingMore === true ? 'Đang tải…' : 'Tải thêm');
        more.disabled = state.loadingMore === true || !this.#hooks.wired;
        more.addEventListener('click', () => this.#hooks.loadMore());
        return h('div', {}, card, h('div', { class: 'more' }, more));
      }
    }
  }

  #row(row: UserRow): HTMLElement {
    const open = h('a', { href: formatRoute({ name: 'user', id: row.id }), class: 'table-link', 'aria-label': `Xem ${row.fullName ?? row.phoneMasked}` }, 'Xem');
    open.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.#hooks.open(row.id);
      }
    });
    return h(
      'tr',
      {},
      cell('Họ tên', row.fullName === null ? h('span', { class: 'muted' }, 'Chưa có tên') : row.fullName),
      cell('Số điện thoại', row.phoneMasked),
      cell('Vai trò', roleChips(row.roles)),
      cell('Trạng thái', statusBadge(row.status, USER_STATUS_LABEL[row.status])),
      cell('Ngày tạo', formatDateVn(row.createdAt)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, open),
    );
  }
}

// ---- D86: one user --------------------------------------------------------------------------------------------------

export interface UserDetailHooks {
  readonly wired: boolean;
  back(): void;
  reload(): void;
  retry(): void;
  login(): void;
  home(): void;
  action(action: 'LOCK' | 'UNLOCK'): void;
}

function definition(items: readonly (readonly [string, Node | string])[]): HTMLElement {
  return h('dl', { class: 'kvs' }, ...items.map(([label, value]) => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value))));
}

function profileBlocks(user: UserDetail): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  if (user.profile.customer !== undefined) {
    blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Hồ sơ khách hàng'), definition([['Họ tên', user.profile.customer.fullName ?? 'Chưa có tên']])));
  }
  if (user.profile.shop !== undefined) {
    blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Hồ sơ quán'), definition([['Tên quán', user.profile.shop.name ?? 'Chưa đặt tên'], ['Trạng thái hồ sơ', user.profile.shop.state]])));
  }
  if (user.profile.driver !== undefined) {
    blocks.push(h('section', { class: 'detail-block' }, h('h3', { class: 'subtitle' }, 'Hồ sơ shipper'), definition([['Trạng thái hồ sơ', user.profile.driver.state]])));
  }
  return blocks;
}

export function renderUserDetail(screen: UserDetailScreen, hooks: UserDetailHooks): HTMLElement {
  const back = h('button', { type: 'button', class: 'link-btn back' }, icon('arrow-left', 16), 'Quay lại danh sách');
  back.addEventListener('click', () => hooks.back());
  const state = screen.state;
  let title = 'Chi tiết người dùng';
  let subtitle = 'Thông tin tài khoản và lịch sử thay đổi.';
  let body: HTMLElement;
  switch (state.kind) {
    case 'not-wired':
      body = notWiredPanel(state.reason);
      break;
    case 'loading':
      body = skeleton(4);
      break;
    case 'not-found':
      body = statePanel({ icon: 'file', title: 'Không tìm thấy người dùng', text: 'Tài khoản này không tồn tại hoặc nằm ngoài phạm vi của bạn.', actions: [{ label: 'Về danh sách', onClick: () => hooks.back(), kind: 'secondary' }] });
      break;
    case 'failed':
      body = failurePanel(state.failure, { retry: () => hooks.retry(), login: () => hooks.login(), home: () => hooks.home() }, state.retryAfterSec);
      break;
    case 'ready': {
      const user = state.user;
      title = user.fullName ?? 'Chưa có tên';
      subtitle = `${user.phoneMasked} · ${USER_STATUS_LABEL[user.status]}`;
      const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
      refresh.addEventListener('click', () => hooks.reload());
      const actions: HTMLElement[] = [refresh];
      for (const action of user.allowedActions) {
        const button = action === 'LOCK' ? h('button', { type: 'button', class: 'btn btn-danger btn-inline' }, icon('lock', 18), 'Khóa tài khoản') : primary('Mở khóa', 'button');
        button.classList.add('btn-inline');
        button.disabled = !hooks.wired;
        button.addEventListener('click', () => hooks.action(action));
        actions.push(button);
      }
      body = h(
        'div',
        { class: 'detail' },
        h('div', { class: 'detail-actions' }, ...actions),
        user.allowedActions.length === 0 ? h('p', { class: 'hint' }, 'Bạn không có thao tác khóa hoặc mở khóa với tài khoản này.') : undefined,
        h(
          'section',
          { class: 'detail-block' },
          h('h3', { class: 'subtitle' }, 'Tài khoản'),
          definition([
            ['Trạng thái', statusBadge(user.status, USER_STATUS_LABEL[user.status])],
            ['Vai trò', roleChips(user.roles)],
            ['Số điện thoại', user.phoneMasked],
            ['Ngày tạo', formatDateTimeVn(user.createdAt)],
            ['Phiên bản dữ liệu', String(user.version)],
          ]),
        ),
        ...profileBlocks(user),
        h(
          'section',
          { class: 'detail-block' },
          h('h3', { class: 'subtitle' }, 'Lịch sử tài khoản'),
          user.events.length === 0
            ? h('p', { class: 'muted' }, 'Chưa có thay đổi nào được ghi lại.')
            : h(
                'ol',
                { class: 'timeline' },
                ...user.events.map((event) =>
                  h(
                    'li',
                    { class: 'timeline-item' },
                    h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                    h('div', {}, h('p', { class: 'timeline-label' }, event.label), h('p', { class: 'timeline-meta' }, [formatDateTimeVn(event.at), event.actor].filter((part) => part !== undefined).join(' · ')), event.reason === undefined ? undefined : h('p', { class: 'timeline-reason' }, `Lý do: ${event.reason}`)),
                  ),
                ),
              ),
        ),
      );
      break;
    }
  }
  return h('section', { class: 'content content-wide', 'aria-labelledby': 'user-title' }, back, pageHead(title, subtitle, 'user-title'), body);
}

// ---- D87 / D88: lock and unlock dialogs ----------------------------------------------------------------------------------

export interface LockHooks {
  /** The reason typed, already validated. */
  submit(reason: string): void;
  cancel(): void;
  /** After "unknown outcome": read the user's current state, never send the command again by itself. */
  recheck(): void;
  /** After "unknown outcome": the admin chose to ask again. The caller sends the SAME intent (same key, body and version). */
  retry(): void;
  /** After a version conflict: load the user again. */
  reload(): void;
}

const LOCK_COPY = {
  LOCK: {
    title: 'Khóa tài khoản?',
    warning: 'Người dùng sẽ bị đăng xuất khỏi cả 11Food và 11Ship và không thể đăng nhập lại cho đến khi được mở khóa.',
    confirm: 'Khóa',
    working: 'Đang khóa…',
  },
  UNLOCK: {
    title: 'Mở khóa tài khoản?',
    warning: 'Người dùng có thể đăng nhập lại bằng mật khẩu của mình. Mở khóa không khôi phục các phiên đã bị đăng xuất, và không tự mở lại hồ sơ hay số dư.',
    confirm: 'Mở khóa',
    working: 'Đang mở khóa…',
  },
} as const;

export function openLockDialog(user: UserDetail, dialog: LockDialog, hooks: LockHooks, host?: HTMLElement): DialogHandle {
  const copy = LOCK_COPY[dialog.action];
  const reason = h('textarea', { id: 'lock-reason', class: 'textarea', rows: '4', maxlength: String(REASON_MAX * 2), 'aria-describedby': 'lock-reason-error lock-reason-count', placeholder: 'Nhập lý do (bắt buộc)' });
  reason.value = dialog.reason;
  const reasonError = message('error', 'lock-reason-error');
  const count = h('p', { id: 'lock-reason-count', class: 'hint hint-end' }, `${Array.from(dialog.reason).length}/${REASON_MAX}`);
  const status = message(dialog.phase === 'unknown' || dialog.phase === 'conflict' ? 'warning' : 'error', 'lock-status');
  const working = dialog.phase === 'working';
  const finished = dialog.phase === 'unknown' || dialog.phase === 'conflict';
  reason.disabled = working || finished;
  const cancel = secondary('Hủy');
  cancel.disabled = working;
  cancel.addEventListener('click', () => hooks.cancel());
  let confirm: HTMLButtonElement;
  const extra: HTMLElement[] = [];
  if (dialog.phase === 'unknown') {
    confirm = primary('Thử lại', 'button');
    confirm.addEventListener('click', () => hooks.retry());
    const recheck = secondary('Kiểm tra lại trạng thái');
    recheck.addEventListener('click', () => hooks.recheck());
    extra.push(recheck);
    setMessage(status, 'Chưa xác nhận được kết quả. Hãy kiểm tra lại trạng thái tài khoản; yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.');
  } else if (dialog.phase === 'conflict') {
    confirm = primary('Tải lại chi tiết', 'button');
    confirm.addEventListener('click', () => hooks.reload());
    setMessage(status, 'Dữ liệu tài khoản đã thay đổi. Hãy tải lại chi tiết và kiểm tra đúng tài khoản trước khi thao tác.');
  } else {
    confirm = dialog.action === 'LOCK' ? h('button', { type: 'button', class: 'btn btn-danger-solid' }, copy.confirm) : primary(copy.confirm, 'button');
    confirm.disabled = working;
    confirm.textContent = working ? copy.working : copy.confirm;
    confirm.setAttribute('aria-busy', String(working));
    confirm.addEventListener('click', () => {
      const result = validateReason(reason.value);
      if (!result.ok) {
        setMessage(reasonError, result.message);
        reason.setAttribute('aria-invalid', 'true');
        reason.focus();
        return;
      }
      hooks.submit(result.value);
    });
    if (dialog.phase === 'failed') {
      setMessage(status, dialog.error ?? 'Chưa thể thực hiện. Vui lòng thử lại.');
    }
  }
  reason.addEventListener('input', () => {
    count.textContent = `${Array.from(reason.value).length}/${REASON_MAX}`;
    setMessage(reasonError, undefined);
    reason.removeAttribute('aria-invalid');
  });
  if (dialog.error !== undefined && dialog.phase === 'form') {
    setMessage(reasonError, dialog.error);
    reason.setAttribute('aria-invalid', 'true');
  }
  return openDialog({
    title: copy.title,
    host,
    onDismiss: working ? undefined : () => hooks.cancel(),
    body: [
      h('div', { class: 'dialog-target' }, h('span', { class: 'avatar avatar-small', 'aria-hidden': 'true' }, icon('user', 16)), h('div', {}, h('p', { class: 'dialog-target-name' }, user.fullName ?? 'Chưa có tên'), h('p', { class: 'dialog-target-meta' }, user.phoneMasked))),
      h('p', { class: `dialog-warning dialog-warning-${dialog.action === 'LOCK' ? 'danger' : 'info'}`, role: 'note' }, icon(dialog.action === 'LOCK' ? 'alert' : 'info', 18), h('span', {}, copy.warning)),
      h('div', { class: 'field' }, h('label', { for: 'lock-reason', class: 'label' }, 'Lý do'), reason, reasonError, count),
      status,
    ],
    actions: [cancel, ...extra, confirm],
  });
}

// ---- Administrators --------------------------------------------------------------------------------------------------

export interface AdministratorsHooks extends Pick<AccountsHooks, 'retry' | 'login' | 'home'> {
  invite(): void;
  /** false = no data source yet: search and filter are disabled (the not-wired panel says why). */
  readonly wired: boolean;
  filter(filter: AdministratorFilter): void;
  refresh(): void;
  /** false = the live list only has activated accounts, so there is no "Chờ kích hoạt" filter (pending ones are in Lời mời). Absent = true. */
  readonly pending?: boolean;
  /** Next page of the live list; absent = the list has no paging (design preview). */
  loadMore?(): void;
}

export class AdministratorsView {
  readonly #search: HTMLInputElement;
  readonly #status: HTMLSelectElement;
  readonly #refresh: HTMLButtonElement;
  readonly #hint: HTMLElement;
  readonly #results: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: AdministratorsHooks,
  ) {
    const invite = h('a', { href: formatRoute({ name: 'invitation-new' }), class: 'btn btn-primary btn-inline btn-anchor' }, icon('mail', 18), 'Tạo lời mời');
    invite.addEventListener('click', (event) => {
      if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        this.hooks.invite();
      }
    });
    this.#search = h('input', { id: 'admins-search', type: 'search', class: 'search-input', placeholder: 'Tìm theo tên hoặc số điện thoại', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Tìm theo tên hoặc số điện thoại', maxlength: '120' });
    this.#status = h(
      'select',
      { id: 'admins-status', class: 'select', 'aria-label': 'Trạng thái' },
      h('option', { value: 'ALL' }, 'Trạng thái'),
      ...((hooks.pending === false ? ['ACTIVE', 'LOCKED'] : ['ACTIVE', 'PENDING', 'LOCKED']) as readonly AdministratorStatus[]).map((status) => h('option', { value: status }, ADMINISTRATOR_STATUS_LABEL[status])),
    );
    this.#refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    this.#hint = message('notice', 'admins-hint');
    this.#results = h('div', { class: 'results' });
    const emit = (): void => this.hooks.filter(this.#read());
    this.#search.addEventListener('input', emit);
    this.#status.addEventListener('change', emit);
    this.#refresh.addEventListener('click', () => this.hooks.refresh());
    const toolbar = h('div', { class: 'toolbar toolbar-filters', role: 'search' }, h('div', { class: 'search' }, icon('search', 18), this.#search), this.#status, this.#refresh);
    root.replaceChildren(h('section', { class: 'content content-wide', 'aria-labelledby': 'admins-title' }, pageHead('Quản trị viên', 'Quản lý tài khoản quản trị và phạm vi quyền được cấp', 'admins-title', invite), toolbar, this.#hint, this.#results));
  }

  #read(): AdministratorFilter {
    const status = this.#status.value;
    return { query: this.#search.value, status: status === 'ACTIVE' || status === 'PENDING' || status === 'LOCKED' ? status : 'ALL' };
  }

  render(screen: AdministratorsScreen): void {
    const filter = screen.filter ?? EMPTY_ADMIN_FILTER;
    if (this.#search !== document.activeElement && this.#search.value !== filter.query) {
      this.#search.value = filter.query;
    }
    this.#status.value = filter.status;
    const usable = this.hooks.wired && screen.state.kind !== 'not-wired';
    for (const control of [this.#search, this.#status]) {
      control.disabled = !usable;
    }
    this.#refresh.disabled = !usable || screen.state.kind === 'loading';
    setMessage(this.#hint, screen.state.kind === 'not-wired' ? 'Tìm kiếm và bộ lọc sẽ dùng được khi danh sách được nối với máy chủ.' : undefined);
    const columns: readonly Column[] = [{ label: 'Họ tên' }, { label: 'Số điện thoại' }, { label: 'Phạm vi quyền' }, { label: 'Trạng thái' }, { label: 'Ngày tạo' }];
    const caption = 'Danh sách quản trị viên';
    const state = screen.state;
    const filtered = filter.query.trim() !== '' || filter.status !== 'ALL';
    let table: HTMLElement;
    switch (state.kind) {
      case 'not-wired':
        table = tableCard(caption, columns, { panel: notWiredPanel(state.reason) });
        break;
      case 'loading':
        table = tableCard(caption, columns, { panel: skeleton() });
        break;
      case 'empty':
        table = tableCard(caption, columns, {
          panel: filtered ? emptyPanel('Không tìm thấy quản trị viên', 'Thử đổi từ khóa hoặc bộ lọc trạng thái.') : emptyPanel('Chưa có quản trị viên', 'Quản trị viên xuất hiện ở đây sau khi kích hoạt lời mời.'),
        });
        break;
      case 'failed':
        table = tableCard(caption, columns, { panel: failurePanel(state.failure, { retry: () => this.hooks.retry(), login: () => this.hooks.login(), home: () => this.hooks.home() }, state.retryAfterSec) });
        break;
      case 'rows': {
        const card = tableCard(caption, columns, { rows: state.rows.map((row: AdministratorRow) => h('tr', {}, cell('Họ tên', row.fullName), cell('Số điện thoại', row.phoneMasked), cell('Phạm vi quyền', h('span', { class: 'chips' }, ...row.scopes.map((scope) => h('span', { class: 'chip' }, scope)))), cell('Trạng thái', statusBadge(row.status, ADMINISTRATOR_STATUS_LABEL[row.status])), cell('Ngày tạo', formatDateVn(row.createdAt)))) });
        const loadMore = this.hooks.loadMore?.bind(this.hooks);
        if (state.nextCursor === null || loadMore === undefined) {
          table = card;
          break;
        }
        const more = secondary(state.loadingMore === true ? 'Đang tải…' : 'Tải thêm');
        more.disabled = state.loadingMore === true;
        more.addEventListener('click', () => loadMore());
        table = h('div', {}, card, h('div', { class: 'more' }, more));
        break;
      }
    }
    this.#results.replaceChildren(table);
  }
}
