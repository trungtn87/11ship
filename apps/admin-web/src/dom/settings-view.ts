import { SettingChange, SETTING_LABEL, SettingsDraft, SettingsScreen, SETTINGS_MESSAGE } from '../core/settings.js';
import { h, message, primary, secondary, setMessage } from './dom.js';
import { formatDateTimeVn } from './accounts-view.js';
import { notWiredPanel, failurePanel, skeleton } from './states.js';

// DOM of "Cài đặt hệ thống" (Owner decision 2026-10-14). It draws the model of core/settings.ts and nothing else: no value of its own, no
// request, nothing stored. The two switches only edit a DRAFT; "Lưu" sends it, "Hủy" goes back to what the server last said. Every node is
// created with createElement/textContent (no innerHTML).

export interface SettingsHooks {
  readonly wired: boolean;
  /** A switch changed in the draft (no request). */
  change(draft: SettingsDraft): void;
  save(): void;
  cancel(): void;
  /** After "unknown outcome": read the current values; the unanswered save is NOT sent again by itself. */
  recheck(): void;
  /** After "unknown outcome": ask again with the SAME key and body. */
  retry(): void;
  /** After a version conflict: load the settings again. */
  reload(): void;
  login(): void;
  home(): void;
}

const ROWS = [
  {
    id: 'otp-registration',
    key: 'otpRegistrationEnabled' as const,
    title: SETTING_LABEL.otp_registration_enabled,
    on: 'Bật: người dùng bắt buộc xác minh số điện thoại bằng mã OTP khi đăng ký.',
    off: 'Tắt: cho phép đăng ký không cần OTP; số điện thoại được đánh dấu là chưa xác minh.',
  },
  {
    id: 'otp-reset',
    key: 'otpPasswordResetEnabled' as const,
    title: SETTING_LABEL.otp_password_reset_enabled,
    on: 'Bật: phải xác minh OTP trước khi đặt lại mật khẩu.',
    off: 'Tắt: người dùng không thể tự đặt lại mật khẩu (không có đường bỏ qua xác thực). Việc khôi phục tài khoản bị khóa vẫn luôn cần OTP.',
  },
] as const;

const onOff = (value: boolean): string => (value ? 'Bật' : 'Tắt');

function historyRow(change: SettingChange): HTMLElement {
  return h(
    'li',
    { class: 'timeline-item' },
    h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
    h(
      'div',
      {},
      h('p', { class: 'timeline-label' }, `${SETTING_LABEL[change.key]}: ${onOff(change.oldValue)} → ${onOff(change.newValue)}`),
      h('p', { class: 'timeline-meta' }, `${formatDateTimeVn(change.changedAt)} · Người thực hiện: SYSTEM (${change.changedBy.slice(0, 8)})`),
    ),
  );
}

