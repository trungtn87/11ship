import { banner, button, passwordField, setBusy, textField, textLink } from '../components.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { RecoveryController } from '../recovery-flow.js';
import { ScreenEnv } from '../screen.js';
import { STATE_COPY } from '../states.js';
import { isValidPassword, isValidPhone } from '../validation.js';
import { failureBanner } from './feedback.js';
import { appPage, guardForm } from './layout.js';

// F13 / S15 of the real no-OTP test password reset (M01-RESET, Owner decision 2026-10-13): ONE form - phone, new password,
// confirmation - and no code step (F14/F15 and S16/S17 are never opened). The server's mode (GET /v1/account-recovery/config)
// decides: until a valid answer arrives, and whenever it is not DISABLED_TEST, the submit stays locked. The confirmation is checked
// here only and is never sent. The answer is the same for every phone, so the screen says only that the request was processed.

export const RESET_TEST_NOTICE = 'Bản test: đặt lại mật khẩu chưa yêu cầu OTP';
export const RESET_ACK_COPY = 'Yêu cầu đã xử lý. Hãy đăng nhập bằng mật khẩu mới nếu tài khoản thuộc phạm vi bản test.';
export const RESET_UNAVAILABLE_COPY = 'Đặt lại mật khẩu chưa khả dụng trong phiên bản này.';

export function liveResetScreen(env: ScreenEnv, recovery: RecoveryController): HTMLElement {
  const phone = textField({ id: 'phone', label: 'Số điện thoại', icon: 'phone', type: 'tel', inputMode: 'tel', autocomplete: 'username', placeholder: 'Nhập số điện thoại' });
  const next = passwordField({ id: 'new-password', label: 'Mật khẩu mới', autocomplete: 'new-password', placeholder: 'Nhập mật khẩu mới', hint: '8 đến 128 ký tự.' });
  const confirm = passwordField({ id: 'new-password-confirm', label: 'Nhập lại mật khẩu mới', autocomplete: 'new-password', placeholder: 'Nhập lại mật khẩu mới' });
  const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
  const modeStatus = h('p', { class: 'c-caption', id: 'reset-mode-status', 'aria-live': 'polite' });
  const modeNote = h('p', { class: 'c-hint', id: 'reset-mode-note' }, RESET_TEST_NOTICE);
  modeNote.hidden = true;
  const submit = button({ label: 'Đặt lại mật khẩu', kind: 'primary', type: 'submit', id: 'reset-submit' });
  submit.disabled = true;

  const validate = (): boolean => {
    const phoneOk = isValidPhone(phone.input.value);
    const ruleOk = isValidPassword(next.input.value);
    const matches = confirm.input.value === next.input.value && confirm.input.value !== '';
    phone.setError(phoneOk ? undefined : STATE_COPY.invalidPhone);
    next.setError(ruleOk ? undefined : STATE_COPY.passwordRule);
    confirm.setError(matches ? undefined : STATE_COPY.passwordMismatch);
    const first: HTMLInputElement | undefined = !phoneOk ? phone.input : !ruleOk ? next.input : !matches ? confirm.input : undefined;
    first?.focus();
    return first === undefined;
  };

  let submitting = false;
  const done = h('div', { class: 'c-empty', id: 'reset-done' });
  done.hidden = true;
  const run = async (): Promise<void> => {
    if (submitting || recovery.mode() !== 'DISABLED_TEST' || !validate()) {
      return;
    }
    submitting = true;
    feedback.replaceChildren();
    setBusy(submit, true, 'Đặt lại mật khẩu', 'Đang xử lý…');
    const step = await recovery.reset({ phone: phone.input.value.trim(), password: next.input.value });
    submitting = false;
    if (step.kind === 'stale') {
      return;
    }
    setBusy(submit, false, 'Đặt lại mật khẩu', 'Đang xử lý…');
    if (step.kind === 'ok') {
      next.input.value = '';
      confirm.input.value = '';
      phone.input.value = '';
      guard.release();
      form.hidden = true;
      done.hidden = false;
      done.replaceChildren(
        h('span', { class: 'c-empty__icon c-empty__icon--success' }, icon('checkCircle', 36)),
        h('h1', { class: 'c-title' }, 'Đã xử lý yêu cầu'),
        h('p', { class: 'c-lead', id: 'reset-ack' }, RESET_ACK_COPY),
        button({ label: 'Đăng nhập', kind: 'primary', id: 'reset-to-login', onClick: () => env.go('login') }),
      );
      return;
    }
    // An unknown answer keeps the key and body: pressing the button again re-sends the SAME request.
    feedback.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, ...(step.unresolved ? { onRetry: () => void run() } : {}) }));
  };

  const form = h('form', { class: 'c-stack', novalidate: true }, phone.root, next.root, confirm.root, modeStatus, modeNote, banner({ kind: 'warn', text: 'Sau khi đặt lại mật khẩu, tất cả các phiên đăng nhập trên thiết bị khác sẽ bị đăng xuất.' }), feedback, submit);
  // Leaving drops the typed password and what the controller kept (key + body), and makes an answer on its way stale.
  const guard = guardForm(env, form, { onWipe: () => recovery.cancel() });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  const live = (field: typeof phone, rule: () => string | undefined): void => {
    field.input.addEventListener('blur', () => field.setError(field.input.value === '' ? undefined : rule()));
    field.input.addEventListener('input', () => {
      if (field.error() !== undefined) {
        field.setError(rule());
      }
    });
  };
  live(phone, () => (isValidPhone(phone.input.value) ? undefined : STATE_COPY.invalidPhone));
  live(next, () => (isValidPassword(next.input.value) ? undefined : STATE_COPY.passwordRule));
  live(confirm, () => (confirm.input.value === next.input.value ? undefined : STATE_COPY.passwordMismatch));

  // The server's mode decides; locked until a valid answer. A failed answer shows the error with "Thử lại" and keeps the form locked.
  const applyMode = (): void => {
    submit.disabled = true;
    modeNote.hidden = true;
    modeStatus.textContent = 'Đang kiểm tra cấu hình…';
    void recovery.loadMode().then((result) => {
      if (result.kind === 'stale') {
        return;
      }
      modeStatus.textContent = '';
      if (result.kind === 'failure') {
        feedback.replaceChildren(failureBanner(result.code, { onRetry: () => { feedback.replaceChildren(); applyMode(); } }));
        return;
      }
      feedback.replaceChildren();
      if (result.value === 'DISABLED_TEST') {
        modeNote.hidden = false;
        submit.disabled = false;
        return;
      }
      feedback.replaceChildren(banner({ kind: 'info', title: 'Chưa khả dụng', text: RESET_UNAVAILABLE_COPY }));
    });
  };
  applyMode();

  return appPage({
    onBack: () => env.go('login'),
    bodyClass: 'c-stack c-stack--loose',
    body: [
      h('div', { class: 'c-stack c-stack--tight c-center' }, h('span', { class: 'c-empty__icon c-self-center' }, icon('key', 32)), h('h1', { class: 'c-title' }, 'Quên mật khẩu?'), h('p', { class: 'c-lead' }, 'Nhập số điện thoại và mật khẩu mới cho tài khoản của bạn.')),
      form,
      done,
      h('div', { class: 'c-center' }, textLink('Quay lại đăng nhập', () => env.go('login'), '/login')),
    ],
  });
}
