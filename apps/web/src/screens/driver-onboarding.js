import { describeDriver } from '../core/projection.js';
import { validateDriver } from '../core/validation.js';
import { Alert, Badge, Button, Card, Field, Heading, setButtonLoading } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { failureAlert, focusFirstInvalid, replaceContent } from './shared.js';

const OP_CREATE = 'driver.create';

export function renderDriverOnboarding(ctx) {
  const host = h('div', { class: 'stack' });
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Hồ sơ Xế' }),
      h('p', { class: 'lead' }, 'Khai báo họ tên (và biển số nếu có). Hồ sơ sẽ chờ đội vận hành duyệt.'),
      host,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => ctx.route() }, 'Quay lại')),
    ],
  });
  let lastBody = null;

  function showStatus(message) {
    const status = describeDriver(ctx.state.me);
    replaceContent(
      host,
      message ? Alert({ tone: 'success', title: message.title, message: message.text }) : null,
      h('dl', { class: 'facts' }, h('dt', null, 'Trạng thái hồ sơ xế'), h('dd', null, Badge({ tone: status.tone, label: status.label }))),
      ctx.state.me.driver === 'PENDING_APPROVAL'
        ? Alert({ tone: 'warning', message: 'Hồ sơ đang chờ vận hành duyệt. Bạn chưa nhận đơn được cho tới khi được duyệt.' })
        : null,
      Button({ label: 'Tiếp tục', onClick: () => ctx.route() }),
    );
    if (message) ctx.announce(message.title);
  }

  function showForm() {
    const fullName = Field({ label: 'Họ và tên', required: true, inputAttrs: { name: 'full_name', autocomplete: 'name', maxlength: '240' } });
    const plate = Field({ label: 'Biển số xe', help: 'Có thể bổ sung sau.', inputAttrs: { name: 'plate_number', autocapitalize: 'characters', autocomplete: 'off', maxlength: '64' } });
    const alertHost = h('div', { class: 'form-alert' });
    const submit = Button({ label: 'Gửi hồ sơ xế', type: 'submit', block: true });
    const fieldset = h('fieldset', { class: 'fieldset' }, fullName.root, plate.root);
    let busy = false;
    let unknown = false;

    function showUnknown() {
      unknown = true;
      fieldset.disabled = true;
      replaceContent(
        alertHost,
        Alert({
          tone: 'warning',
          title: 'Chưa biết hồ sơ đã được gửi hay chưa',
          message: 'Kết nối bị gián đoạn nên chưa nhận được phản hồi. Bấm Thử lại để gửi lại đúng nội dung cũ (an toàn, không tạo hai hồ sơ), hoặc kiểm tra lại từ máy chủ.',
          actions: [
            Button({ label: 'Thử lại (giữ nguyên nội dung)', onClick: () => send(lastBody) }),
            Button({
              label: 'Kiểm tra lại từ máy chủ',
              variant: 'secondary',
              onClick: async () => {
                ctx.mutations.discard(OP_CREATE);
                const fresh = await ctx.refreshMe();
                if (fresh.stale || fresh.handled) return;
                if (fresh.ok && fresh.me.driver !== 'NOT_STARTED') {
                  showStatus({ title: 'Hồ sơ xế đã được gửi', text: 'Máy chủ đã có hồ sơ xế của bạn.' });
                } else {
                  unknown = false;
                  fieldset.disabled = false;
                  replaceContent(alertHost, Alert({ tone: 'info', message: 'Chưa có hồ sơ xế trên máy chủ. Bạn có thể gửi lại.' }));
                }
              },
            }),
          ],
        }),
      );
    }

    async function send(body) {
      lastBody = body;
      unknown = false;
      replaceContent(alertHost);
      busy = true;
      fieldset.disabled = true;
      setButtonLoading(submit, true, 'Gửi hồ sơ xế', 'Đang gửi…');
      const result = await ctx.mutations.submit(OP_CREATE, { method: 'POST', path: '/onboarding/driver', body, userId: ctx.state.me.userId });
      setButtonLoading(submit, false, 'Gửi hồ sơ xế');
      busy = false;
      fieldset.disabled = false;
      if (result.stale) return;
      if (result.ok) {
        lastBody = null;
        const fresh = await ctx.refreshMe();
        if (fresh.stale || fresh.handled) return;
        showStatus({ title: 'Đã gửi hồ sơ xế', text: 'Hồ sơ đang chờ vận hành duyệt.' });
        return;
      }
      if (result.kind === 'local') {
        if (result.code === 'UNKNOWN_BODY_CHANGED') showUnknown();
        return;
      }
      if (ctx.handleFailure(result) !== null) return;
      if (ctx.mutations.hasUnknown(OP_CREATE)) {
        showUnknown();
        return;
      }
      if (result.kind === 'http' && result.code === 'DRIVER_PROFILE_EXISTS') {
        const fresh = await ctx.refreshMe();
        if (fresh.ok) showStatus(null);
        return;
      }
      replaceContent(alertHost, failureAlert(result));
    }

    const form = h(
      'form',
      {
        class: 'form',
        novalidate: true,
        onSubmit: (event) => {
          event.preventDefault();
          if (busy || unknown) return;
          fullName.setError(null);
          plate.setError(null);
          const checked = validateDriver({ full_name: fullName.input.value, plate_number: plate.input.value });
          if (checked.value === undefined) {
            fullName.setError(checked.errors.full_name);
            plate.setError(checked.errors.plate_number);
            focusFirstInvalid([fullName, plate]);
            return;
          }
          send(checked.value);
        },
      },
      fieldset,
      alertHost,
      submit,
    );
    replaceContent(host, h('p', { class: 'help' }, 'Chưa chọn khu vực hoạt động ở bước này. Bạn chưa nhận đơn được cho tới khi hồ sơ được duyệt.'), form);
  }

  async function start() {
    const fresh = await ctx.refreshMe();
    if (fresh.stale || fresh.handled || ctx.signal.aborted) return;
    if (!fresh.ok) {
      replaceContent(host, failureAlert(fresh.result ?? { kind: 'invalid_response' }, { actions: Button({ label: 'Thử lại', variant: 'secondary', onClick: start }) }));
      return;
    }
    if (fresh.me.driver === 'NOT_STARTED') showForm();
    else showStatus(null);
  }

  host.append(h('p', { class: 'help' }, 'Đang kiểm tra hồ sơ…'));
  start();
  return { title: 'Hồ sơ Xế', el, layout: 'app' };
}
