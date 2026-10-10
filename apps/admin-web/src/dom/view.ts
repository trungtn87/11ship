import { AdminAuthController, Screen } from '../core/controller.js';
import { COPY, formatCountdown } from '../core/messages.js';
import { encodeQr, qrPath } from '../core/qr.js';
import { groupSecret, isCompleteCode, sanitizeCodeInput } from '../core/inputs.js';

// DOM rendering of the controller's screens. Every node is built with createElement/textContent (no innerHTML), so no
// server value can become markup. A screen is built once when its name changes and then patched in place, so focus,
// caret and typed values survive the updates.

type Attrs = Record<string, string | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | undefined)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child !== undefined) {
      element.append(child);
    }
  }
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string>, ...children: SVGElement[]): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** 24x24, stroke 2, round caps: the brand icon grid. */
function eyeIcon(open: boolean): SVGElement {
  const paths = [
    svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }),
    svg('circle', { cx: '12', cy: '12', r: '3' }),
  ];
  if (!open) {
    paths.push(svg('path', { d: 'M3 3l18 18' }));
  }
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    ...paths,
  );
}

/**
 * The brand slot. The official "11" logo asset is not in the repository yet (brand guideline section 12: logo SVG/PNG is
 * an open item) and the logo must not be redrawn, so this shows the plain text "11" as a placeholder. When the asset is
 * added (for example public/brand/logo-11.svg) this is the only place to change.
 */
function brand(): HTMLElement {
  return h('div', { class: 'brand' }, h('span', { class: 'brand-fallback', 'aria-label': '11' }, '11'), h('span', { class: 'brand-name' }, 'Quản trị'));
}

function message(kind: 'error' | 'notice' | 'warning', id: string): HTMLElement {
  // Live regions exist from the first render (empty) so screen readers announce later changes.
  return h('p', { id, class: `message message-${kind}`, role: kind === 'error' ? 'alert' : 'status', hidden: true });
}

function setMessage(element: HTMLElement, text: string | undefined): void {
  const value = text ?? '';
  if (element.textContent !== value) {
    element.textContent = value;
  }
  element.hidden = value === '';
}

function field(label: string, id: string, input: HTMLInputElement, extra?: HTMLElement, after?: HTMLElement): HTMLElement {
  const wrap = h('div', { class: 'input-wrap' }, input, extra);
  return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), wrap, after);
}

function primary(label: string, type: 'submit' | 'button' = 'submit'): HTMLButtonElement {
  return h('button', { type, class: 'btn btn-primary' }, label);
}

function secondary(label: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn btn-secondary' }, label);
}

interface Mounted {
  readonly name: Screen['name'];
  update(screen: Screen): void;
  focus(): void;
}

