import { DriverView } from '../auth/client.js';
import { banner, button, reasonNote, setBusy, textField } from '../components.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { ScreenEnv } from '../screen.js';
import { STATE_COPY } from '../states.js';
import { normalizePersonName, normalizePlate } from '../validation.js';
import { failureBanner } from './feedback.js';
import { guardForm } from './layout.js';

// S12 / S13 of 11Ship connected to the server through env.driver (driver-flow.ts). The screens only DISPLAY what the server holds and
// send intents; the design-preview versions stay in apps/ship-web/src/screens.ts. Nothing here says "sent" or "approved" unless the
// server's answer says so, there is no edit/save button (the backend has no update API), and no reason, balance or order is invented.

const loadingBanner = (): HTMLElement => banner({ kind: 'info', text: STATE_COPY.loading });

/** What the server's status means for the person. Only the stored enum is read: no reason or review detail exists in M01. */
const STATUS_COPY: Readonly<Record<DriverView['status'], { readonly title: string; readonly text: string; readonly icon: 'clock' | 'check' | 'alert' }>> = {
  PENDING: { title: 'Hồ sơ đang chờ duyệt', text: 'Chờ duyệt chưa thể nhận đơn. Chúng tôi sẽ cập nhật khi hồ sơ được xem xét.', icon: 'clock' },
  ACTIVE: { title: 'Hồ sơ đã được duyệt', text: 'Nhận đơn chưa mở ở phiên bản này, nên công tắc nhận đơn vẫn khóa.', icon: 'check' },
  SUSPENDED: { title: 'Hồ sơ đang bị tạm khóa', text: 'Bạn chưa thể nhận đơn. Hiện chưa có thông tin lý do trong ứng dụng.', icon: 'alert' },
  CLOSING: { title: 'Hồ sơ đang được đóng', text: 'Bạn chưa thể nhận đơn. Hiện chưa có thông tin chi tiết trong ứng dụng.', icon: 'alert' },
  CLOSED: { title: 'Hồ sơ đã đóng', text: 'Bạn không thể nhận đơn với hồ sơ này. Hiện chưa có thông tin lý do trong ứng dụng.', icon: 'alert' },
};

/** The profile card of S13: the server's stored values (name as the driver typed it, plate or "Chưa bổ sung", the type). */
export function driverStatusBody(profile: DriverView): HTMLElement[] {
  const copy = STATUS_COPY[profile.status];
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ['Họ tên', profile.fullName, 'driver-name'],
    ['Biển số', profile.plateNumber ?? 'Chưa bổ sung', 'driver-plate'],
    ['Loại shipper', profile.driverType === 'PLATFORM' ? 'Shipper hệ thống' : 'Shipper ngoài', 'driver-type'],
  ];
  return [
    h('section', { class: 'c-card c-stack c-stack--tight', id: 'driver-status-card', 'data-status': profile.status }, h('div', { class: 'c-row-flex' }, icon(copy.icon, 24), h('p', { class: 'c-title c-title--sm', id: 'driver-status-title' }, copy.title)), h('p', { class: 'c-lead' }, copy.text)),
    h('dl', { class: 'c-card' }, ...rows.map(([k, val, id]) => h('div', { class: 'c-kv' }, h('dt', {}, k), h('dd', { id }, val)))),
    reasonNote('Chưa có thông tin lý do hay yêu cầu bổ sung từ phía xét duyệt.'),
  ];
}