export class SettingsView {
  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: SettingsHooks,
  ) {}

  render(screen: SettingsScreen): void {
    const head = h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'settings-title' }, 'Cài đặt hệ thống'), h('p', { class: 'lead lead-last' }, 'Thiết lập áp dụng cho toàn hệ thống. Chỉ tài khoản SYSTEM được xem và sửa.')));
    let body: HTMLElement;
    const state = screen.state;
    switch (state.kind) {
      case 'not-wired':
        body = notWiredPanel(state.reason);
        break;
      case 'loading':
        body = skeleton(3);
        break;
      case 'failed':
        body = failurePanel(state.failure, { retry: () => this.hooks.reload(), login: () => this.hooks.login(), home: () => this.hooks.home() }, state.retryAfterSec);
        break;
      case 'ready':
        body = this.#form(screen);
        break;
    }
    this.root.replaceChildren(h('section', { class: 'content content-narrow', 'aria-labelledby': 'settings-title' }, head, body));
  }

  #form(screen: SettingsScreen): HTMLElement {
    if (screen.state.kind !== 'ready') {
      return h('div');
    }
    const saved = screen.state.settings;
    const draft: SettingsDraft = screen.draft ?? { otpRegistrationEnabled: saved.otpRegistrationEnabled, otpPasswordResetEnabled: saved.otpPasswordResetEnabled };
    const working = screen.phase === 'working';
    const finished = screen.phase === 'unknown' || screen.phase === 'conflict';
    const dirty = draft.otpRegistrationEnabled !== saved.otpRegistrationEnabled || draft.otpPasswordResetEnabled !== saved.otpPasswordResetEnabled;

    const rows = ROWS.map((row) => {
      const box = h('input', { type: 'checkbox', id: `setting-${row.id}`, role: 'switch', class: 'switch-input', 'aria-describedby': `setting-${row.id}-help` });
      box.checked = draft[row.key];
      box.disabled = !this.hooks.wired || working || finished;
      box.addEventListener('change', () => this.hooks.change({ ...draft, [row.key]: box.checked }));
      return h(
        'div',
        { class: 'setting-row' },
        h('div', { class: 'setting-text' }, h('label', { for: `setting-${row.id}`, class: 'setting-title' }, row.title), h('p', { id: `setting-${row.id}-help`, class: 'hint' }, draft[row.key] ? row.on : row.off)),
        h('div', { class: 'setting-state' }, h('span', { class: 'setting-value' }, onOff(draft[row.key])), box),
      );
    });

    const status = message(screen.phase === 'unknown' || screen.phase === 'conflict' ? 'warning' : screen.phase === 'saved' ? 'notice' : 'error', 'settings-status');
    const cancel = secondary('Hủy');
    cancel.disabled = !dirty || working || finished;
    cancel.addEventListener('click', () => this.hooks.cancel());
    const extra: HTMLElement[] = [];
    let save: HTMLButtonElement;
    if (screen.phase === 'unknown') {
      save = primary('Thử lại', 'button');
      save.addEventListener('click', () => this.hooks.retry());
      const recheck = secondary('Kiểm tra lại giá trị');
      recheck.addEventListener('click', () => this.hooks.recheck());
      extra.push(recheck);
      setMessage(status, SETTINGS_MESSAGE.unknown);
    } else if (screen.phase === 'conflict') {
      save = primary('Tải lại', 'button');
      save.addEventListener('click', () => this.hooks.reload());
      setMessage(status, SETTINGS_MESSAGE.conflict);
    } else {
      save = primary(working ? 'Đang lưu…' : 'Lưu', 'button');
      save.disabled = !this.hooks.wired || !dirty || working;
      save.setAttribute('aria-busy', String(working));
      save.addEventListener('click', () => this.hooks.save());
      if (screen.phase === 'failed') {
        setMessage(status, screen.error ?? 'Chưa thể lưu. Vui lòng thử lại.');
      } else if (screen.phase === 'saved') {
        setMessage(status, 'Đã lưu. Thay đổi có hiệu lực ngay, không cần khởi động lại máy chủ.');
      }
    }

    const history =
      saved.history.length === 0
        ? h('p', { class: 'muted' }, 'Chưa có thay đổi nào được ghi lại. Cả hai công tắc đang ở giá trị mặc định (Bật).')
        : h('ol', { class: 'timeline' }, ...saved.history.map(historyRow));

    return h(
      'div',
      { class: 'detail' },
      h(
        'section',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Xác thực số điện thoại'),
        h('p', { class: 'hint' }, 'Hai công tắc độc lập. Đăng nhập thông thường không dùng OTP. Không ảnh hưởng xác thực hai bước của SYSTEM/ADMIN và không tắt SMS Gateway. Khôi phục tài khoản đã khóa luôn bắt buộc OTP, dù công tắc nào đang tắt.'),
        ...rows,
        status,
        h('div', { class: 'detail-actions' }, cancel, ...extra, save),
      ),
      h('section', { class: 'detail-block' }, h('h2', { class: 'subtitle' }, 'Lịch sử thay đổi'), history),
    );
  }
}
