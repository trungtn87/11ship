import { ADMIN_COPY, formatCountdown } from '../core/messages.js';
import { isCompleteCode, isValidPassword, isValidPhone, sanitizeCodeInput } from '../core/inputs.js';
import { authPage, codeInput, eyeIcon, field, h, message, primary, secondary, setMessage } from './dom.js';
import { statePanel } from './states.js';

// DOM of the public page that resets a forgotten ADMIN password (/reset): phone -> SMS code -> new password. The TOTP
// factor is kept (the page never touches it). SYSTEM does not use this page: it recovers through the server tools.
//
// Nothing here talks to a server. The page asks `hooks.wired`; until the backend task (M01.16, form M01.19) exists it is
// false, the buttons that would send something are disabled and the page says why. Passwords and codes live only in the
// fields of the current step: the screen model never holds them, and a new step builds new (empty) fields.

export type ResetCodeError = 'invalid' | 'expired' | 'locked' | 'unavailable';

export type ResetScreen =
  | { readonly name: 'loading' }
  | { readonly name: 'config-error' }
  | { readonly name: 'unavailable' }
  | { readonly name: 'phone'; readonly phone: string; readonly phoneError?: string; readonly pending: boolean }
  | { readonly name: 'otp'; readonly phoneMasked: string; readonly codeError?: ResetCodeError; readonly resendSec?: number; readonly pending: boolean }
  | { readonly name: 'password'; readonly error?: string; readonly pending: boolean }
  | { readonly name: 'done' }
  | { readonly name: 'rate-limited'; readonly retrySec: number };

export interface ResetHooks {
  readonly wired: boolean;
  /** Reads the server's mode again after a failed read. */
  retryConfig?(): void;
  sendCode(phone: string): void;
  verify(code: string): void;
  resend(): void;
  setPassword(password: string): void;
  toLogin(): void;
  /** Where "Về trang đăng nhập" points (default "/"; the Mini Business PWA uses "/business/" so it stays inside its scope). */
  loginHref?: string;
}

const CODE_ERROR: Record<ResetCodeError, string> = {
  invalid: ADMIN_COPY.otpInvalid,
  expired: ADMIN_COPY.otpExpired,
  locked: ADMIN_COPY.otpLocked,
  unavailable: 'Chưa thể kết nối. Vui lòng thử lại.',
};

export const RESET_NOT_WIRED_TEXT = 'Đặt lại mật khẩu bằng SMS OTP chưa khả dụng. Các nút gửi mã chưa dùng được.';

