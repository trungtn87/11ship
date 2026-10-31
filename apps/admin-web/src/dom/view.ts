import { AdminRole } from '../core/api.js';
import { AdminAuthController, Screen } from '../core/controller.js';
import { COPY, formatCountdown } from '../core/messages.js';
import { h, eyeIcon, authPage, message, setMessage, field, primary, secondary, renderQr } from './dom.js';
import { groupSecret, isCompleteCode, sanitizeCodeInput } from '../core/inputs.js';
import { buildShell, KeyValueStore, ShellLayout } from './shell-layout.js';

// DOM rendering of the controller's screens. Every node is built with createElement/textContent (no innerHTML), so no
// server value can become markup. A screen is built once when its name changes and then patched in place, so focus,
// caret and typed values survive the updates.


/** What the shell shows inside its layout. Mounted when the shell appears, unmounted when it goes away. */
export interface ShellHost {
  mount(parts: { readonly layout: ShellLayout; readonly role: AdminRole }): void;
  unmount(): void;
}

/** The browser's local storage, or nothing when it is blocked (only the sidebar's collapsed/expanded choice goes there). */
function pageStorage(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

interface Mounted {
  readonly name: Screen['name'];
  dispose?(): void;
  update(screen: Screen): void;
  focus(): void;
}

export class AdminView {
  #mounted: Mounted | undefined;
  #ticker: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: AdminAuthController,
    private readonly host?: ShellHost,
    /** Where "Quên mật khẩu?" leads. The Web Admin uses "/reset"; the Mini Business PWA "/business/reset" (inside its scope, issue #235). */
    private readonly resetHref: string = '/reset',
  ) {}

  render(screen: Screen): void {
    if (this.#mounted?.name !== screen.name) {
      this.#mounted?.dispose?.();
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

  #page(card: HTMLElement): void {
    this.root.replaceChildren(authPage(card));
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
      h('a', { href: this.resetHref, class: 'link-btn link-center' }, 'Quên mật khẩu?'),
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
              qrBox.append(renderQr(s.otpauthUri));
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
    const layout = buildShell({ onLogout: () => void this.controller.logout(), store: pageStorage() });
    this.root.replaceChildren(layout.root);
    let mountedRole: AdminRole | undefined;
    return {
      name: 'shell',
      dispose: () => {
        mountedRole = undefined;
        this.host?.unmount();
        layout.dispose();
      },
      update: (s) => {
        if (s.name !== 'shell') {
          return;
        }
        setMessage(layout.notice, s.notice);
        setMessage(layout.error, s.error);
        layout.logout.disabled = s.pending;
        layout.logoutLabel.textContent = s.pending ? 'Đang đăng xuất…' : 'Đăng xuất';
        layout.logout.setAttribute('aria-busy', String(s.pending));
        if (mountedRole !== s.role) {
          mountedRole = s.role;
          this.host?.mount({ layout, role: s.role });
        }
      },
      focus: () => layout.content.focus(),
    };
  }
}
