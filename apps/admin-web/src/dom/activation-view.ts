import { ActivationController, ActivationScreen } from '../core/activation-controller.js';
import { groupSecret, isCompleteCode, sanitizeCodeInput } from '../core/inputs.js';
import { ADMIN_COPY, COPY, formatCountdown } from '../core/messages.js';
import { brand, codeInput, eyeIcon, field, h, message, primary, renderQr, secondary, setMessage, stepLabel } from './dom.js';

// DOM of the public ADMIN activation page (/activate). A screen is built once when its name changes and then patched in
// place, so focus and typed values survive updates. Passwords, codes, the secret and the QR are never written to storage;
// password fields are emptied the moment the request has them; the key is in the DOM only while shown.

interface Mounted {
  readonly name: ActivationScreen['name'];
  update(screen: ActivationScreen): void;
  focus(): void;
}

const TITLE = ADMIN_COPY.activateTitle;

export class ActivationPage {
  #mounted: Mounted | undefined;
  #ticker: number | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ActivationController,
  ) {}

  render(screen: ActivationScreen): void {
    if (this.#mounted?.name !== screen.name) {
      this.#mounted = this.#mount(screen);
      this.#mounted.update(screen);
      this.#mounted.focus();
    } else {
      this.#mounted.update(screen);
    }
    this.#syncTicker(screen);
  }

  #syncTicker(screen: ActivationScreen): void {
    const timed = this.controller.waitSeconds() > 0 || screen.name === 'rate-limited';
    if (timed && this.#ticker === undefined) {
      this.#ticker = window.setInterval(() => this.#mounted?.update(this.controller.screen), 1000);
    } else if (!timed && this.#ticker !== undefined) {
      window.clearInterval(this.#ticker);
      this.#ticker = undefined;
    }
  }

  #page(card: HTMLElement): void {
    this.root.replaceChildren(h('div', { class: 'page' }, h('header', { class: 'topbar' }, brand()), h('main', { class: 'main' }, card)));
  }

  #mount(screen: ActivationScreen): Mounted {
    switch (screen.name) {
      case 'starting':
        return this.#mountStarting();
      case 'unavailable':
        return this.#mountUnavailable();
      case 'link-invalid':
        return this.#mountTerminal('link-invalid', ADMIN_COPY.linkInvalid, ADMIN_COPY.linkInvalidHelp);
      case 'session-expired':
        return this.#mountTerminal('session-expired', ADMIN_COPY.sessionInvalid, ADMIN_COPY.sessionInvalidHelp);
      case 'rate-limited':
        return this.#mountRateLimited();
      case 'invalidated':
        return this.#mountInvalidated();
      case 'otp':
        return this.#mountOtp();
      case 'password':
        return this.#mountPassword();
      case 'enroll':
        return this.#mountEnroll();
      case 'done':
        return this.#mountDone();
    }
  }

  #mountStarting(): Mounted {
    this.#page(
      h(
        'section',
        { class: 'card card-quiet', 'aria-busy': 'true', 'aria-labelledby': 'act-starting' },
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('p', { id: 'act-starting', class: 'muted' }, 'Đang mở liên kết kích hoạt…'),
      ),
    );
    return { name: 'starting', update: () => undefined, focus: () => undefined };
  }

  #mountUnavailable(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, TITLE);
    const retry = primary('Thử lại', 'button');
    retry.id = 'act-retry';
    retry.addEventListener('click', () => void this.controller.retry());
    this.#page(h('section', { class: 'card' }, title, h('p', { class: 'message message-error', role: 'alert' }, COPY.unavailable), retry));
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

  /** Invalid link and expired session: a plain explanation, no action that could be mistaken for progress. */
  #mountTerminal(name: 'link-invalid' | 'session-expired', text: string, help: string): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, TITLE);
    this.#page(h('section', { class: 'card' }, title, h('p', { class: 'message message-error', role: 'alert' }, text), h('p', { class: 'lead lead-last' }, help)));
    return { name, update: () => undefined, focus: () => title.focus() };
  }

  #mountRateLimited(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, TITLE);
    const text = message('warning', 'act-rate');
    this.#page(h('section', { class: 'card' }, title, text, h('p', { class: 'lead lead-last' }, ADMIN_COPY.sessionInvalidHelp)));
    return {
      name: 'rate-limited',
      update: (s) => {
        if (s.name === 'rate-limited') {
          setMessage(text, COPY.rateLimited(formatCountdown(this.controller.waitSeconds())));
        }
      },
      focus: () => title.focus(),
    };
  }

  #mountInvalidated(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, TITLE);
    const text = h('p', { class: 'message message-error', role: 'alert' });
    const help = h('p', { class: 'lead lead-last' });
    const error = message('error', 'act-restart-error');
    const restart = primary(ADMIN_COPY.restart, 'button');
    restart.id = 'act-restart';
    restart.addEventListener('click', () => void this.controller.restart());
    this.#page(h('section', { class: 'card' }, title, text, help, error, restart));
    return {
      name: 'invalidated',
      update: (s) => {
        if (s.name !== 'invalidated') {
          return;
        }
        const copy = {
          REPLACED: [ADMIN_COPY.replaced, ADMIN_COPY.replacedHelp],
          LINK_UNAVAILABLE: [ADMIN_COPY.linkUnavailable, ADMIN_COPY.linkInvalidHelp],
          PHONE_CONFLICT: [ADMIN_COPY.phoneConflictActivation, ADMIN_COPY.phoneConflictHelp],
          ATTEMPTS_EXHAUSTED: [ADMIN_COPY.attemptsExhausted, ADMIN_COPY.restartHelp],
        }[s.reason];
        text.textContent = copy[0] ?? '';
        help.textContent = copy[1] ?? '';
        restart.hidden = !s.canRestart;
        restart.disabled = s.pending;
        restart.textContent = s.pending ? 'Đang xử lý…' : ADMIN_COPY.restart;
        setMessage(error, s.error);
      },
      focus: () => title.focus(),
    };
  }

  #mountOtp(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'act-otp-title' }, TITLE);
    const notice = message('notice', 'act-otp-notice');
    const sendError = message('error', 'act-send-error');
    const test = h('p', { class: 'test-display', hidden: true });
    const send = primary('Gửi mã xác minh', 'button');
    send.id = 'act-send';
    send.addEventListener('click', () => void this.controller.requestOtp());
    const codeError = message('error', 'act-otp-code-error');
    const code = codeInput('act-otp-code', 'act-otp-code-error');
    const submit = primary('Xác nhận mã');
    submit.id = 'act-otp-submit';
    const codeForm = h('form', { class: 'form', novalidate: true }, field('Mã xác minh 6 số', 'act-otp-code', code, undefined, codeError), submit);
    code.addEventListener('input', () => {
      const clean = sanitizeCodeInput(code.value);
      if (clean !== code.value) {
        code.value = clean;
      }
      refresh();
    });
    codeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.verifyOtp(code.value);
    });
    const refresh = (): void => {
      const s = this.controller.screen;
      submit.disabled = s.name !== 'otp' || s.pending || !isCompleteCode(code.value);
    };
    this.#page(
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'act-otp-title' },
        title,
        stepLabel('Bước 1/3 · Xác minh số điện thoại'),
        h('p', { class: 'lead' }, 'Mã xác minh sẽ được gửi tới số điện thoại trong lời mời của bạn.'),
        notice,
        sendError,
        send,
        test,
        codeForm,
      ),
    );
    let codeReset = 0;
    return {
      name: 'otp',
      update: (s) => {
        if (s.name !== 'otp') {
          return;
        }
        if (s.codeReset !== codeReset) {
          codeReset = s.codeReset;
          code.value = '';
        }
        const wait = this.controller.waitSeconds();
        const awaiting = s.otp?.status === 'SUBMITTED' || s.otp?.status === 'FAILED';
        setMessage(notice, s.notice);
        setMessage(sendError, s.sendError === 'unavailable' ? COPY.unavailable : s.sendError);
        send.disabled = s.pending || wait > 0;
        send.textContent = s.pending
          ? 'Đang gửi…'
          : wait > 0
            ? ADMIN_COPY.otpResendWait(formatCountdown(wait))
            : awaiting || s.otp?.status === 'EXPIRED'
              ? 'Gửi lại mã'
              : 'Gửi mã xác minh';
        // TEST_DISPLAY (non-production) shows the code on the page; it is not stored and goes with the screen.
        test.hidden = s.displayedCode === undefined;
        test.textContent = s.displayedCode === undefined ? '' : `${ADMIN_COPY.otpTestDisplay} ${s.displayedCode}`;
        codeForm.hidden = !awaiting;
        const errors = { invalid: ADMIN_COPY.otpInvalid, expired: ADMIN_COPY.otpExpired, locked: ADMIN_COPY.otpLocked, unavailable: COPY.unavailable };
        setMessage(codeError, s.codeError === undefined ? undefined : errors[s.codeError]);
        code.setAttribute('aria-invalid', String(s.codeError !== undefined));
        code.readOnly = s.pending;
        submit.textContent = s.pending ? 'Đang xác minh…' : 'Xác nhận mã';
        refresh();
      },
      focus: () => title.focus(),
    };
  }

  #mountPassword(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'act-pw-title' }, TITLE);
    const notice = message('notice', 'act-pw-notice');
    const error = message('error', 'act-pw-error');
    const password = h('input', { id: 'act-pw', name: 'password', type: 'password', autocomplete: 'new-password', 'aria-describedby': 'act-pw-error act-pw-hint' });
    const confirm = h('input', { id: 'act-pw2', name: 'password-confirm', type: 'password', autocomplete: 'new-password', 'aria-describedby': 'act-pw-error' });
    const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false', 'aria-controls': 'act-pw act-pw2' });
    eye.append(eyeIcon(true));
    eye.addEventListener('click', () => {
      const show = password.type === 'password';
      password.type = show ? 'text' : 'password';
      confirm.type = show ? 'text' : 'password';
      eye.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      eye.setAttribute('aria-pressed', String(show));
      eye.replaceChildren(eyeIcon(!show));
    });
    const hint = h('p', { id: 'act-pw-hint', class: 'hint' }, 'Từ 8 đến 128 ký tự.');
    const submit = primary('Tiếp tục');
    submit.id = 'act-pw-submit';
    const restart = secondary(ADMIN_COPY.restart);
    restart.id = 'act-pw-restart';
    restart.hidden = true;
    restart.addEventListener('click', () => void this.controller.restart());
    const form = h('form', { class: 'form', novalidate: true }, field('Mật khẩu mới', 'act-pw', password, eye, hint), field('Nhập lại mật khẩu', 'act-pw2', confirm), error, submit, restart);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const typed = password.value;
      const again = confirm.value;
      void this.controller.submitPassword(typed, again).then((outcome) => {
        if (outcome === 'invalid') {
          password.focus();
        } else if (outcome === 'mismatch') {
          confirm.focus();
        }
      });
      // The password never outlives the submit: both fields are emptied as soon as the request has them.
      const s = this.controller.screen;
      if (s.name === 'password' && s.pending) {
        password.value = '';
        confirm.value = '';
      }
    });
    this.#page(h('section', { class: 'card', 'aria-labelledby': 'act-pw-title' }, title, stepLabel('Bước 2/3 · Đặt mật khẩu'), notice, form));
    return {
      name: 'password',
      update: (s) => {
        if (s.name !== 'password') {
          return;
        }
        setMessage(notice, s.notice);
        setMessage(error, s.restartRequired ? ADMIN_COPY.passwordExpired : s.error);
        password.setAttribute('aria-invalid', String(s.error !== undefined));
        submit.disabled = s.pending || s.restartRequired;
        submit.textContent = s.pending ? 'Đang lưu…' : 'Tiếp tục';
        password.readOnly = s.pending || s.restartRequired;
        confirm.readOnly = s.pending || s.restartRequired;
        restart.hidden = !s.restartRequired;
        restart.disabled = s.pending;
      },
      focus: () => password.focus(),
    };
  }

  #mountEnroll(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'act-en-title' }, TITLE);
    const notice = message('notice', 'act-en-notice');
    const steps = h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Mở Google Authenticator trên điện thoại.'),
      h('li', {}, 'Quét mã QR bên dưới, hoặc nhập khóa thiết lập.'),
      h('li', {}, 'Nhập mã 6 số hiển thị trong ứng dụng.'),
    );
    const qrBox = h('div', { class: 'qr', role: 'img', 'aria-label': 'Mã QR thiết lập Authenticator' });
    const keyToggle = h('button', { id: 'act-key-toggle', type: 'button', class: 'link-btn', 'aria-expanded': 'false', 'aria-controls': 'act-key' }, 'Hiện khóa thiết lập');
    keyToggle.addEventListener('click', () => this.controller.toggleKey());
    const keyBox = h('p', { id: 'act-key', class: 'setup-key', hidden: true });
    const loadError = message('error', 'act-load-error');
    const reload = secondary('Tải lại mã QR');
    reload.hidden = true;
    reload.addEventListener('click', () => void this.controller.loadEnrollment());
    const codeError = message('error', 'act-en-code-error');
    const attempts = h('p', { class: 'hint', hidden: true });
    const lock = message('warning', 'act-en-lock');
    const code = codeInput('act-en-code', 'act-en-code-error');
    const submit = primary('Hoàn tất kích hoạt');
    submit.id = 'act-en-submit';
    const refresh = (): void => {
      const s = this.controller.screen;
      submit.disabled = s.name !== 'enroll' || s.pending || s.secret === undefined || this.controller.waitSeconds() > 0 || !isCompleteCode(code.value);
    };
    code.addEventListener('input', () => {
      const clean = sanitizeCodeInput(code.value);
      if (clean !== code.value) {
        code.value = clean;
      }
      refresh();
    });
    const form = h('form', { class: 'form', novalidate: true }, field('Mã xác thực 6 số', 'act-en-code', code, undefined, codeError), attempts, lock, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.controller.complete(code.value);
    });
    this.#page(
      h(
        'section',
        { class: 'card', 'aria-labelledby': 'act-en-title' },
        title,
        stepLabel('Bước 3/3 · Thiết lập Authenticator'),
        notice,
        steps,
        qrBox,
        keyToggle,
        keyBox,
        loadError,
        reload,
        form,
      ),
    );
    let shownUri: string | undefined;
    let codeReset = 0;
    return {
      name: 'enroll',
      update: (s) => {
        if (s.name !== 'enroll') {
          return;
        }
        if (s.codeReset !== codeReset) {
          codeReset = s.codeReset;
          code.value = '';
        }
        if (s.otpauthUri !== shownUri) {
          shownUri = s.otpauthUri;
          qrBox.replaceChildren();
          if (s.otpauthUri !== undefined) {
            qrBox.append(renderQr(s.otpauthUri));
          }
        }
        qrBox.classList.toggle('qr-loading', s.loading);
        qrBox.setAttribute('aria-busy', String(s.loading));
        const haveSecret = s.secret !== undefined;
        keyToggle.hidden = !haveSecret;
        keyToggle.textContent = s.showKey ? 'Ẩn khóa thiết lập' : 'Hiện khóa thiết lập';
        keyToggle.setAttribute('aria-expanded', String(s.showKey));
        // The key is in the DOM only while shown.
        keyBox.textContent = s.showKey && haveSecret ? groupSecret(s.secret ?? '') : '';
        keyBox.hidden = !(s.showKey && haveSecret);
        setMessage(loadError, s.loadError === undefined ? undefined : COPY.unavailable);
        reload.hidden = haveSecret || s.loading || s.loadError === undefined;
        setMessage(notice, s.notice);
        setMessage(codeError, s.codeError === 'invalid' ? COPY.totpInvalid : s.codeError === 'unavailable' ? COPY.unavailable : undefined);
        code.setAttribute('aria-invalid', String(s.codeError !== undefined));
        attempts.hidden = s.attemptsLeft === undefined;
        attempts.textContent = s.attemptsLeft === undefined ? '' : `Còn ${s.attemptsLeft} lần thử.`;
        const wait = this.controller.waitSeconds();
        setMessage(lock, wait > 0 ? COPY.rateLimited(formatCountdown(wait)) : undefined);
        code.readOnly = s.pending;
        submit.textContent = s.pending ? 'Đang xác thực…' : 'Hoàn tất kích hoạt';
        refresh();
      },
      focus: () => title.focus(),
    };
  }

  #mountDone(): Mounted {
    const title = h('h1', { class: 'title', tabindex: '-1' }, ADMIN_COPY.activationDone);
    const login = h('a', { id: 'act-login', class: 'btn btn-primary btn-link', href: '/' }, ADMIN_COPY.goToLogin);
    this.#page(h('section', { class: 'card' }, title, h('p', { class: 'lead' }, ADMIN_COPY.activationDoneHelp), login));
    return { name: 'done', update: () => undefined, focus: () => title.focus() };
  }
}