/** S12: the form. A person who already has a profile is taken to S13 (it is read, never created again). */
export function liveDriverForm(env: ScreenEnv): HTMLElement {
  const driver = env.driver;
  const name = textField({ id: 'legal-name', label: 'Họ tên theo giấy tờ', icon: 'user', autocomplete: 'name', maxLength: 120, placeholder: 'Họ và tên đầy đủ' });
  const plate = textField({ id: 'plate', label: 'Biển số xe', optional: true, icon: 'truck', maxLength: 32, placeholder: 'Có thể bổ sung sau' });
  const feedback = h('div', { class: 'c-stack', 'aria-live': 'polite' });
  const submit = button({ label: 'Gửi hồ sơ', kind: 'primary', type: 'submit', id: 'driver-submit' });
  const form = h('form', { class: 'c-stack', novalidate: true }, name.root, plate.root, feedback, submit);
  // C08: a driver profile being typed is asked about before leaving; the form starts empty (the customer name is never copied in).
  let alive = true;
  const guard = guardForm(env, form, {
    onWipe: () => {
      alive = false;
    },
  });
  let busy = false;
  // The form can be sent only once the server has said there is no profile yet.
  let ready = false;
  const lock = (): void => {
    submit.disabled = busy || !ready;
  };
  lock();

  const load = async (): Promise<void> => {
    if (driver === undefined || busy) {
      return;
    }
    busy = true;
    lock();
    feedback.replaceChildren(loadingBanner());
    const step = await driver.load({ force: true });
    busy = false;
    if (!alive || step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      feedback.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, onRetry: () => void load() }));
      lock();
      return;
    }
    if (driver.state().profile !== null) {
      guard.release();
      env.go('driver-status');
      return;
    }
    ready = true;
    feedback.replaceChildren();
    lock();
  };

  const check = (): { readonly fullName: string; readonly plate: string | null } | undefined => {
    const fullName = normalizePersonName(name.input.value);
    const plateResult = normalizePlate(plate.input.value);
    name.setError(fullName === undefined ? STATE_COPY.nameInvalid : undefined);
    plate.setError(plateResult.ok ? undefined : 'Biển số chưa hợp lệ (tối đa 32 ký tự).');
    if (fullName === undefined) {
      name.input.focus();
      return undefined;
    }
    if (!plateResult.ok) {
      plate.input.focus();
      return undefined;
    }
    return { fullName, plate: plateResult.value };
  };

  const run = async (): Promise<void> => {
    if (driver === undefined || busy || !ready) {
      return;
    }
    const typed = check();
    if (typed === undefined) {
      return;
    }
    busy = true;
    lock();
    feedback.replaceChildren();
    setBusy(submit, true, 'Gửi hồ sơ', 'Đang gửi…');
    const step = await driver.submit({ fullName: typed.fullName, plateNumber: typed.plate });
    busy = false;
    if (!alive || step.kind === 'stale') {
      return;
    }
    setBusy(submit, false, 'Gửi hồ sơ', 'Đang gửi…');
    lock();
    if (step.kind === 'ok') {
      guard.release();
      env.go('driver-status');
      return;
    }
    if (step.code === 'DRIVER_EXISTS') {
      // Another tab or device got there first: the profile was read, so S13 shows it. Nothing is created twice.
      if (driver.state().profile !== null) {
        guard.release();
        env.go('driver-status');
        return;
      }
      ready = false;
      feedback.replaceChildren(failureBanner('DRIVER_EXISTS', { onRetry: () => void load() }));
      lock();
      return;
    }
    // An unknown outcome offers "Thử lại": the same name and plate re-send the SAME request (same key and body). Never automatic.
    feedback.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, ...(step.unresolved ? { onRetry: () => void run() } : {}) }));
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void run();
  });
  void load();
  return form;
}

/** S13: what the server holds. It reads again every time it opens; "Tải lại" asks again. */
export function liveDriverStatus(env: ScreenEnv): HTMLElement {
  const driver = env.driver;
  const host = h('div', { class: 'c-stack', 'aria-live': 'polite' });
  let alive = true;
  env.guard({
    dirty: () => false,
    wipe: () => {
      alive = false;
    },
  });
  let running = false;
  const load = async (): Promise<void> => {
    if (driver === undefined || running) {
      return;
    }
    running = true;
    host.replaceChildren(loadingBanner());
    const step = await driver.load({ force: true });
    running = false;
    if (!alive || step.kind === 'stale') {
      return;
    }
    if (step.kind === 'failure') {
      host.replaceChildren(failureBanner(step.code, { retryAfterSeconds: step.retryAfterSeconds, onRetry: () => void load() }));
      return;
    }
    const profile = driver.state().profile;
    if (profile === null) {
      host.replaceChildren(
        banner({ kind: 'warn', title: 'Chưa gửi hồ sơ shipper', text: 'Máy chủ chưa có hồ sơ shipper của tài khoản này.', action: { label: 'Gửi hồ sơ', onClick: () => env.go('driver-onboarding') } }),
      );
      return;
    }
    host.replaceChildren(...driverStatusBody(profile), button({ label: 'Tải lại', kind: 'secondary', id: 'driver-reload', onClick: () => void load() }));
  };
  void load();
  return host;
}
