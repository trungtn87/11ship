import { ACCESS_REFUSAL, AccessCommand, AccessSource, AdministratorAccess, APP_LABEL, AppName, AppPermissionRow, RIGHT_KEYS, RIGHT_LABEL, RightKey } from '../core/access.js';
import { commandFailureText, CommandResult } from '../core/commands.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Tài khoản › Phân quyền" (M12-C). SYSTEM only (the server decides again on every call). A matrix of the administrators, and an editor for one: each switch is its
// own right and none opens another (a "process" switch needs its "view" switch, as the server also requires, and nothing else). Saving asks for a reason, shows what will change
// and sends the commands one after another; a command whose answer was lost is retried only with its own Idempotency-Key. Money and configuration rights are never implied
// by an application right. Every node is created with createElement/textContent.

export interface AccessHost {
  readonly source: AccessSource;
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly dialogHost?: HTMLElement;
}

interface Draft {
  readonly apps: Map<AppName, { view: boolean; review: boolean; lock: boolean; catalog: boolean }>;
  readonly rights: Map<RightKey, boolean>;
}

const APPS: readonly AppName[] = ['CUSTOMER', 'SHOP', 'DRIVER'];

function badge(label: string, tone: 'ok' | 'lock' | 'neutral' | 'wait'): HTMLElement {
  return h('span', { class: `badge ${tone === 'ok' ? 'badge-ok' : tone === 'lock' ? 'badge-lock' : tone === 'wait' ? 'badge-wait' : ''}`.trim() }, label);
}

function draftOf(admin: AdministratorAccess): Draft {
  const apps = new Map<AppName, { view: boolean; review: boolean; lock: boolean; catalog: boolean }>();
  for (const app of APPS) {
    const row = admin.permissions.find((entry) => entry.app === app);
    apps.set(app, { view: row?.canView ?? false, review: row?.canReviewProfile ?? false, lock: row?.canLock ?? false, catalog: row?.canManageCatalog ?? false });
  }
  return { apps, rights: new Map(RIGHT_KEYS.map((key) => [key, admin.rights.find((right) => right.key === key)?.granted ?? false])) };
}

function permissionRows(draft: Draft): AppPermissionRow[] {
  return APPS.flatMap((app) => {
    const value = draft.apps.get(app);
    return value === undefined || !value.view ? [] : [{ app, canView: true, canReviewProfile: value.review, canLock: value.lock, canManageCatalog: value.catalog }];
  });
}

const sameApps = (admin: AdministratorAccess, draft: Draft): boolean => JSON.stringify(permissionRows(draft)) === JSON.stringify(APPS.flatMap((app) => admin.permissions.filter((row) => row.app === app && row.canView)));

