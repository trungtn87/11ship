import { button, banner, setBusy, textField } from '../components.js';
import { h } from '../dom.js';
import { ScreenEnv } from '../screen.js';
import { failureBanner } from './feedback.js';
import { STATE_COPY } from '../states.js';
import { normalizePersonName } from '../validation.js';

// The own personal profile (F17 / S05 profile row) connected to the server: GET and PUT /v1/customer/me/profile through
// env.auth. Shared by 11Food and 11Ship so both show the same behaviour:
//   * the name and the version come from the server's answer; the typed name is sent with expected_version;
//   * a save whose outcome is unknown keeps its Idempotency-Key and body (the adapter does that): "Thử lại" re-sends the SAME request;
//   * VERSION_CONFLICT never overwrites: the screen offers the current profile and the person decides again;
//   * after a save, the name shown everywhere comes from the server's result (the session identity is updated by the adapter);
//   * leaving with an unsaved name asks first (C08); a session the server calls invalid ends in app.ts (login screen).

export interface LiveProfile {
  readonly form: HTMLFormElement;
}

export function liveProfileForm(env: ScreenEnv): LiveProfile {
  const auth = env.auth;
  const me = env.account;
  const name = textField({ id: 'full-name', label: 'Họ và tên', icon: 'user', autocomplete: 'name', value: me?.fullName ?? '', maxLength: 120 });
  const phone = textField({ id: 'phone', label: 'Số điện thoại đăng nhập', icon: 'phone', value: me?.phoneMasked ?? '', readOnly: true, hint: 'Không đổi được ở đây.' });
  const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
  const save = button({ label: 'Lưu thay đổi', kind: 'primary', type: 'submit', id: 'profile-save' });
  const form = h('form', { class: 'c-stack', novalidate: true }, name.root, phone.root, feedback, save);

  // What the server last said (null until the first answer). The form is locked until there is a version to name.
  let version: number | undefined;
  let baseline = me?.fullName ?? '';
  let busy = false;
  save.disabled = true;

  const lock = (on: boolean): void => {
    save.disabled = on || version === undefined;
  };

  const adopt = (fullName: string, next: number): void => {
    baseline = fullName;
    name.input.value = fullName;
    name.setError(undefined);
    version = next;
  };

  const load = async (note?: string): Promise<void> => {
    if (auth === undefined || busy) {
      return;
    }
    busy = true;
    lock(true);
    feedback.replaceChildren(banner({ kind: 'info', text: STATE_COPY.loading }));
    const answer = await auth.readProfile();
    busy = false;
    if (answer.kind === 'stale') {
      return;
    }
    if (answer.kind === 'failure') {
      feedback.replaceChildren(failureBanner(answer.code, { retryAfterSeconds: answer.retryAfterSeconds, onRetry: () => void load() }));
      return;
    }
    if (answer.value === null) {
      feedback.replaceChildren(banner({ kind: 'warn', title: 'Chưa có hồ sơ cá nhân', text: 'Máy chủ chưa có hồ sơ cho tài khoản này nên chưa thể sửa tên ở đây.' }));
      return;
    }
    adopt(answer.value.fullName, answer.value.version);
    feedback.replaceChildren(...(note === undefined ? [] : [banner({ kind: 'info', text: note })]));
    lock(false);
  };

  const run = async (): Promise<void> => {
    if (auth === undefined || busy || version === undefined) {
      return;
    }
    const normalized = normalizePersonName(name.input.value);
    if (normalized === undefined) {
      name.setError(STATE_COPY.nameInvalid);
      name.input.focus();
      return;
    }
    name.setError(undefined);
    const typed = name.input.value;
    busy = true;
    lock(true);
    feedback.replaceChildren();
    setBusy(save, true, 'Lưu thay đổi', 'Đang gửi…');
    const answer = await auth.saveProfile({ fullName: typed, expectedVersion: version });
    busy = false;
    setBusy(save, false, 'Lưu thay đổi', 'Đang gửi…');
    lock(false);
    if (answer.kind === 'stale') {
      return;
    }
    if (answer.kind === 'ok') {
      adopt(answer.value.fullName, answer.value.version);
      feedback.replaceChildren(banner({ kind: 'success', title: 'Đã lưu', text: 'Họ tên đã được cập nhật.' }));
      return;
    }
    if (answer.code === 'VERSION_CONFLICT') {
      // Nothing was overwritten. The person sees the current profile and decides whether to enter the change again.
      feedback.replaceChildren(
        failureBanner('VERSION_CONFLICT', {
          onRetry: () => {
            void load(`Bạn đã nhập: "${normalized}". Đây là thông tin hiện tại; sửa lại rồi lưu nếu bạn vẫn muốn đổi.`);
          },
        }),
      );
      return;
    }
    // An unknown outcome offers "Thử lại": the same name and version re-send the SAME request (same key and body).
    feedback.replaceChildren(failureBanner(answer.code, { retryAfterSeconds: answer.retryAfterSeconds, ...(answer.unresolved ? { onRetry: () => void run() } : {}) }));
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  // C08: an unsaved name is asked about before leaving, and put back when the person really leaves.
  env.guard({
    dirty: () => name.input.value !== baseline,
    wipe: () => {
      name.input.value = baseline;
    },
  });
  void load();
  return { form };
}
