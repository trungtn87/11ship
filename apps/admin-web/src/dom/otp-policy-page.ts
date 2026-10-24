import { fetchTransport } from '../core/api.js';
import { OTP_POLICY_FIELDS, OTP_POLICY_MESSAGE, OtpPolicyApi, OtpPolicyKey, OtpPolicyState, OtpPolicyValues, refusalOf, validateOtpPolicy } from '../core/otp-policy.js';
import { formatDateTimeVn } from './accounts-view.js';
import { h, message, primary, secondary, setMessage } from './dom.js';
import { skeleton, statePanel } from './states.js';

// DOM of "Hệ thống › Tham số hệ thống › SMS & OTP" (issue #117). It draws the server's six limits and sends exactly the edit the person made: no value of its
// own, nothing stored in the browser. SYSTEM edits; any other administrator sees the same numbers read-only (the server refuses a write from them again).
// One Idempotency-Key per intent: an unknown outcome is retried with the same key and body, an edited form is a new intent. Nodes are built with
// createElement/textContent only.

export function otpPolicyPage(root: HTMLElement, csrf: () => string | undefined, onSessionLost: () => void): void {
  const api = new OtpPolicyApi(fetchTransport(window.fetch.bind(window), { base: '/v1' }));
  const body = h('div', { class: 'detail' });
  root.replaceChildren(
    h(
      'section',
      { class: 'content content-narrow', 'aria-labelledby': 'otp-policy-title' },
      h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'otp-policy-title' }, 'SMS & OTP'), h('p', { class: 'lead lead-last' }, 'Giới hạn gửi mã OTP bằng SMS cho đăng ký và quên mật khẩu của 11Food và 11Ship. Giá trị lưu trong cơ sở dữ liệu và có hiệu lực ngay, không cần khởi động lại máy chủ.'))),
      body,
    ),
  );
  let busy = false;
  let intent: { readonly key: string; readonly expectedVersion: number; readonly values: OtpPolicyValues; readonly reason: string } | undefined;

  const showLoading = (): void => body.replaceChildren(skeleton(4));
  const showFailure = (text: string): void => {
    const retry = (): void => void load();
    body.replaceChildren(statePanel({ icon: 'alert', title: 'Chưa tải được giới hạn SMS & OTP', text, tone: 'error', live: 'alert', actions: [{ label: 'Tải lại', onClick: retry }] }));
  };

  const load = async (notice?: string): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    showLoading();
    const result = await api.read();
    busy = false;
    if (!body.isConnected) {
      return;
    }
    if (result.kind === 'ok') {
      intent = undefined;
      draw(result.data, notice);
      return;
    }
    if (result.kind === 'error' && result.status === 401) {
      onSessionLost();
      return;
    }
    showFailure(result.kind === 'error' && result.status === 403 ? 'Phiên không đủ quyền xem tham số hệ thống.' : 'Máy chủ chưa trả lời. Kiểm tra kết nối rồi tải lại.');
  };

  const draw = (state: OtpPolicyState, notice?: string): void => {
    const inputs = new Map<OtpPolicyKey, HTMLInputElement>();
    const locked = !state.editable;
    const rows = OTP_POLICY_FIELDS.map((field) => {
      const bounds = state.bounds[field.key];
      const input = h('input', { type: 'number', inputmode: 'numeric', id: `otp-${field.key}`, class: 'input', min: String(bounds.min), max: String(bounds.max), step: '1', required: true, 'aria-describedby': `otp-${field.key}-help` });
      input.value = String(state.values[field.key]);
      input.disabled = locked;
      input.addEventListener('input', () => {
        intent = undefined; // an edited form is a new intent
        update();
      });
      inputs.set(field.key, input);
      return h(
        'div',
        { class: 'field' },
        h('label', { for: input.id, class: 'label' }, `${field.label} (${field.unit})`),
        h('div', { class: 'input-wrap' }, input),
        h('p', { id: `otp-${field.key}-help`, class: 'hint' }, `${field.help} Cho phép ${bounds.min.toLocaleString('vi-VN')}–${bounds.max.toLocaleString('vi-VN')} ${field.unit}; mặc định ${state.defaults[field.key].toLocaleString('vi-VN')}.`),
      );
    });
    const reason = h('textarea', { id: 'otp-reason', class: 'search-input', rows: '2', maxlength: '500', 'aria-label': 'Lý do thay đổi (không bắt buộc)', placeholder: 'Lý do thay đổi (ghi vào nhật ký)' });
    reason.disabled = locked;
    reason.addEventListener('input', () => {
      intent = undefined;
    });
    const status = message('notice', 'otp-policy-status');
    const problem = message('error', 'otp-policy-problem');
    const save = primary('Lưu', 'submit');
    const cancel = secondary('Hủy thay đổi');
    const defaults = secondary('Điền giá trị mặc định');
    const reload = secondary('Tải lại');

    const draft = (): Record<OtpPolicyKey, number> =>
      Object.fromEntries(OTP_POLICY_FIELDS.map((field) => [field.key, (inputs.get(field.key) as HTMLInputElement).value.trim() === '' ? Number.NaN : Number((inputs.get(field.key) as HTMLInputElement).value)])) as Record<OtpPolicyKey, number>;
    const dirty = (): boolean => {
      const now = draft();
      return OTP_POLICY_FIELDS.some((field) => now[field.key] !== state.values[field.key]);
    };
    function update(): void {
      const changed = dirty();
      save.disabled = locked || busy || !changed;
      cancel.disabled = locked || busy || !changed;
      defaults.disabled = locked || busy;
      const invalid = changed ? validateOtpPolicy(draft(), state.bounds) : undefined;
      setMessage(problem, invalid);
    }

    cancel.addEventListener('click', () => {
      for (const field of OTP_POLICY_FIELDS) {
        (inputs.get(field.key) as HTMLInputElement).value = String(state.values[field.key]);
      }
      intent = undefined;
      setMessage(status, undefined);
      update();
    });
    defaults.addEventListener('click', () => {
      for (const field of OTP_POLICY_FIELDS) {
        (inputs.get(field.key) as HTMLInputElement).value = String(state.defaults[field.key]);
      }
      intent = undefined;
      setMessage(status, 'Đã điền giá trị mặc định. Bấm Lưu để áp dụng.');
      update();
    });
    reload.addEventListener('click', () => void load());

    const form = h('form', { class: 'detail-block', novalidate: true }, ...rows, locked ? undefined : h('div', { class: 'field' }, h('label', { for: 'otp-reason', class: 'label' }, 'Lý do thay đổi'), reason), problem, status, h('div', { class: 'detail-actions' }, reload, defaults, cancel, save));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (busy || locked) {
        return;
      }
      const values = draft();
      const invalid = validateOtpPolicy(values, state.bounds);
      if (invalid !== undefined) {
        setMessage(problem, invalid);
        return;
      }
      const token = csrf();
      if (token === undefined) {
        onSessionLost();
        return;
      }
      intent ??= { key: window.crypto.randomUUID(), expectedVersion: state.version, values, reason: reason.value };
      busy = true;
      update();
      setMessage(problem, undefined);
      setMessage(status, 'Đang lưu…');
      void api.save(token, { expectedVersion: intent.expectedVersion, values: intent.values, reason: intent.reason }, intent.key).then((result) => {
        busy = false;
        if (!form.isConnected) {
          return;
        }
        if (result.kind === 'ok') {
          intent = undefined;
          draw(result.data, OTP_POLICY_MESSAGE.saved);
          return;
        }
        const why = refusalOf(result);
        if (why === 'session') {
          onSessionLost();
          return;
        }
        if (why === 'conflict') {
          intent = undefined;
        }
        setMessage(status, undefined);
        setMessage(problem, OTP_POLICY_MESSAGE[why]);
        update();
      });
    });

    const lastChange = state.history[0];
    body.replaceChildren(
      h(
        'section',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Giới hạn đang áp dụng'),
        h('p', { class: 'hint' }, `Phiên bản ${String(state.version)} · cập nhật ${formatDateTimeVn(state.updatedAt)}.${locked ? ' Bạn chỉ xem được; chỉ tài khoản SYSTEM được sửa.' : ''}`),
        form,
      ),
      h(
        'section',
        { class: 'detail-block' },
        h('h2', { class: 'subtitle' }, 'Lịch sử thay đổi'),
        state.history.length === 0
          ? h('p', { class: 'muted' }, 'Chưa có thay đổi nào. Các giá trị đang là giá trị khởi tạo.')
          : h(
              'ol',
              { class: 'timeline' },
              ...state.history.map((change) => {
                const lines = OTP_POLICY_FIELDS.filter((field) => change.oldValues[field.key] !== change.newValues[field.key]).map((field) => `${field.label}: ${String(change.oldValues[field.key])} → ${String(change.newValues[field.key])} ${field.unit}`);
                return h(
                  'li',
                  { class: 'timeline-item' },
                  h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
                  h('div', {}, h('p', { class: 'timeline-label' }, `Phiên bản ${String(change.version)}`), ...lines.map((line) => h('p', { class: 'hint' }, line)), change.reason === null ? undefined : h('p', { class: 'hint' }, `Lý do: ${change.reason}`), h('p', { class: 'timeline-meta' }, `${formatDateTimeVn(change.changedAt)} · SYSTEM (${change.changedBy.slice(0, 8)})`)),
                );
              }),
            ),
        lastChange === undefined ? undefined : h('p', { class: 'hint' }, 'Mỗi lần lưu cũng được ghi vào Nhật ký với giá trị trước và sau.'),
      ),
    );
    if (notice !== undefined) {
      setMessage(status, notice);
    }
    update();
  };

  void load();
}
