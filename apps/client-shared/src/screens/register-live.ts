import { banner, button, countdownUntil, otpField, setBusy, setButtonLabel, textLink } from '../components.js';
import { formatCountdown, h } from '../dom.js';
import { REGISTER_FLOW, RegisterController, RegisterStepResult } from '../register-flow.js';
import { ScreenEnv } from '../screen.js';
import { FailureCode, STATE_COPY } from '../states.js';
import { isCompleteOtp, maskPhone } from '../validation.js';
import { failureBanner } from './feedback.js';
import { appPage, guardForm } from './layout.js';

// F12 of the real register flow (M01.07): the code step and what follows it. Everything it shows comes from the server's answers
// held by the RegisterController (verification_id, the expiry and "send again" instants the server gave): there is no demo timer.
//
// * "Gửi lại mã" becomes available at the server's instant and not before; it is never pressed by a timer.
// * A wrong code, an expired code and a locked challenge are different messages (states.ts), never the server's text.
// * After the code is right, the account is created by the same press. If that answer is lost or unknown the screen offers
//   "Thử lại", which re-sends the SAME request (same Idempotency-Key, same body, same proof); it never goes back to the code.
// * Leaving the screen (after the usual "Bỏ thay đổi?" question) drops the password, the proof and the code: the controller's cancel().

export interface LiveRegisterOtpOptions {
  /** Screen id of F11 ("Đổi số điện thoại", Back). */
  readonly back: string;
  /** Where a created account goes (F01). */
  readonly onDone: (env: ScreenEnv) => void;
}

