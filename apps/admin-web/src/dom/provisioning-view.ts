import { Clock } from '../core/controller.js';
import { isCompleteCode, PermissionsDraft, sanitizeCodeInput, togglePermission } from '../core/inputs.js';
import { ADMIN_COPY, COPY, formatCountdown } from '../core/messages.js';
import { ComposeDraft, ComposeKind, EMPTY_DRAFT, ProvisioningController, ProvisioningScreen } from '../core/provisioning-controller.js';
import { InvitationApp, InvitationDetail, InvitationStatus, InvitationSummary } from '../core/provisioning-api.js';
import { formatRoute, Route } from '../core/routes.js';
import { codeInput, copyText, field, formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';

// DOM of the SYSTEM invitation screens, drawn inside the shell's content area. Built once per screen kind and patched in
// place, so typed values and focus survive updates. No innerHTML anywhere; the activation link is only ever put in a
// read-only field of the result page and is removed when the user leaves it.

type Compose = Extract<ProvisioningScreen, { name: 'compose' }>;

interface Mounted {
  readonly key: string;
  update(screen: ProvisioningScreen): void;
  focus(): void;
}

interface ComposeParts {
  readonly loadingTarget: HTMLElement;
  readonly targetError: HTMLElement;
  readonly summary: HTMLElement;
  readonly notice: HTMLElement;
  readonly formError: HTMLElement;
  readonly form: HTMLElement;
  readonly codePart: HTMLElement;
  readonly working: HTMLElement;
  readonly retryPart: HTMLElement;
  readonly retryText: HTMLElement;
  readonly donePart: HTMLElement;
  readonly doneTitle: HTMLElement;
  readonly doneSummary: HTMLElement;
  readonly linkBlock: HTMLElement;
  readonly linkInput: HTMLInputElement;
  readonly copyStatus: HTMLElement;
  readonly codeError: HTMLElement;
  readonly lockMessage: HTMLElement;
  readonly countdown: HTMLElement;
  readonly code: HTMLInputElement;
  readonly codeSubmit: HTMLButtonElement;
  readonly submit: HTMLButtonElement;
  readonly errors: {
    readonly fullNameError: HTMLElement;
    readonly phoneError: HTMLElement;
    readonly noteError: HTMLElement;
    readonly reasonError: HTMLElement;
    readonly permissionsError: HTMLElement;
    readonly fullName: HTMLInputElement;
    readonly phone: HTMLInputElement;
    readonly note: HTMLTextAreaElement;
    readonly reason: HTMLTextAreaElement;
  };
}

const STATUS_LABEL: Record<InvitationStatus, string> = {
  PENDING: 'Chờ kích hoạt',
  ACCEPTED: 'Đã kích hoạt',
  REVOKED: 'Đã thu hồi',
  SUPERSEDED: 'Đã thay bằng liên kết mới',
  EXPIRED: 'Hết hạn',
  PHONE_CONFLICT: 'Trùng số điện thoại',
};

const APP_LABEL: Record<InvitationApp, string> = { CUSTOMER: 'Khách hàng', SHOP: 'Quán', DRIVER: 'Xế' };
const APPS: readonly InvitationApp[] = ['CUSTOMER', 'SHOP', 'DRIVER'];

function statusBadge(invitation: Pick<InvitationSummary, 'status' | 'expired'>): HTMLElement {
  const expired = invitation.status === 'PENDING' && invitation.expired;
  const tone = expired ? 'warn' : invitation.status === 'PENDING' ? 'wait' : invitation.status === 'ACCEPTED' ? 'ok' : 'off';
  return h('span', { class: `status status-${tone}` }, expired ? 'Chờ kích hoạt · quá hạn' : STATUS_LABEL[invitation.status]);
}

function textarea(id: string, describedBy: string, rows: number): HTMLTextAreaElement {
  return h('textarea', { id, rows: String(rows), 'aria-describedby': describedBy, spellcheck: 'false' });
}

export class ProvisioningView {
  #mounted: Mounted | undefined;
  #ticker: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ProvisioningController,
    private readonly go: (route: Route) => void,
    private readonly clock: Clock,
  ) {}

  /** Removes everything drawn (and with it the link, if any). */
  dispose(): void {
    if (this.#ticker !== undefined) {
      window.clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
    this.#mounted = undefined;
    this.root.replaceChildren();
  }

  render(screen: ProvisioningScreen): void {
    const key = screen.name === 'compose' ? `compose:${screen.kind}` : screen.name;
    if (this.#mounted?.key !== key) {
      this.#mounted = this.#mount(screen, key);
      this.#mounted.update(screen);
      this.#mounted.focus();
    } else {
      this.#mounted.update(screen);
    }
    const timed = screen.name === 'compose' && (screen.phase === 'code' || screen.lockUntilMs !== undefined);
    if (timed && this.#ticker === undefined) {
      this.#ticker = window.setInterval(() => this.#mounted?.update(this.controller.screen), 1000);
    } else if (!timed && this.#ticker !== undefined) {
      window.clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
  }

  #link(label: string, route: Route, cls = 'link-btn'): HTMLAnchorElement {
    const anchor = h('a', { href: formatRoute(route), class: cls }, label);
    anchor.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      this.go(route);
    });
    return anchor;
  }

  #mount(screen: ProvisioningScreen, key: string): Mounted {
    switch (screen.name) {
      case 'list':
        return this.#mountList(key);
      case 'detail':
        return this.#mountDetail(key);
      case 'compose':
        return this.#mountCompose(key, screen.kind);
      case 'forbidden':
        return this.#mountForbidden(key);
    }
  }

  // ---- list ----

  #mountList(key: string): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Lời mời ADMIN');
    const create = this.#link('Tạo lời mời', { name: 'invitation-new' }, 'btn btn-primary btn-link');
    const filter = h('select', { id: 'filter', class: 'select' });
    filter.append(h('option', { value: 'ALL' }, 'Tất cả trạng thái'));
    for (const [value, label] of Object.entries(STATUS_LABEL)) {
      filter.append(h('option', { value }, label));
    }
    filter.addEventListener('change', () => {
      this.go(filter.value === 'ALL' ? { name: 'invitations' } : { name: 'invitations', status: filter.value as InvitationStatus });
    });
    const error = message('error', 'list-error');
    const loading = h('p', { class: 'muted', role: 'status' });
    const empty = h('p', { class: 'empty', hidden: true }, 'Chưa có lời mời nào.');
    const rows = h('ul', { class: 'rows', 'aria-label': 'Danh sách lời mời' });
    const more = secondary('Tải thêm');
    more.hidden = true;
    more.addEventListener('click', () => void this.controller.loadMore());
    const reload = secondary('Tải lại');
    reload.addEventListener('click', () => this.go({ name: 'invitations', ...(this.#filterStatus(filter.value) ?? {}) }));
    this.root.replaceChildren(
      h('section', { class: 'content', 'aria-labelledby': 'list-title' }, h('div', { class: 'content-head' }, title, create), h('div', { class: 'toolbar' }, field('Trạng thái', 'filter', filter as unknown as HTMLInputElement), reload), error, loading, empty, rows, more),
    );
    title.id = 'list-title';
    return {
      key,
      update: (s) => {
        if (s.name !== 'list') {
          return;
        }
        filter.value = s.filter;
        loading.textContent = s.loading ? 'Đang tải…' : '';
        setMessage(error, s.error === undefined ? undefined : COPY.unavailable);
        empty.hidden = s.loading || s.items.length > 0 || s.error !== undefined;
        rows.replaceChildren(...s.items.map((item) => this.#row(item)));
        more.hidden = s.nextCursor === null;
        more.disabled = s.loadingMore;
        more.textContent = s.loadingMore ? 'Đang tải…' : 'Tải thêm';
      },
      focus: () => title.focus(),
    };
  }

  #filterStatus(value: string): { status: InvitationStatus } | undefined {
    return value === 'ALL' ? undefined : { status: value as InvitationStatus };
  }

  #row(item: InvitationSummary): HTMLElement {
    const detail = this.#link('Xem', { name: 'invitation', id: item.invitationId }, 'link-btn');
    detail.setAttribute('aria-label', `Xem lời mời của ${item.fullName}`);
    return h(
      'li',
      { class: 'row' },
      h('div', { class: 'row-main' }, h('strong', { class: 'row-name' }, item.fullName), h('span', { class: 'row-phone' }, item.phoneMasked)),
      statusBadge(item),
      h('span', { class: 'row-date' }, `Hết hạn ${formatDateTime(item.expiresAt)}`),
      detail,
    );
  }

  // ---- detail ----

  #mountDetail(key: string): Mounted {
    const back = this.#link('← Danh sách', { name: 'invitations' });
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Chi tiết lời mời');
    const status = h('div', { class: 'detail-status' });
    const error = message('error', 'detail-error');
    const loading = h('p', { class: 'muted', role: 'status' });
    const body = h('div', { class: 'detail' });
    const actions = h('div', { class: 'actions' });
    this.root.replaceChildren(h('section', { class: 'content', 'aria-labelledby': 'detail-title' }, back, h('div', { class: 'content-head' }, title, status), error, loading, body, actions));
    title.id = 'detail-title';
    return {
      key,
      update: (s) => {
        if (s.name !== 'detail') {
          return;
        }
        loading.textContent = s.loading ? 'Đang tải…' : '';
        setMessage(error, s.notFound ? ADMIN_COPY.invitationNotFound : s.error === undefined ? undefined : COPY.unavailable);
        const invitation = s.invitation;
        status.replaceChildren(...(invitation === undefined ? [] : [statusBadge(invitation)]));
        body.replaceChildren(...(invitation === undefined ? [] : this.#detailBody(invitation)));
        actions.replaceChildren();
        if (invitation !== undefined && invitation.status === 'PENDING') {
          actions.append(
            this.#link('Cấp lại liên kết', { name: 'invitation-reissue', id: invitation.invitationId }, 'btn btn-secondary btn-link'),
            this.#link('Thu hồi', { name: 'invitation-revoke', id: invitation.invitationId }, 'btn btn-danger btn-link'),
          );
        }
      },
      focus: () => title.focus(),
    };
  }

  #detailBody(invitation: InvitationDetail): HTMLElement[] {
    const item = (label: string, value: string): HTMLElement => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value));
    const list = h(
      'dl',
      { class: 'kvs' },
      item('Họ tên', invitation.fullName),
      item('Số điện thoại', invitation.phoneMasked),
      item('Ghi chú', invitation.note ?? '—'),
      item('Tạo lúc', formatDateTime(invitation.createdAt)),
      item('Hết hạn', formatDateTime(invitation.expiresAt)),
      ...(invitation.terminalAt === null ? [] : [item('Kết thúc lúc', formatDateTime(invitation.terminalAt))]),
    );
    const perms = h('table', { class: 'perm-table' }, h('caption', {}, 'Quyền được cấp'), h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ứng dụng'), h('th', { scope: 'col' }, 'Xem'), h('th', { scope: 'col' }, 'Duyệt hồ sơ'), h('th', { scope: 'col' }, 'Khóa/Mở khóa'))));
    const tbody = h('tbody');
    for (const permission of invitation.permissions) {
      tbody.append(
        h('tr', {}, h('th', { scope: 'row' }, APP_LABEL[permission.app]), h('td', {}, permission.canView ? 'Có' : '—'), h('td', {}, permission.canReviewProfile ? 'Có' : '—'), h('td', {}, permission.canLock ? 'Có' : '—')),
      );
    }
    perms.append(tbody);
    return [list, perms];
  }

  // ---- compose ----

  #mountCompose(key: string, kind: ComposeKind): Mounted {
    const heading = { create: 'Tạo lời mời ADMIN', reissue: 'Cấp lại liên kết', revoke: 'Thu hồi lời mời' }[kind];
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'compose-title' }, heading);
    const back = this.#link('← Danh sách', { name: 'invitations' });
    const loadingTarget = h('p', { class: 'muted', role: 'status' });
    const targetError = message('error', 'compose-target-error');
    const summary = h('div', { class: 'summary', hidden: true });
    const notice = message('notice', 'compose-notice');
    const formError = message('error', 'compose-form-error');

    // --- form part ---
    const fullName = h('input', { id: 'f-name', name: 'full_name', type: 'text', autocomplete: 'off', 'aria-describedby': 'f-name-error', maxlength: '400' });
    const fullNameError = message('error', 'f-name-error');
    const phone = h('input', { id: 'f-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: 'Nhập số điện thoại', 'aria-describedby': 'f-phone-error' });
    const phoneError = message('error', 'f-phone-error');
    const note = textarea('f-note', 'f-note-error', 3);
    const noteError = message('error', 'f-note-error');
    const reason = textarea('f-reason', 'f-reason-error', 3);
    const reasonError = message('error', 'f-reason-error');
    const permissionsError = message('error', 'f-perm-error');
    let permissions: PermissionsDraft = EMPTY_DRAFT.permissions;
    let keepPermissions = true;
    const keep = h('input', { type: 'radio', name: 'perm-mode', id: 'perm-keep', checked: true });
    const replace = h('input', { type: 'radio', name: 'perm-mode', id: 'perm-replace' });
    const matrixBox = h('fieldset', { class: 'perm-box' }, h('legend', {}, 'Quyền theo ứng dụng'));
    const boxes = new Map<string, HTMLInputElement>();
    const matrix = h('table', { class: 'perm-table perm-edit' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ứng dụng'), h('th', { scope: 'col' }, 'Xem'), h('th', { scope: 'col' }, 'Duyệt hồ sơ'), h('th', { scope: 'col' }, 'Khóa/Mở khóa'))));
    const mbody = h('tbody');
    for (const app of APPS) {
      const row = h('tr', {}, h('th', { scope: 'row' }, APP_LABEL[app]));
      for (const [right, label] of [['canView', 'Xem'], ['canReviewProfile', 'Duyệt hồ sơ'], ['canLock', 'Khóa/Mở khóa']] as const) {
        const box = h('input', { type: 'checkbox', id: `p-${app}-${right}`, 'aria-label': `${APP_LABEL[app]} · ${label}` });
        box.addEventListener('change', () => {
          permissions = togglePermission(permissions, app, right, box.checked);
          syncBoxes();
        });
        boxes.set(`${app}.${right}`, box);
        row.append(h('td', {}, box));
      }
      mbody.append(row);
    }
    matrix.append(mbody);
    matrixBox.append(matrix, permissionsError);
    const syncBoxes = (): void => {
      for (const app of APPS) {
        for (const right of ['canView', 'canReviewProfile', 'canLock'] as const) {
          const box = boxes.get(`${app}.${right}`);
          if (box !== undefined) {
            box.checked = permissions[app][right];
            box.disabled = app === 'CUSTOMER' && right === 'canReviewProfile';
          }
        }
      }
    };
    const modeBox = h(
      'fieldset',
      { class: 'perm-box', hidden: kind !== 'reissue' },
      h('legend', {}, 'Quyền của liên kết mới'),
      h('label', { class: 'check', for: 'perm-keep' }, keep, ' Giữ nguyên quyền của lời mời cũ'),
      h('label', { class: 'check', for: 'perm-replace' }, replace, ' Đặt quyền mới'),
    );
    const applyMode = (): void => {
      keepPermissions = keep.checked;
      matrixBox.hidden = kind === 'reissue' && keepPermissions;
    };
    keep.addEventListener('change', applyMode);
    replace.addEventListener('change', applyMode);

    const submit = kind === 'revoke' ? h('button', { type: 'submit', class: 'btn btn-danger' }, 'Tiếp tục') : primary('Tiếp tục');
    const cancel = this.#link('Hủy', { name: 'invitations' }, 'link-btn');
    const formParts: HTMLElement[] = [];
    if (kind === 'create') {
      formParts.push(field('Họ tên', 'f-name', fullName, undefined, fullNameError), field('Số điện thoại', 'f-phone', phone, undefined, phoneError), field('Ghi chú (không bắt buộc)', 'f-note', note as unknown as HTMLInputElement, undefined, noteError));
    } else {
      formParts.push(field('Lý do', 'f-reason', reason as unknown as HTMLInputElement, undefined, reasonError));
    }
    const form = h('form', { class: 'form', novalidate: true }, ...formParts, kind === 'revoke' ? h('span') : kind === 'reissue' ? modeBox : h('span'), kind === 'revoke' ? h('span') : matrixBox, formError, h('div', { class: 'actions' }, submit, cancel));
    if (kind === 'reissue') {
      matrixBox.hidden = true;
    }
    const readDraft = (): ComposeDraft => ({ fullName: fullName.value, phone: phone.value, note: note.value, permissions, reason: reason.value, keepPermissions });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.submitForm(readDraft()).then((outcome) => {
        if (outcome !== 'invalid') {
          return;
        }
        const first = form.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
      });
    });

    // --- code (step-up) part ---
    const codeTitle = h('h2', { class: 'subtitle', tabindex: '-1' }, ADMIN_COPY.stepUpTitle);
    const codeHelp = h('p', { class: 'lead' }, ADMIN_COPY.stepUpHelp);
    const countdown = h('p', { class: 'hint', role: 'timer' });
    const codeError = message('error', 'compose-code-error');
    const lockMessage = message('warning', 'compose-lock');
    const code = codeInput('step-code', 'compose-code-error');
    const codeSubmit = primary('Xác nhận');
    const codeBack = secondary('Quay lại');
    codeBack.addEventListener('click', () => this.controller.backToForm());
    const refreshCode = (): void => {
      const s = this.controller.screen;
      codeSubmit.disabled = s.name !== 'compose' || s.pending || this.controller.lockRemainingSeconds() > 0 || !isCompleteCode(code.value);
    };
    code.addEventListener('input', () => {
      const clean = sanitizeCodeInput(code.value);
      if (clean !== code.value) {
        code.value = clean;
      }
      refreshCode();
    });
    const codeForm = h('form', { class: 'form', novalidate: true }, field('Mã Authenticator 6 số', 'step-code', code, undefined, codeError), lockMessage, h('div', { class: 'actions' }, codeSubmit, codeBack));
    codeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.submitCode(code.value);
    });
    const codePart = h('div', { class: 'step-up', hidden: true }, codeTitle, codeHelp, countdown, codeForm);

    // --- working / retry / done parts ---
    const working = h('p', { class: 'muted', role: 'status', hidden: true }, 'Đang xử lý…');
    const retryText = h('p', { class: 'message message-warning', role: 'alert' });
    const retryButton = primary('Kiểm tra lại', 'button');
    retryButton.addEventListener('click', () => void this.controller.retryBusiness());
    const retryPart = h('div', { class: 'retry', hidden: true }, retryText, h('div', { class: 'actions' }, retryButton, this.#link('Mở danh sách', { name: 'invitations' }, 'btn btn-secondary btn-link')));

    const doneTitle = h('h2', { class: 'subtitle', tabindex: '-1' });
    const doneSummary = h('dl', { class: 'kvs' });
    const linkBlock = h('div', { class: 'link-block', hidden: true });
    const linkInput = h('input', { id: 'issued-link', type: 'text', readonly: true, class: 'link-input', 'aria-label': 'Liên kết kích hoạt', spellcheck: 'false' });
    linkInput.addEventListener('focus', () => linkInput.select());
    const copyButton = secondary('Sao chép liên kết');
    const copyStatus = message('notice', 'copy-status');
    copyButton.addEventListener('click', () => {
      void copyText(linkInput.value).then((ok) => {
        setMessage(copyStatus, ok ? ADMIN_COPY.linkCopied : ADMIN_COPY.linkCopyFailed);
        if (!ok) {
          linkInput.focus();
        }
      });
    });
    linkBlock.append(
      h('p', { class: 'message message-warning' }, 'Liên kết này là bí mật. Chỉ gửi cho đúng người được mời; ai có liên kết đều có thể bắt đầu kích hoạt.'),
      linkInput,
      copyButton,
      copyStatus,
    );
    const donePart = h('div', { class: 'done', hidden: true }, doneTitle, doneSummary, linkBlock, h('div', { class: 'actions' }, this.#link('Về danh sách', { name: 'invitations' }, 'btn btn-primary btn-link')));

    this.root.replaceChildren(
      h('section', { class: 'content content-narrow', 'aria-labelledby': 'compose-title' }, back, title, loadingTarget, targetError, summary, notice, form, codePart, working, retryPart, donePart),
    );

    let codeReset = 0;
    let syncedTarget: string | undefined;
    let lastPhase: string | undefined;
    return {
      key,
      update: (s) => {
        if (s.name !== 'compose') {
          return;
        }
        this.#updateCompose(s, {
          loadingTarget,
          targetError,
          summary,
          notice,
          formError,
          form,
          codePart,
          working,
          retryPart,
          retryText,
          donePart,
          doneTitle,
          doneSummary,
          linkBlock,
          linkInput,
          copyStatus,
          codeError,
          lockMessage,
          countdown,
          code,
          codeSubmit,
          submit,
          errors: { fullNameError, phoneError, noteError, reasonError, permissionsError, fullName, phone, note, reason },
        });
        if (s.target !== undefined && syncedTarget !== s.target.invitationId) {
          syncedTarget = s.target.invitationId;
          permissions = s.draft.permissions;
          syncBoxes();
        } else if (syncedTarget === undefined) {
          syncBoxes();
        }
        if (s.codeReset !== codeReset) {
          codeReset = s.codeReset;
          code.value = '';
          if (s.phase === 'code') {
            code.focus();
          }
        }
        if (s.phase !== lastPhase) {
          lastPhase = s.phase;
          if (s.phase === 'done') {
            doneTitle.focus();
          } else if (s.phase === 'code') {
            code.focus();
          } else if (s.phase === 'retry') {
            retryButton.focus();
          }
        }
        refreshCode();
      },
      focus: () => title.focus(),
    };
  }

  #updateCompose(s: Compose, parts: ComposeParts): void {
    const { loadingTarget, targetError, summary, notice, formError, form, codePart, working, retryPart, retryText, donePart, doneTitle, doneSummary, linkBlock, linkInput, copyStatus, codeError, lockMessage, countdown, code, submit, errors } = parts;
    loadingTarget.textContent = s.loadingTarget ? 'Đang tải lời mời…' : '';
    setMessage(targetError, s.targetError === undefined ? undefined : s.targetError === 'unavailable' ? COPY.unavailable : s.targetError);
    if (s.target !== undefined) {
      summary.hidden = false;
      summary.replaceChildren(h('strong', {}, s.target.fullName), ` · ${s.target.phoneMasked} · `, statusBadge(s.target), ` · hết hạn ${formatDateTime(s.target.expiresAt)}`);
    }
    const inForm = s.phase === 'form';
    form.hidden = !inForm || (s.kind !== 'create' && s.target === undefined);
    codePart.hidden = s.phase !== 'code';
    working.hidden = s.phase !== 'working';
    retryPart.hidden = s.phase !== 'retry';
    donePart.hidden = s.phase !== 'done';
    setMessage(notice, s.notice);
    setMessage(formError, s.phase === 'form' ? s.formError : undefined);
    retryText.textContent = s.phase === 'retry' ? (s.formError ?? ADMIN_COPY.outcomeUnknown) : '';
    const fe = s.fieldErrors;
    setMessage(errors.fullNameError, fe.fullName);
    setMessage(errors.phoneError, fe.phone);
    setMessage(errors.noteError, fe.note);
    setMessage(errors.reasonError, fe.reason);
    setMessage(errors.permissionsError, fe.permissions);
    errors.fullName.setAttribute('aria-invalid', String(fe.fullName !== undefined));
    errors.phone.setAttribute('aria-invalid', String(fe.phone !== undefined));
    errors.note.setAttribute('aria-invalid', String(fe.note !== undefined));
    errors.reason.setAttribute('aria-invalid', String(fe.reason !== undefined));
    submit.disabled = s.pending || s.loadingTarget || (s.kind !== 'create' && s.target?.status !== 'PENDING');
    submit.textContent = s.pending ? 'Đang xử lý…' : 'Tiếp tục';
    // step-up
    const remaining = s.operationExpiresAtMs === undefined ? undefined : Math.max(0, Math.ceil((s.operationExpiresAtMs - this.clock.now()) / 1000));
    countdown.textContent = remaining === undefined ? '' : `Phiên xác nhận còn ${formatCountdown(remaining)}.`;
    const codeMessages = { totp: COPY.totpInvalid, unavailable: ADMIN_COPY.connectionLost };
    setMessage(codeError, s.codeError === undefined ? undefined : codeMessages[s.codeError]);
    code.setAttribute('aria-invalid', String(s.codeError !== undefined));
    code.readOnly = s.pending;
    const lockSeconds = this.controller.lockRemainingSeconds();
    setMessage(lockMessage, lockSeconds > 0 ? COPY.rateLimited(formatCountdown(lockSeconds)) : undefined);
    // result
    if (s.result === undefined) {
      linkInput.value = '';
      linkBlock.hidden = true;
      doneSummary.replaceChildren();
      setMessage(copyStatus, undefined);
      return;
    }
    const entry = (label: string, value: string): HTMLElement => h('div', { class: 'kv' }, h('dt', {}, label), h('dd', {}, value));
    if (s.result.kind === 'issued') {
      const invitation = s.result.issued.invitation;
      doneTitle.textContent = s.kind === 'reissue' ? 'Đã cấp lại liên kết' : 'Đã tạo lời mời';
      doneSummary.replaceChildren(entry('Họ tên', invitation.fullName), entry('Số điện thoại', invitation.phoneMasked), entry('Hết hạn', formatDateTime(invitation.expiresAt)));
      linkBlock.hidden = false;
      if (linkInput.value !== s.result.issued.activationLink) {
        linkInput.value = s.result.issued.activationLink;
      }
    } else {
      doneTitle.textContent = 'Đã thu hồi lời mời';
      doneSummary.replaceChildren(entry('Họ tên', s.result.invitation.fullName), entry('Số điện thoại', s.result.invitation.phoneMasked));
      linkBlock.hidden = true;
    }
  }

  #mountForbidden(key: string): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Không có quyền');
    this.root.replaceChildren(h('section', { class: 'content content-narrow' }, title, h('p', { class: 'message message-error', role: 'alert' }, ADMIN_COPY.forbidden)));
    return { key, update: () => undefined, focus: () => title.focus() };
  }
}