export class AdminView {
  #mounted: Mounted | undefined;
  #ticker: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: AdminAuthController,
  ) {}

  render(screen: Screen): void {
    if (this.#mounted?.name !== screen.name) {
      this.#mounted = this.#mount(screen);
      this.#mounted.update(screen);
      this.#mounted.focus();
    } else {
      this.#mounted.update(screen);
    }
    this.#syncTicker(screen);
  }

  /** The countdown text is refreshed every second while a lock is shown; the controller re-emits when it ends. */
  #syncTicker(screen: Screen): void {
    const locked = 'lock' in screen && screen.lock !== undefined;
    if (locked && this.#ticker === undefined) {
      this.#ticker = window.setInterval(() => this.#mounted?.update(this.controller.screen), 1000);
    } else if (!locked && this.#ticker !== undefined) {
      window.clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
  }

  #lockText(screen: Screen): string | undefined {
    if (!('lock' in screen) || screen.lock === undefined) {
      return undefined;
    }
    return COPY.rateLimited(formatCountdown(this.controller.lockRemainingSeconds()));
  }

  #page(card: HTMLElement, headerExtra?: HTMLElement): void {
    const header = h('header', { class: 'topbar' }, brand(), headerExtra);
    const main = h('main', { class: 'main' }, card);
    this.root.replaceChildren(h('div', { class: 'page' }, header, main));
  }

  #mount(screen: Screen): Mounted {
    switch (screen.name) {
      case 'checking':
        return this.#mountChecking();
      case 'unavailable':
        return this.#mountUnavailable();
      case 'login':
        return this.#mountLogin();
      case 'enroll':
      case 'verify':
        return this.#mountCode(screen.name);
      case 'shell':
        return this.#mountShell();
    }
  }

  #mountChecking(): Mounted {
    const card = h(
      'section',
      { class: 'card card-quiet', 'aria-busy': 'true', 'aria-labelledby': 'checking-text' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { id: 'checking-text', class: 'muted' }, 'Đang kiểm tra phiên đăng nhập…'),
    );
    this.#page(card);
    return { name: 'checking', update: () => undefined, focus: () => undefined };
  }

  #mountUnavailable(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Quản trị');
    const text = h('p', { class: 'message message-error', role: 'alert' }, COPY.unavailable);
    const retry = primary('Thử lại', 'button');
    retry.addEventListener('click', () => void this.controller.retryStart());
    this.#page(h('section', { class: 'card' }, title, text, retry));
    return {
      name: 'unavailable',
      update: (s) => {
        if (s.name === 'unavailable') {
          retry.disabled = s.pending;
          retry.textContent = s.pending ? 'Đang kiểm tra…' : 'Thử lại';
        }
      },
      focus: () => title.focus(),
    };
  }

  #mountLogin(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, 'Đăng nhập quản trị');
    const lead = h('p', { class: 'lead' }, 'Dành cho tài khoản được cấp quyền.');
    const notice = message('notice', 'login-notice');
    const phoneError = message('error', 'phone-error');
    const phone = h('input', {
      id: 'phone',
      name: 'phone',
      type: 'tel',
      inputmode: 'tel',
      autocomplete: 'username',
      placeholder: 'Nhập số điện thoại',
      'aria-describedby': 'phone-error',
      spellcheck: 'false',
    });
    const password = h('input', {
      id: 'password',
      name: 'password',
      type: 'password',
      autocomplete: 'current-password',
      'aria-describedby': 'form-error',
    });
    const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false', 'aria-controls': 'password' });
    eye.append(eyeIcon(true));
    eye.addEventListener('click', () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      eye.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      eye.setAttribute('aria-pressed', String(show));
      eye.replaceChildren(eyeIcon(!show));
    });
    const formError = message('error', 'form-error');
    const lockMessage = message('warning', 'login-lock');
    const submit = primary('Tiếp tục');
    const form = h(
      'form',
      { class: 'form', novalidate: true },
      field('Số điện thoại', 'phone', phone, undefined, phoneError),
      field('Mật khẩu', 'password', password, eye),
      formError,
      lockMessage,
      submit,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const typed = password.value;
      void this.controller.submitLogin(phone.value, typed).then((outcome) => {
        if (outcome === 'invalid-phone') {
          phone.focus();
        } else if (outcome === 'missing-password') {
          password.focus();
        }
      });
      // The password never outlives the submit: the field is emptied as soon as the request has it.
      if (this.controller.screen.name === 'login' && this.controller.screen.pending) {
        password.value = '';
      }
    });
    this.#page(h('section', { class: 'card', 'aria-labelledby': 'login-title' }, title, lead, notice, form));
    title.id = 'login-title';
    return {
      name: 'login',
      update: (s) => {
        if (s.name !== 'login') {
          return;
        }
        if (phone.value === '' && s.phone !== '') {
          phone.value = s.phone;
        }
        setMessage(notice, s.notice);
        setMessage(phoneError, s.phoneError);
        phone.setAttribute('aria-invalid', String(s.phoneError !== undefined));
        setMessage(formError, s.formError);
        setMessage(lockMessage, this.#lockText(s));
        const locked = s.lock !== undefined;
        submit.disabled = s.pending || locked;
        submit.textContent = s.pending ? 'Đang kiểm tra…' : 'Tiếp tục';
        submit.setAttribute('aria-busy', String(s.pending));
        phone.readOnly = s.pending;
        password.readOnly = s.pending;
      },
      focus: () => (phone.value === '' ? phone : password).focus(),
    };
  }

  #mountCode(kind: 'enroll' | 'verify'): Mounted {
    const enroll = kind === 'enroll';
    const title = h('h1', { class: 'title', tabindex: '-1', id: `${kind}-title` }, enroll ? 'Thiết lập Authenticator' : 'Xác thực hai bước');
    const notice = message('notice', `${kind}-notice`);
    const card = h('section', { class: 'card', 'aria-labelledby': `${kind}-title` }, title);

    let qrBox: HTMLElement | undefined;
    let keyToggle: HTMLButtonElement | undefined;
    let keyBox: HTMLElement | undefined;
    let secretError: HTMLElement | undefined;
    let reloadSecret: HTMLButtonElement | undefined;
    let shownUri: string | undefined;

    if (enroll) {
      const steps = h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Mở Google Authenticator trên điện thoại.'),
        h('li', {}, 'Quét mã QR bên dưới, hoặc nhập khóa thiết lập.'),
        h('li', {}, 'Nhập mã 6 số hiển thị trong ứng dụng.'),
      );
      qrBox = h('div', { class: 'qr', role: 'img', 'aria-label': 'Mã QR thiết lập Authenticator' });
      keyToggle = h('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false', 'aria-controls': 'setup-key' }, 'Hiện khóa thiết lập');
      keyToggle.addEventListener('click', () => this.controller.toggleKey());
      keyBox = h('p', { id: 'setup-key', class: 'setup-key', hidden: true });
      secretError = message('error', 'secret-error');
      reloadSecret = secondary('Tải lại mã QR');
      reloadSecret.hidden = true;
      reloadSecret.addEventListener('click', () => void this.controller.loadEnrollment());
      card.append(notice, steps, qrBox, keyToggle, keyBox, secretError, reloadSecret);
    } else {
      card.append(h('p', { class: 'lead' }, 'Nhập mã từ Google Authenticator.'), notice);
    }

    const codeError = message('error', `${kind}-code-error`);
    const code = h('input', {
      id: `${kind}-code`,
      name: 'code',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      pattern: '[0-9]*',
      class: 'code-input',
      'aria-describedby': `${kind}-code-error`,
      spellcheck: 'false',
    });
    const lockMessage = message('warning', `${kind}-lock`);
    const ctaLabel = enroll ? 'Xác nhận và tiếp tục' : 'Xác nhận đăng nhập';
    const submit = primary(ctaLabel);
    const back = secondary('Quay lại đăng nhập');
    back.addEventListener('click', () => this.controller.backToLogin());

    const refreshSubmit = (): void => {
      const s = this.controller.screen;
      if (s.name !== kind) {
        return;
      }
      const blocked = s.pending || s.lock !== undefined || (s.name === 'enroll' && s.secret === undefined);
      submit.disabled = blocked || !isCompleteCode(code.value);
    };
    code.addEventListener('input', () => {
      const clean = sanitizeCodeInput(code.value);
      if (clean !== code.value) {
        code.value = clean;
      }
      refreshSubmit();
    });
    const form = h('form', { class: 'form', novalidate: true }, field('Mã xác thực 6 số', code.id, code, undefined, codeError), lockMessage, submit, back);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.submitCode(code.value);
    });
    card.append(form);
    this.#page(card);

    let codeReset = 0;
    return {
      name: kind,
      update: (s) => {
        if (s.name !== kind) {
          return;
        }
        if (s.codeReset !== codeReset) {
          codeReset = s.codeReset;
          code.value = '';
          code.focus();
        }
        setMessage(notice, s.notice);
        setMessage(codeError, s.codeError);
        code.setAttribute('aria-invalid', String(s.codeError !== undefined));
        setMessage(lockMessage, this.#lockText(s));
        code.readOnly = s.pending;
        submit.textContent = s.pending ? 'Đang xác thực…' : ctaLabel;
        submit.setAttribute('aria-busy', String(s.pending));
        back.disabled = false;
        if (s.name === 'enroll' && qrBox !== undefined && keyToggle !== undefined && keyBox !== undefined && secretError !== undefined && reloadSecret !== undefined) {
          if (s.otpauthUri !== shownUri) {
            shownUri = s.otpauthUri;
            qrBox.replaceChildren();
            if (s.otpauthUri !== undefined) {
              const matrix = encodeQr(s.otpauthUri);
              const quiet = 4;
              const box = String(matrix.size + quiet * 2);
              qrBox.append(
                svg(
                  'svg',
                  { viewBox: `0 0 ${box} ${box}`, width: '208', height: '208', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true', focusable: 'false' },
                  svg('rect', { width: box, height: box, fill: '#FFFFFF' }),
                  svg('path', { d: qrPath(matrix, quiet), fill: '#2A2A2E' }),
                ),
              );
            }
          }
          qrBox.classList.toggle('qr-loading', s.loadingSecret);
          qrBox.setAttribute('aria-busy', String(s.loadingSecret));
          const haveSecret = s.secret !== undefined;
          keyToggle.hidden = !haveSecret;
          keyToggle.textContent = s.showKey ? 'Ẩn khóa thiết lập' : 'Hiện khóa thiết lập';
          keyToggle.setAttribute('aria-expanded', String(s.showKey));
          // The key is put in the DOM only while it is shown, and removed again when hidden.
          keyBox.textContent = s.showKey && haveSecret ? groupSecret(s.secret ?? '') : '';
          keyBox.hidden = !(s.showKey && haveSecret);
          setMessage(secretError, s.secretError);
          reloadSecret.hidden = haveSecret || s.loadingSecret || (s.secretError === undefined && s.lock === undefined && s.notice !== COPY.rateLimitedOver);
          reloadSecret.disabled = s.lock !== undefined;
        }
        refreshSubmit();
      },
      focus: () => code.focus(),
    };
  }

  #mountShell(): Mounted {
    const role = h('span', { class: 'role-badge' });
    const logout = secondary('Đăng xuất');
    logout.classList.add('btn-compact');
    logout.addEventListener('click', () => void this.controller.logout());
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'shell-title' }, 'Đăng nhập thành công');
    const roleLine = h('p', { class: 'lead lead-last' }, 'Vai trò: ', role.cloneNode() as HTMLElement);
    const roleText = roleLine.lastChild as HTMLElement;
    const notice = message('notice', 'shell-notice');
    const error = message('error', 'shell-error');
    this.#page(
      h('section', { class: 'card', 'aria-labelledby': 'shell-title' }, title, roleLine, notice, error),
      h('div', { class: 'topbar-actions' }, role, logout),
    );
    return {
      name: 'shell',
      update: (s) => {
        if (s.name !== 'shell') {
          return;
        }
        role.textContent = s.role;
        roleText.textContent = s.role;
        setMessage(notice, s.notice);
        setMessage(error, s.error);
        logout.disabled = s.pending;
        logout.textContent = s.pending ? 'Đang đăng xuất…' : 'Đăng xuất';
        logout.setAttribute('aria-busy', String(s.pending));
      },
      focus: () => title.focus(),
    };
  }
}
