import { describeFailure } from '../api/errors.js';
import { validateLogin } from '../core/validation.js';
import { Alert, Button, Card, Field, Heading, PasswordField, setButtonLoading } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { failureAlert, focusFirstInvalid, replaceContent } from './shared.js';

export function renderLogin(ctx) {
  const phone = Field({
    label: 'Số điện thoại',
    required: true,
    help: 'Ví dụ 0912345678',
    inputAttrs: { type: 'tel', inputmode: 'tel', autocomplete: 'username', name: 'phone', autocapitalize: 'none', maxlength: '24' },
  });
  const password = PasswordField({});
  const alertHost = h('div', { class: 'form-alert' });
  const submit = Button({ label: 'Đăng nhập', type: 'submit', block: true });
  let busy = false;

  const notice = ctx.takeNotice();

  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        if (busy) {
          return;
        }
        replaceContent(alertHost);
        phone.setError(null);
        password.setError(null);
        const checked = validateLogin({ phone: phone.input.value, password: password.input.value });
        if (checked.value === undefined) {
          phone.setError(checked.errors.phone);
          password.setError(checked.errors.password);
          focusFirstInvalid([phone, password]);
          return;
        }
        busy = true;
        setButtonLoading(submit, true, 'Đăng nhập', 'Đang đăng nhập…');
        const result = await ctx.signIn(checked.value);
        busy = false;
        if (result === undefined || result.handled || result.stale) {
          return; // the app already moved to the next screen, or the answer belongs to an older state
        }
        setButtonLoading(submit, false, 'Đăng nhập');
        if (result.kind === 'http' && result.code === 'INVALID_CREDENTIALS') {
          password.input.value = '';
          replaceContent(alertHost, Alert({ tone: 'danger', message: describeFailure(result).message, detail: describeFailure(result).detail }));
          password.input.focus();
          return;
        }
        replaceContent(alertHost, failureAlert(result));
      },
    },
    phone.root,
    password.root,
    alertHost,
    submit,
  );

  const el = Card({
    className: 'card-auth',
    children: [
      Heading({ text: 'Đăng nhập 11Ship' }),
      h('p', { class: 'lead' }, 'Dành cho Quán và Xế. Gọi là có.'),
      notice ? Alert({ tone: notice.tone, message: notice.message }) : null,
      form,
      // Registration and OTP are closed in this environment. There is no register link and no SMS bypass.
      h('p', { class: 'note' }, 'Đăng ký và xác minh SMS tạm thời chưa mở. Dùng tài khoản thử nghiệm do đội dự án cấp.'),
    ],
  });
  return { title: 'Đăng nhập', el, layout: 'auth' };
}
