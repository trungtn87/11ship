import { AppBrand, logo } from '../brand.js';
import { banner, button, checkbox, chip, countdown, emptyState, gate, list, listItem, openDialog, otpField, passwordField, skeleton, textField } from '../components.js';
import { formatCountdown, h } from '../dom.js';
import { icon } from '../icons.js';
import { ScreenDef, ScreenEnv, VariantDef } from '../screen.js';
import { failureMessage, STATE_COPY } from '../states.js';
import { failureBanner } from '../screens/feedback.js';
import { appPage, designOnly, guardForm } from '../screens/layout.js';

// "Trạng thái chung" (C01-C10 of the design catalog) and a gallery of the shared components. These screens exist so every
// state can be reviewed without causing a real failure. In the real app the same banners/pages are produced by the
// screens when a call fails; here they are shown directly.

const v = (id: string, label: string): VariantDef => ({ id, label });

function statePage(env: ScreenEnv, children: readonly (Node | undefined)[], title?: string): HTMLElement {
  return appPage({ title, onBack: () => env.back(), bodyClass: 'c-stack c-stack--loose', body: children });
}

export function stateScreens(brand: AppBrand): readonly ScreenDef[] {
  const food = brand.id === 'FOOD';
  return [
    {
      id: 'state-loading',
      code: 'C01',
      title: 'Đang tải',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Khung chờ'), v('submitting', 'Đang gửi')],
      render(env, variant) {
        const submitting = variant === 'submitting';
        const submit = button({ label: submitting ? 'Đang xử lý…' : 'Lưu', kind: 'primary' });
        if (submitting) {
          submit.disabled = true;
          submit.replaceChildren(h('span', { class: 'c-spinner', 'aria-hidden': 'true' }), h('span', {}, STATE_COPY.working));
          submit.setAttribute('aria-busy', 'true');
        }
        return statePage(env, [skeleton(4), submitting ? submit : undefined], 'Đang tải');
      },
    },
    {
      id: 'state-empty',
      code: 'C02',
      title: 'Chưa có dữ liệu',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        return statePage(env, [emptyState({ icon: 'receipt', title: 'Chưa có đơn hàng', text: 'Khi có đơn hàng, danh sách sẽ hiện ở đây. Màn này không hiển thị số liệu giả.', action: { label: 'Về trang chủ', onClick: () => env.go('home') } })], 'Đơn hàng');
      },
    },
    {
      id: 'state-offline',
      code: 'C03',
      title: 'Mất kết nối',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const name = textField({ id: 'sample-name', label: 'Họ và tên', icon: 'user', value: 'Nguyễn Văn A' });
        return statePage(env, [failureBanner('OFFLINE'), name.root, button({ label: STATE_COPY.retry, icon: 'refresh', onClick: () => designOnly(env, STATE_COPY.designNoSend) })], 'Đăng ký');
      },
    },
    {
      id: 'state-session-expired',
      code: 'C04',
      title: 'Phiên hết hạn',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const phone = textField({ id: 'sample-phone', label: 'Số điện thoại', icon: 'phone', value: '098 •••• 123', readOnly: true });
        const password = passwordField({ id: 'sample-password', label: 'Mật khẩu', autocomplete: 'current-password', placeholder: 'Nhập mật khẩu' });
        const message = failureMessage('SESSION_EXPIRED');
        const submit = button({ label: 'Đăng nhập', kind: 'primary' });
        // In the real app the sign-in button stays unavailable (with its reason) until the login backend exists.
        const cta = env.mode === 'live' && !env.isWired('auth.login') ? gate(submit, env.featureReason('auth.login')) : submit;
        return appPage({
          bodyClass: 'c-stack c-stack--loose',
          body: [
            h('div', { class: 'c-stack c-stack--tight c-center' }, logo(brand, true), h('p', { class: 'c-slogan' }, brand.slogan)),
            banner({ kind: 'warn', title: message.title, text: message.text }),
            h('div', { class: 'c-stack' }, phone.root, password.root, cta),
          ],
        });
      },
    },
    {
      id: 'state-forbidden',
      code: 'C05',
      title: 'Không có quyền',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const message = failureMessage('FORBIDDEN');
        return statePage(env, [emptyState({ icon: 'lock', title: message.title, text: message.text, action: { label: STATE_COPY.back, onClick: () => env.go('home') } })]);
      },
    },
    {
      id: 'state-conflict',
      code: 'C06',
      title: 'Xung đột cập nhật',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const name = textField({ id: 'sample-shop', label: 'Tên quán', icon: 'store', value: 'Quán của bạn' });
        const page = statePage(env, [name.root, button({ label: 'Lưu hồ sơ', kind: 'primary' })], 'Hồ sơ cửa hàng');
        const message = failureMessage('VERSION_CONFLICT');
        openDialog({
          title: message.title,
          text: message.text,
          icon: 'refresh',
          tone: 'neutral',
          host: env.dialogHost,
          actions: [{ label: 'Hủy' }, { label: 'Xem bản mới', kind: 'primary', onClick: () => designOnly(env, STATE_COPY.designNoSend) }],
        });
        return page;
      },
    },
    {
      id: 'state-unknown-outcome',
      code: 'C07',
      title: 'Chưa xác định kết quả',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        return statePage(env, [failureBanner('OUTCOME_UNKNOWN', { onRetry: () => designOnly(env, STATE_COPY.designNoSend) }), h('p', { class: 'c-caption' }, 'Hệ thống không tự gửi lại bằng khóa mới và không báo thất bại khi chưa chắc chắn.')], 'Gửi hồ sơ');
      },
    },
    {
      id: 'state-dirty-leave',
      code: 'C08',
      title: 'Xác nhận bỏ thay đổi',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('form', 'Đang nhập (bấm Quay lại)'), v('dialog', 'Hộp xác nhận')],
      render(env, variant) {
        const phone = textField({ id: 'sample-phone', label: 'Số điện thoại', icon: 'phone', type: 'tel', inputMode: 'tel' });
        const password = passwordField({ id: 'sample-password', label: 'Mật khẩu', autocomplete: 'new-password' });
        const otp = otpField({ id: 'sample-code', label: 'Mã OTP 6 số' });
        const form = h('form', { class: 'c-stack', novalidate: true }, phone.root, password.root, otp.root);
        // The guard is registered while the form is still empty, so what is typed below counts as "đang nhập".
        guardForm(env, form, { flows: ['sample-flow'] });
        phone.input.value = '0981234123';
        password.input.value = 'mat-khau-dang-nhap';
        otp.input.value = '123';
        otp.input.dispatchEvent(new Event('input'));
        const page = statePage(
          env,
          [
            h('p', { class: 'c-lead' }, 'Khi đang nhập mà bấm Quay lại, chuyển màn hình hoặc nút Back của trình duyệt, ứng dụng hỏi trước khi bỏ. “Ở lại” giữ nguyên nội dung; “Thoát” xóa mật khẩu và mã OTP đã nhập. Chúng không được lưu vào địa chỉ trang hay bộ nhớ trình duyệt.'),
            form,
          ],
          'Đang nhập',
        );
        if (variant === 'dialog') {
          env.back();
        }
        return page;
      },
    },
    {
      id: 'state-rate-limited',
      code: 'C09',
      title: 'Giới hạn thử',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const note = h('p', { class: 'c-banner__text' });
        countdown(300, (remaining) => (note.textContent = STATE_COPY.rateLimited(formatCountdown(remaining))), () => undefined);
        const otp = otpField({ id: 'sample-otp', label: 'Mã OTP 6 số' });
        return statePage(env, [banner({ kind: 'warn', title: 'Thử quá nhiều lần', text: note }), otp.root], 'Xác minh');
      },
    },
    {
      id: 'state-unavailable',
      code: 'C10',
      title: 'Chức năng chưa nối',
      group: 'Trạng thái chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        const submit = button({ label: food ? 'Đăng ký quán' : 'Gửi hồ sơ', kind: 'primary' });
        return statePage(env, [h('p', { class: 'c-lead' }, 'Nút nghiệp vụ chưa có máy chủ phục vụ được tắt và luôn ghi rõ lý do bên cạnh:'), gate(submit, env.featureReason('shop.draftSave'))], 'Chức năng chưa nối');
      },
    },
  ];
}