export function liveRegisterOtp(env: ScreenEnv, reg: RegisterController, options: LiveRegisterOtpOptions): HTMLElement {
  const first = reg.view();
  const masked = (first === undefined ? undefined : maskPhone(first.phone)) ?? '••• •••• •••';
  const otp = otpField({ id: 'otp', label: 'Mã OTP 6 số' });
  const status = h('p', { class: 'c-caption c-center', 'aria-live': 'off' });
  const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
  const verify = button({ label: 'Xác minh', kind: 'primary', type: 'submit', id: 'otp-submit' });
  const resend = button({ label: STATE_COPY.resendIn(formatCountdown(0)), kind: 'secondary', id: 'otp-resend' });
  resend.setAttribute('aria-disabled', 'true');
  const panel = h('div', { class: 'c-stack', 'aria-live': 'polite', id: 'register-state' });
  panel.hidden = true;

  let working = false;
  let expired = false;
  let stopExpiry: { stop(): void } | undefined;
  let stopResend: { stop(): void } | undefined;
  const stopTimers = (): void => {
    stopExpiry?.stop();
    stopResend?.stop();
    stopExpiry = undefined;
    stopResend = undefined;
  };

  /** (Re)starts both countdowns from the instants the controller holds - the server's, never a number made up here. */
  const startTimers = (): void => {
    stopTimers();
    const view = reg.view();
    if (view === undefined || view.stage !== 'otp') {
      return;
    }
    expired = false;
    stopExpiry = countdownUntil(
      view.challenge.expiresAtMs,
      (remaining) => {
        status.textContent = remaining > 0 ? `Mã OTP có hiệu lực trong ${formatCountdown(remaining)}` : '';
      },
      () => {
        expired = true;
        status.textContent = '';
        feedback.replaceChildren(failureBanner('OTP_EXPIRED'));
      },
    );
    resend.setAttribute('aria-disabled', 'true');
    stopResend = countdownUntil(
      view.challenge.resendAtMs,
      (remaining) => setButtonLabel(resend, remaining > 0 ? STATE_COPY.resendIn(formatCountdown(remaining)) : 'Gửi lại mã'),
      () => resend.removeAttribute('aria-disabled'),
    );
  };

  const setWorking = (on: boolean): void => {
    working = on;
    verify.disabled = on;
    resend.disabled = on;
  };

  // ---- after the code: the account step --------------------------------------------------------------------------
  const showRegisterState = (last?: { readonly code: FailureCode; readonly retryAfterSeconds?: number }): void => {
    const view = reg.view();
    stopTimers();
    status.textContent = '';
    if (view === undefined) {
      return;
    }
    form.hidden = true;
    resendBlock.hidden = true;
    changePhone.hidden = true;
    panel.hidden = false;
    if (view.stage === 'failed') {
      const code = view.failure?.code ?? last?.code ?? 'UNKNOWN';
      const toLogin = code === 'RESULT_NOT_REPLAYABLE' || code === 'PHONE_ALREADY_REGISTERED';
      panel.replaceChildren(
        failureBanner(code),
        ...(toLogin ? [button({ label: 'Đăng nhập', kind: 'primary', id: 'register-to-login', onClick: () => env.go('login') })] : []),
        button({ label: toLogin ? 'Dùng số điện thoại khác' : 'Quay lại đăng ký', kind: toLogin ? 'secondary' : 'primary', id: 'register-back', onClick: () => env.go(options.back) }),
      );
      return;
    }
    const retry = button({ label: 'Thử lại', kind: 'primary', id: 'register-retry' });
    retry.addEventListener('click', () => {
      if (working) {
        return;
      }
      working = true;
      setBusy(retry, true, 'Thử lại', 'Đang xử lý…');
      void reg.retryRegister().then((step) => {
        working = false;
        settle(step);
      });
    });
    panel.replaceChildren(
      banner({ kind: 'info', title: 'Đã xác minh số điện thoại', text: 'Tài khoản chưa tạo xong. "Thử lại" gửi lại đúng yêu cầu đăng ký vừa rồi, không cần nhập lại mã và không tạo thêm tài khoản.' }),
      ...(last === undefined ? [] : [failureBanner(last.code, { retryAfterSeconds: last.retryAfterSeconds })]),
      retry,
    );
  };

  /** What to show after verify / retry answered. */
  const settle = (step: RegisterStepResult): void => {
    if (step.kind === 'stale') {
      return;
    }
    setWorking(false);
    if (step.kind === 'ok') {
      guard.release();
      options.onDone(env);
      return;
    }
    if (step.where === 'register') {
      showRegisterState({ code: step.code, ...(step.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: step.retryAfterSeconds }) });
      return;
    }
    setBusy(verify, false, 'Xác minh', 'Đang xử lý…');
    otp.clear();
    if (step.code === 'OTP_INVALID') {
      otp.setError(STATE_COPY.otpInvalid);
      otp.focus();
      return;
    }
    if (step.code === 'OTP_EXPIRED') {
      expired = true;
    }
    feedback.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds }));
  };

  const run = async (): Promise<void> => {
    if (working) {
      return;
    }
    const value = otp.value();
    if (!isCompleteOtp(value)) {
      otp.setError(STATE_COPY.otpInvalid);
      otp.focus();
      return;
    }
    otp.setError(undefined);
    if (expired) {
      feedback.replaceChildren(failureBanner('OTP_EXPIRED'));
      return;
    }
    feedback.replaceChildren();
    setWorking(true);
    setBusy(verify, true, 'Xác minh', 'Đang xử lý…');
    settle(await reg.verify(value));
  };

  resend.addEventListener('click', () => {
    if (working || resend.getAttribute('aria-disabled') === 'true') {
      return;
    }
    setWorking(true);
    void reg.resend().then((result) => {
      if (result.kind === 'stale') {
        return;
      }
      setWorking(false);
      // Ok: a NEW challenge replaced the old one (new id, new deadlines). Failure: the timers pick up a Retry-After the server gave.
      startTimers();
      if (result.kind === 'ok') {
        otp.clear();
        otp.setError(undefined);
        feedback.replaceChildren();
        otp.focus();
        return;
      }
      feedback.replaceChildren(failureBanner(result.code, { retryAfterSeconds: result.retryAfterSeconds }));
    });
  });

  const form = h('form', { class: 'c-stack', novalidate: true }, otp.root, status, feedback, verify);
  // C08: the typed code is asked about before leaving; a verified phone proof held in memory counts as something to lose too.
  const guard = guardForm(env, form, { flows: [REGISTER_FLOW], extraDirty: () => reg.view()?.stage === 'register', onWipe: () => reg.cancel() });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  const resendBlock = h('div', { class: 'c-stack c-stack--tight c-center' }, h('p', { class: 'c-caption' }, 'Chưa nhận được mã?'), resend);
  const changePhone = h('div', { class: 'c-center' }, textLink('Đổi số điện thoại', () => env.go(options.back)));

  const root = appPage({
    onBack: () => env.go(options.back),
    bodyClass: 'c-stack c-stack--loose',
    body: [
      h('div', { class: 'c-stack c-stack--tight c-center' }, h('h1', { class: 'c-title' }, 'Xác minh mã OTP'), h('p', { class: 'c-lead' }, 'Chúng tôi đã gửi mã OTP đến số điện thoại'), h('p', { class: 'c-h2' }, masked)),
      env.testSmsNotice
        ? banner({ kind: 'test', title: 'SMS mô phỏng — môi trường thử', text: 'Mã không gửi tin nhắn thật và không hiện trên màn hình này. Lấy mã bằng công cụ trên máy tính.' })
        : undefined,
      form,
      panel,
      resendBlock,
      changePhone,
    ],
  });
  startTimers();
  return root;
}