export class ResetPage {
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: ResetHooks,
  ) {}

  render(screen: ResetScreen): void {
    switch (screen.name) {
      case 'loading':
        this.#page(statePanel({ icon: 'clock', tone: 'neutral', live: 'status', title: 'Đang kiểm tra…', text: 'Vui lòng chờ trong giây lát.' }), 'Đặt lại mật khẩu');
        return;
      case 'config-error':
        this.#page(statePanel({ icon: 'alert', tone: 'warning', live: 'alert', title: 'Chưa thể kết nối', text: 'Chưa đọc được cấu hình đặt lại mật khẩu. Vui lòng thử lại.', actions: [{ label: 'Thử lại', onClick: () => this.hooks.retryConfig?.(), kind: 'primary' }, { label: 'Về trang đăng nhập', onClick: () => this.hooks.toLogin(), kind: 'secondary' }] }), 'Đặt lại mật khẩu');
        return;
      case 'unavailable':
        this.#page(statePanel({ icon: 'lock', tone: 'neutral', live: 'status', title: 'Chưa khả dụng', text: 'Đặt lại mật khẩu chưa khả dụng trong phiên bản này.', actions: [{ label: 'Về trang đăng nhập', onClick: () => this.hooks.toLogin(), kind: 'secondary' }] }), 'Đặt lại mật khẩu');
        return;
      case 'phone':
        this.#phone(screen);
        return;
      case 'otp':
        this.#otp(screen);
        return;
      case 'password':
        this.#password(screen);
        return;
      case 'done':
        this.#done();
        return;
      case 'rate-limited':
        this.#page(statePanel({ icon: 'clock', tone: 'warning', live: 'alert', title: 'Bạn yêu cầu mã quá nhiều lần', text: `Vui lòng thử lại sau ${formatCountdown(screen.retrySec)}.`, actions: [{ label: 'Về trang đăng nhập', onClick: () => this.hooks.toLogin(), kind: 'secondary' }] }), 'Đặt lại mật khẩu');
        return;
    }
  }

  #page(card: HTMLElement, title: string): void {
    this.root.replaceChildren(authPage(h('section', { class: 'card', 'aria-label': title }, card)));
    document.title = `${title} · Quản trị · 11`;
  }

  #head(title: string, lead: string): HTMLElement[] {
    const heading = h('h1', { class: 'title', tabindex: '-1', id: 'reset-title' }, title);
    queueMicrotask(() => heading.focus());
    return [heading, h('p', { class: 'lead' }, lead)];
  }

  #wiredNotice(): HTMLElement | undefined {
    if (this.hooks.wired) {
      return undefined;
    }
    const notice = message('warning', 'reset-not-wired');
    setMessage(notice, RESET_NOT_WIRED_TEXT);
    return notice;
  }

  #toLogin(): HTMLElement {
    const back = h('a', { href: this.hooks.loginHref ?? '/', class: 'link-btn link-center' }, 'Về trang đăng nhập');
    back.addEventListener('click', (event) => {
      event.preventDefault();
      this.hooks.toLogin();
    });
    return back;
  }

  #phone(screen: Extract<ResetScreen, { name: 'phone' }>): void {
    const error = message('error', 'reset-phone-error');
    const phone = h('input', { id: 'reset-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'username', placeholder: 'Nhập số điện thoại', 'aria-describedby': 'reset-phone-error', spellcheck: 'false' });
    phone.value = screen.phone;
    setMessage(error, screen.phoneError);
    phone.setAttribute('aria-invalid', String(screen.phoneError !== undefined));
    const submit = primary(screen.pending ? 'Đang gửi…' : 'Gửi mã OTP');
    submit.disabled = !this.hooks.wired || screen.pending;
    const form = h('form', { class: 'form', novalidate: true }, field('Số điện thoại', 'reset-phone', phone, undefined, error), submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!isValidPhone(phone.value)) {
        setMessage(error, 'Số điện thoại không hợp lệ.');
        phone.setAttribute('aria-invalid', 'true');
        phone.focus();
        return;
      }
      this.hooks.sendCode(phone.value.trim());
    });
    this.#page(
      h(
        'div',
        {},
        ...this.#head('Đặt lại mật khẩu', 'Nhập số điện thoại của tài khoản quản trị để nhận mã OTP.'),
        this.#wiredNotice(),
        form,
        h('p', { class: 'hint hint-block' }, 'Tài khoản SYSTEM khôi phục bằng công cụ trên máy chủ, không dùng trang này. Authenticator của bạn được giữ nguyên.'),
        this.#toLogin(),
      ),
      'Đặt lại mật khẩu',
    );
  }

  #otp(screen: Extract<ResetScreen, { name: 'otp' }>): void {
    const error = message('error', 'reset-code-error');
    const code = codeInput('reset-code', 'reset-code-error');
    setMessage(error, screen.codeError === undefined ? undefined : CODE_ERROR[screen.codeError]);
    code.setAttribute('aria-invalid', String(screen.codeError !== undefined));
    const submit = primary(screen.pending ? 'Đang xác minh…' : 'Xác minh');
    const refresh = (): void => {
      submit.disabled = !this.hooks.wired || screen.pending || !isCompleteCode(code.value);
    };
    code.addEventListener('input', () => {
      const clean = sanitizeCodeInput(code.value);
      if (clean !== code.value) {
        code.value = clean;
      }
      refresh();
    });
    refresh();
    const resend = secondary(screen.resendSec === undefined || screen.resendSec <= 0 ? 'Gửi lại mã' : `Gửi lại mã (${formatCountdown(screen.resendSec)})`);
    resend.disabled = !this.hooks.wired || screen.pending || (screen.resendSec !== undefined && screen.resendSec > 0);
    resend.addEventListener('click', () => this.hooks.resend());
    const form = h('form', { class: 'form', novalidate: true }, field('Mã OTP 6 số', 'reset-code', code, undefined, error), submit, resend);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (isCompleteCode(code.value)) {
        this.hooks.verify(code.value);
      }
    });
    this.#page(h('div', {}, ...this.#head('Xác minh số điện thoại', `Nếu số ${screen.phoneMasked} thuộc một tài khoản, mã OTP sẽ được gửi bằng tin nhắn SMS. Mã có thể đến chậm vài chục giây.`), this.#wiredNotice(), form, this.#toLogin()), 'Xác minh số điện thoại');
  }

  #password(screen: Extract<ResetScreen, { name: 'password' }>): void {
    const error = message('error', 'reset-password-error');
    setMessage(error, screen.error);
    const make = (id: string, label: string, autocomplete: string): { readonly row: HTMLElement; readonly input: HTMLInputElement } => {
      const input = h('input', { id, name: id, type: 'password', autocomplete, 'aria-describedby': 'reset-password-error' });
      const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false', 'aria-controls': id });
      eye.append(eyeIcon(true));
      eye.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        eye.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
        eye.setAttribute('aria-pressed', String(show));
        eye.replaceChildren(eyeIcon(!show));
      });
      return { row: field(label, id, input, eye), input };
    };
    const next = make('reset-password', 'Mật khẩu mới', 'new-password');
    const confirm = make('reset-password-confirm', 'Xác nhận mật khẩu mới', 'new-password');
    const submit = primary(screen.pending ? 'Đang đặt lại…' : 'Đặt lại mật khẩu');
    submit.disabled = !this.hooks.wired || screen.pending;
    const form = h('form', { class: 'form', novalidate: true }, next.row, confirm.row, error, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!isValidPassword(next.input.value)) {
        setMessage(error, ADMIN_COPY.passwordInvalid);
        next.input.focus();
        return;
      }
      if (next.input.value !== confirm.input.value) {
        setMessage(error, ADMIN_COPY.passwordMismatch);
        confirm.input.focus();
        return;
      }
      const value = next.input.value;
      // The fields are emptied as soon as the request has the value.
      next.input.value = '';
      confirm.input.value = '';
      this.hooks.setPassword(value);
    });
    const keep = h('p', { class: 'message message-notice', role: 'note' }, 'Authenticator được giữ nguyên. Bạn không cần thiết lập lại ứng dụng xác thực.');
    this.#page(h('div', {}, ...this.#head('Đặt mật khẩu mới', 'Tạo mật khẩu mới từ 8 đến 128 ký tự.'), keep, this.#wiredNotice(), form, this.#toLogin()), 'Đặt mật khẩu mới');
  }

  #done(): void {
    const go = primary('Về trang đăng nhập', 'button');
    go.addEventListener('click', () => this.hooks.toLogin());
    this.#page(h('div', {}, ...this.#head('Đã xử lý yêu cầu', 'Nếu mã xác minh đúng, mật khẩu đã được đặt lại và mọi phiên cũ đã bị đăng xuất. Hãy đăng nhập bằng mật khẩu mới; tài khoản quản trị vẫn cần mã Authenticator hiện có.'), go), 'Đã đặt lại mật khẩu');
  }
}