export function galleryScreens(): readonly ScreenDef[] {
  return [
    {
      id: 'gallery-controls',
      code: 'UI1',
      title: 'Nút, ô nhập, mã OTP',
      group: 'Thành phần dùng chung',
      access: 'public',
      variants: [v('default', 'Mặc định'), v('errors', 'Có lỗi')],
      render(env, variant) {
        const errors = variant === 'errors';
        const name = textField({ id: 'g-name', label: 'Họ và tên', icon: 'user', placeholder: 'Nhập họ và tên' });
        const optional = textField({ id: 'g-zalo', label: 'Zalo', optional: true, placeholder: 'Nhập link Zalo' });
        const password = passwordField({ id: 'g-password', label: 'Mật khẩu', autocomplete: 'new-password', placeholder: 'Tạo mật khẩu', hint: '8 đến 128 ký tự.' });
        const readOnly = textField({ id: 'g-phone', label: 'Số điện thoại đăng nhập', icon: 'phone', value: '098 •••• 123', readOnly: true, hint: 'Không thể thay đổi số điện thoại.' });
        const otp = otpField({ id: 'g-otp', label: 'Mã OTP 6 số' });
        const terms = checkbox({ id: 'g-terms', label: 'Tôi đồng ý với Điều khoản sử dụng' });
        if (errors) {
          name.setError(STATE_COPY.nameInvalid);
          password.input.value = 'abc';
          password.setError(STATE_COPY.passwordRule);
          otp.setError(STATE_COPY.otpInvalid);
          terms.setError(STATE_COPY.consentRequired);
        }
        const disabled = button({ label: 'Gửi hồ sơ', kind: 'primary' });
        return appPage({
          title: 'Thành phần',
          onBack: () => env.back(),
          bodyClass: 'c-stack',
          body: [
            button({ label: 'Nút chính', kind: 'primary', onClick: () => designOnly(env, STATE_COPY.designNoSend) }),
            button({ label: 'Nút phụ', kind: 'secondary' }),
            button({ label: 'Hành động xóa', kind: 'danger-outline' }),
            gate(disabled, 'Chưa nối máy chủ: ví dụ lý do hiển thị ngay dưới nút.'),
            name.root,
            optional.root,
            password.root,
            readOnly.root,
            otp.root,
            terms.root,
          ],
        });
      },
    },
    {
      id: 'gallery-feedback',
      code: 'UI2',
      title: 'Thông báo, nhãn, danh sách',
      group: 'Thành phần dùng chung',
      access: 'public',
      variants: [v('default', 'Mặc định')],
      render(env) {
        return appPage({
          title: 'Thành phần',
          onBack: () => env.back(),
          bodyClass: 'c-stack',
          body: [
            banner({ kind: 'info', title: 'Thông tin', text: 'Nội dung giải thích trung tính.' }),
            banner({ kind: 'warn', title: 'Lưu ý', text: 'Cảnh báo cần đọc trước khi tiếp tục.' }),
            banner({ kind: 'error', title: 'Lỗi', text: 'Việc chưa thực hiện được và cách xử lý.' }),
            banner({ kind: 'success', title: 'Hoàn tất (minh họa)', text: 'Chỉ dùng khi có kết quả thật từ máy chủ.' }),
            banner({ kind: 'test', title: 'SMS mô phỏng — môi trường thử', text: 'Mã không gửi tin nhắn thật.' }),
            h('div', { class: 'c-row-flex' }, chip('Sắp có', 'soon'), chip('Chờ duyệt', 'warn'), chip('Đã khóa', 'bad'), chip('Đang hoạt động', 'ok'), chip('Thông tin', 'info')),
            list([
              listItem({ icon: 'user', title: 'Hồ sơ cá nhân', onClick: () => designOnly(env, STATE_COPY.designNoSend) }),
              listItem({ icon: 'mapPin', title: 'Địa chỉ giao hàng', soon: true }),
              listItem({ icon: 'logout', title: 'Đăng xuất', tone: 'danger', onClick: () => designOnly(env, STATE_COPY.designNoSend) }),
            ]),
            h('p', { class: 'c-caption' }, 'Biểu tượng:'),
            h('div', { class: 'c-row-flex' }, icon('home'), icon('search'), icon('receipt'), icon('wallet'), icon('user'), icon('store'), icon('truck')),
          ],
        });
      },
    },
  ];
}