export class AccessView {
  readonly #results: HTMLElement;
  readonly #editor: HTMLElement;
  readonly #notice: HTMLElement;
  #latest = 0;
  #disposed = false;
  #dialog: DialogHandle | undefined;
  #admins: readonly AdministratorAccess[] = [];
  #selected: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: AccessHost,
  ) {
    this.#results = h('div', { class: 'results' });
    this.#editor = h('aside', { class: 'drawer', id: 'access-editor', 'aria-label': 'Phân quyền quản trị viên', hidden: true });
    this.#notice = h('p', { class: 'notice', role: 'status', hidden: true });
    const refresh = secondary('Làm mới');
    refresh.classList.add('btn-inline');
    refresh.addEventListener('click', () => void this.load());
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'access-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'access-title' }, 'Phân quyền'), h('p', { class: 'lead lead-last' }, 'SYSTEM cấp, thu hồi quyền, khóa/mở khóa và thu hồi phiên của ADMIN. Mỗi quyền là một công tắc riêng; quyền ví, báo cáo và nhật ký không đi kèm quyền ứng dụng. ADMIN không tự nâng quyền và không quản lý SYSTEM.'))),
        h('div', { class: 'toolbar' }, refresh),
        this.#notice,
        this.#results,
        this.#editor,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    this.#dialog?.close();
  }

  #say(text: string | undefined): void {
    this.#notice.textContent = text ?? '';
    this.#notice.hidden = text === undefined;
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#results.replaceChildren(skeleton());
    const read = await this.host.source.read();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#results.replaceChildren(notWiredPanel(read.reason));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#results.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#admins = read.matrix.items;
    if (read.matrix.items.length === 0) {
      this.#results.replaceChildren(emptyPanel('Chưa có quản trị viên ADMIN', 'Mời ADMIN ở mục Lời mời Admin; sau khi họ kích hoạt, quyền sẽ được quản lý ở đây.'));
      this.#editor.hidden = true;
      return;
    }
    const columns = ['Quản trị viên', 'Số điện thoại', 'Trạng thái', 'Phiên đang mở', 'Quyền ứng dụng', 'Quyền chức năng', 'Thao tác'];
    const rows = read.matrix.items.map((admin) => this.#row(admin));
    this.#results.replaceChildren(
      h(
        'div',
        {},
        h('div', { class: 'table-card' }, h('table', { class: 'table' }, h('caption', { class: 'sr-only' }, 'Quản trị viên ADMIN'), h('thead', {}, h('tr', {}, ...columns.map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, ...rows))),
        read.matrix.truncated ? h('p', { class: 'hint' }, 'Chỉ hiển thị 200 quản trị viên mới nhất.') : undefined,
      ),
    );
    // The editor shows the CURRENT stored state: a reload drops any unsaved draft rather than mixing it with new data.
    const current = this.#selected === undefined ? undefined : read.matrix.items.find((admin) => admin.userId === this.#selected);
    if (current === undefined) {
      this.#selected = undefined;
      this.#editor.hidden = true;
      this.#editor.replaceChildren();
    } else {
      this.#openEditor(current);
    }
  }

  #row(admin: AdministratorAccess): HTMLElement {
    const open = h('button', { type: 'button', class: 'table-link table-action', 'aria-label': `Phân quyền cho ${admin.fullName}` }, 'Phân quyền');
    open.addEventListener('click', () => {
      this.#say(undefined);
      this.#openEditor(admin);
    });
    const apps = admin.permissions.filter((row) => row.canView).map((row) => APP_LABEL[row.app]);
    const rights = admin.rights.filter((right) => right.granted).map((right) => RIGHT_LABEL[right.key]);
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Quản trị viên', class: 'cell-name' }, admin.fullName),
      h('td', { 'data-label': 'Số điện thoại' }, admin.phoneMasked),
      h('td', { 'data-label': 'Trạng thái' }, admin.status === 'ACTIVE' ? badge('Hoạt động', 'ok') : badge('Đang khóa', 'lock')),
      h('td', { 'data-label': 'Phiên đang mở' }, String(admin.liveSessions), admin.lastLoginAt === null ? undefined : h('span', { class: 'cell-sub' }, `Đăng nhập gần nhất ${formatDateTime(admin.lastLoginAt)}`)),
      h('td', { 'data-label': 'Quyền ứng dụng' }, apps.length === 0 ? '—' : apps.join(', ')),
      h('td', { 'data-label': 'Quyền chức năng' }, rights.length === 0 ? '—' : rights.join(', ')),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }

  // ---- editor --------------------------------------------------------------------------------------------------------------------

  #openEditor(admin: AdministratorAccess): void {
    this.#selected = admin.userId;
    const draft = draftOf(admin);
    this.#editor.hidden = false;
    const close = secondary('Đóng');
    close.classList.add('btn-inline');
    close.addEventListener('click', () => {
      this.#selected = undefined;
      this.#editor.hidden = true;
      this.#editor.replaceChildren();
    });
    const check = (checked: boolean, label: string, disabled: boolean, change: (value: boolean) => void): HTMLElement => {
      const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}), ...(disabled ? { disabled: true } : {}), 'aria-label': label });
      input.addEventListener('change', () => {
        change(input.checked);
        this.#refreshSave(admin, draft);
        syncDisabled();
      });
      return h('label', { class: 'check' }, input, h('span', {}, label));
    };
    const inputs: Array<() => void> = [];
    const syncDisabled = (): void => inputs.forEach((fn) => fn());
    const appBlock = (app: AppName): HTMLElement => {
      const value = draft.apps.get(app) as { view: boolean; review: boolean; lock: boolean; catalog: boolean };
      const view = check(value.view, 'Xem', false, (on) => {
        value.view = on;
        if (!on) {
          value.review = false;
          value.lock = false;
          value.catalog = false;
        }
      });
      const parts: HTMLElement[] = [view];
      const dependent = (label: string, get: () => boolean, set: (on: boolean) => void): void => {
        const node = check(get(), label, !value.view, set);
        inputs.push(() => {
          const box = node.querySelector('input') as HTMLInputElement;
          box.disabled = !value.view;
          box.checked = get();
        });
        parts.push(node);
      };
      if (app !== 'CUSTOMER') {
        dependent(app === 'DRIVER' ? 'Xử lý: xem liên hệ, xử lý hàng, duyệt hồ sơ' : 'Xử lý: duyệt hồ sơ', () => value.review, (on) => (value.review = on));
      }
      dependent(app === 'DRIVER' ? 'Khóa: khóa shipper, gỡ shipper khỏi đơn, chỉnh phí' : 'Khóa tài khoản', () => value.lock, (on) => (value.lock = on));
      if (app === 'SHOP') {
        dependent('Quản lý nhóm món', () => value.catalog, (on) => (value.catalog = on));
      }
      return h('li', { class: 'access-row' }, h('span', { class: 'access-group' }, APP_LABEL[app]), h('span', { class: 'access-switches' }, ...parts));
    };
    const rightRow = (title: string, keys: readonly RightKey[], note?: string): HTMLElement =>
      h('li', { class: 'access-row' }, h('span', { class: 'access-group' }, title), h('span', { class: 'access-switches' }, ...keys.map((key) => check(draft.rights.get(key) ?? false, RIGHT_LABEL[key], false, (on) => draft.rights.set(key, on))), note === undefined ? undefined : h('span', { class: 'hint' }, note)));
    const fixed = (title: string, text: string): HTMLElement => h('li', { class: 'access-row' }, h('span', { class: 'access-group' }, title), h('span', { class: 'access-switches hint' }, text));
    const save = primary('Xem lại và lưu', 'button');
    save.id = 'access-save';
    save.disabled = true;
    save.addEventListener('click', () => this.#confirm(admin, draft));
    this.#editor.replaceChildren(
      h('header', { class: 'drawer-head' }, h('h2', { class: 'subtitle' }, `Phân quyền: ${admin.fullName}`), close),
      h('p', { class: 'hint' }, `${admin.phoneMasked} · ${admin.status === 'ACTIVE' ? 'đang hoạt động' : 'đang khóa'} · ${String(admin.liveSessions)} phiên đang mở`),
      h(
        'ul',
        { class: 'access-list' },
        ...APPS.map(appBlock),
        rightRow('Ví và giao dịch', ['wallet.read', 'wallet.topup.record'], 'Quyền tiền không suy ra từ quyền ứng dụng.'),
        fixed('Phản ánh', 'Chưa có (M11 chưa được xây dựng).'),
        fixed('Cấu hình', 'Xem: mọi ADMIN. Sửa: chỉ SYSTEM (quyết định của Owner 17/10/2026).'),
        rightRow('Báo cáo và xuất dữ liệu', ['report.read', 'report.export'], 'Xuất tách khỏi xem.'),
        rightRow('Nhật ký', ['audit.read']),
      ),
      h('div', { class: 'form-actions' }, save, ...this.#accountButtons(admin)),
    );
    this.#refreshSave(admin, draft);
    syncDisabled();
  }

  #refreshSave(admin: AdministratorAccess, draft: Draft): void {
    const save = this.#editor.querySelector<HTMLButtonElement>('#access-save');
    if (save === null) {
      return;
    }
    const rights = this.#rightChanges(admin, draft);
    const appsOk = permissionRows(draft).length > 0;
    save.disabled = (sameApps(admin, draft) && rights.length === 0) || !appsOk;
    save.title = appsOk ? '' : 'Cần ít nhất một quyền Xem ở một ứng dụng.';
  }

  #rightChanges(admin: AdministratorAccess, draft: Draft): Array<{ key: RightKey; grant: boolean; version: number }> {
    return RIGHT_KEYS.flatMap((key) => {
      const now = admin.rights.find((right) => right.key === key);
      const want = draft.rights.get(key) ?? false;
      return (now?.granted ?? false) === want ? [] : [{ key, grant: want, version: now?.version ?? 0 }];
    });
  }

  #accountButtons(admin: AdministratorAccess): HTMLElement[] {
    const lock = admin.membershipStatus === 'ACTIVE';
    const toggle = secondary(lock ? 'Khóa tài khoản' : 'Mở khóa');
    toggle.addEventListener('click', () => this.#reasonDialog(lock ? 'Khóa tài khoản ADMIN' : 'Mở khóa tài khoản ADMIN', lock ? `${admin.fullName} sẽ bị đăng xuất khỏi mọi phiên ngay và không đăng nhập được cho đến khi mở khóa.` : `${admin.fullName} có thể đăng nhập lại bằng mật khẩu và Authenticator. Các phiên cũ không được khôi phục.`, lock ? 'Khóa' : 'Mở khóa', (reason, key) => ({ name: lock ? 'lock' : 'unlock', userId: admin.userId, version: admin.membershipVersion, reason, key })));
    const revoke = secondary('Thu hồi phiên');
    revoke.addEventListener('click', () => this.#reasonDialog('Thu hồi mọi phiên đăng nhập', `${admin.fullName} sẽ phải đăng nhập lại trên mọi thiết bị. Quyền không đổi.`, 'Thu hồi phiên', (reason, key) => ({ name: 'revoke-sessions', userId: admin.userId, reason, key })));
    return [toggle, revoke];
  }

  // ---- commands ------------------------------------------------------------------------------------------------------------------

  /** A single command with a reason (lock, unlock, revoke sessions): one request, locked while it runs, "Thử lại" with the same key after a lost answer. */
  #reasonDialog(title: string, text: string, confirmLabel: string, build: (reason: string, key: string) => AccessCommand): void {
    const reason = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', 'aria-label': 'Lý do', placeholder: 'Lý do (bắt buộc, ghi vào nhật ký)' });
    const error = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const confirm = primary(confirmLabel, 'button');
    const back = secondary('Quay lại');
    let command: AccessCommand | undefined;
    const handle = (this.#dialog = openDialog({ title, description: text, body: [reason, error], actions: [back, confirm], ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }), onDismiss: () => handle.close() }));
    back.addEventListener('click', () => handle.close());
    confirm.addEventListener('click', () => {
      const value = reason.value.trim();
      if (value === '') {
        error.textContent = 'Nhập lý do.';
        error.hidden = false;
        return;
      }
      // The same intent keeps the same key: a retry after an unknown outcome is the SAME command.
      command ??= build(value, this.host.newKey());
      confirm.disabled = true;
      back.disabled = true;
      reason.disabled = true;
      void this.host.source.command(command).then((result) => {
        if (this.#disposed) {
          return;
        }
        if (result.kind === 'ok') {
          handle.close();
          this.#say('Đã thực hiện và ghi vào nhật ký.');
          void this.load();
          return;
        }
        this.#fail(result, error);
        back.disabled = false;
        if (result.kind === 'unknown') {
          confirm.textContent = 'Thử lại';
          confirm.disabled = false;
        } else if (result.kind === 'conflict') {
          void this.load();
        }
      });
    });
  }

  #fail(result: CommandResult, error: HTMLElement): void {
    if (result.kind === 'session-expired') {
      this.host.onSessionLost();
      return;
    }
    if (result.kind === 'forbidden') {
      this.host.onForbidden();
    }
    error.textContent = commandFailureText(result, ACCESS_REFUSAL) ?? '';
    error.hidden = false;
  }

  /** The save of the editor: what will change, a reason, then the commands one after another (the application permissions first, then each right). */
  #confirm(admin: AdministratorAccess, draft: Draft): void {
    const steps: Array<{ label: string; command: AccessCommand }> = [];
    const rights = this.#rightChanges(admin, draft);
    const reason = h('textarea', { class: 'textarea', rows: '3', maxlength: '500', 'aria-label': 'Lý do', placeholder: 'Lý do (bắt buộc, ghi vào nhật ký)' });
    const error = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const list = h('ul', { class: 'plain-list' });
    if (!sameApps(admin, draft)) {
      list.append(h('li', {}, `Quyền ứng dụng: ${permissionRows(draft).map((row) => APP_LABEL[row.app]).join(', ') || '—'}`));
    }
    for (const change of rights) {
      list.append(h('li', {}, `${change.grant ? 'Cấp' : 'Thu hồi'}: ${RIGHT_LABEL[change.key]}`));
    }
    const confirm = primary('Xác nhận lưu', 'button');
    const back = secondary('Quay lại');
    let done = 0;
    const handle = (this.#dialog = openDialog({ title: `Lưu quyền của ${admin.fullName}`, description: 'Các thay đổi dưới đây có hiệu lực ở thao tác kế tiếp của quản trị viên này.', body: [list, reason, error], actions: [back, confirm], ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }), onDismiss: () => handle.close() }));
    back.addEventListener('click', () => handle.close());
    const run = async (): Promise<void> => {
      confirm.disabled = true;
      back.disabled = true;
      reason.disabled = true;
      while (done < steps.length) {
        const step = steps[done] as { label: string; command: AccessCommand };
        const result = await this.host.source.command(step.command);
        if (this.#disposed) {
          return;
        }
        if (result.kind !== 'ok') {
          const saved = done === 0 ? '' : ` Đã lưu ${String(done)}/${String(steps.length)} bước đầu.`;
          this.#fail(result, error);
          error.textContent = `${step.label}: ${error.textContent ?? ''}${saved}`;
          error.hidden = false;
          back.disabled = false;
          if (result.kind === 'unknown') {
            confirm.textContent = 'Thử lại';
            confirm.disabled = false;
          } else {
            void this.load();
          }
          return;
        }
        done += 1;
      }
      handle.close();
      this.#say('Đã lưu quyền và ghi vào nhật ký.');
      void this.load();
    };
    confirm.addEventListener('click', () => {
      if (steps.length === 0) {
        const value = reason.value.trim();
        if (value === '') {
          error.textContent = 'Nhập lý do.';
          error.hidden = false;
          return;
        }
        if (!sameApps(admin, draft)) {
          steps.push({ label: 'Quyền ứng dụng', command: { name: 'permissions', userId: admin.userId, permissions: permissionRows(draft), fingerprint: admin.fingerprint, reason: value, key: this.host.newKey() } });
        }
        for (const change of rights) {
          steps.push({ label: RIGHT_LABEL[change.key], command: { name: change.grant ? 'grant' : 'revoke', userId: admin.userId, right: change.key, version: change.version, key: this.host.newKey() } });
        }
      }
      void run();
    });
  }
}
