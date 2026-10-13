import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../brand.dart';
import '../widgets/components.dart';
import 'reset_controller.dart';

// F13 / S15: forgotten password, test build. One form: phone, new password, confirmation (the confirmation is checked on the phone
// only and never sent). The submit stays closed until the SERVER says DISABLED_TEST; any other answer closes it with its reason.

const String kResetTestNote = 'Bản test: đặt lại mật khẩu chưa yêu cầu OTP';
const String kResetDoneTitle = 'Yêu cầu đã xử lý';
const String kResetDoneText = 'Nếu số điện thoại hợp lệ, hãy đăng nhập bằng mật khẩu mới. Ứng dụng không tự đăng nhập cho bạn.';

class ResetScreen extends StatefulWidget {
  const ResetScreen({super.key, required this.controller, required this.brand});

  final ResetController controller;
  final AppBrand brand;

  @override
  State<ResetScreen> createState() => _ResetScreenState();
}

class _ResetScreenState extends State<ResetScreen> {
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _show = false;

  @override
  void initState() {
    super.initState();
    widget.controller.loadConfig();
  }

  @override
  void dispose() {
    widget.controller.abandon();
    _phone.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  bool get _valid => _phone.text.trim().isNotEmpty && _password.text.length >= 8 && _password.text.length <= 128 && _password.text == _confirm.text;

  @override
  Widget build(BuildContext context) {
    final ResetController controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        if (controller.done) {
          return N11FormScaffold(
            title: 'Quên mật khẩu',
            session: null,
            children: <Widget>[
              const N11Banner(key: Key('reset-done'), kind: BannerKind.success, title: kResetDoneTitle, text: kResetDoneText),
              N11Button(key: const Key('reset-to-login'), label: 'Đăng nhập', onPressed: () => Navigator.of(context).maybePop()),
            ],
          );
        }
        final bool busy = controller.busy;
        final AuthFailure? failure = controller.failure;
        return N11FormScaffold(
          title: 'Quên mật khẩu',
          session: null,
          children: <Widget>[
            Center(child: BrandLogo(brand: widget.brand, height: 48)),
            if (controller.mode == ResetMode.available) const N11Banner(key: Key('reset-note'), kind: BannerKind.warn, title: kResetTestNote),
            if (controller.mode == ResetMode.closed)
              const N11Banner(key: Key('reset-closed'), kind: BannerKind.warn, title: 'Chưa mở đặt lại mật khẩu', text: 'Máy chủ chưa bật đặt lại mật khẩu cho bản test. Chưa thể gửi yêu cầu.'),
            if (controller.mode == ResetMode.unknown)
              N11Banner(
                key: const Key('reset-unknown'),
                kind: BannerKind.warn,
                title: 'Chưa đọc được cấu hình',
                text: 'Ứng dụng không đoán trạng thái của máy chủ nên chưa gửi yêu cầu.',
                trailing: N11Button(key: const Key('reset-reload'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: controller.loadConfig),
              ),
            if (failure != null)
              N11Banner(
                key: const Key('form-error'),
                kind: BannerKind.error,
                title: 'Chưa hoàn tất',
                text: failureMessage(failure),
                trailing: controller.hasPendingWrite && canRetryFailure(failure)
                    ? N11Button(key: const Key('retry-pending'), label: 'Thử lại', compact: true, onPressed: busy ? null : controller.retryPending)
                    : null,
              ),
            N11Field(fieldKey: const Key('reset-phone'), label: 'Số điện thoại', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('reset-password'),
              label: 'Mật khẩu mới (8 đến 128 ký tự)',
              controller: _password,
              obscure: !_show,
              maxLength: 128,
              enabled: !busy,
              onChanged: () => setState(() {}),
              suffix: IconButton(tooltip: _show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)),
            ),
            N11Field(fieldKey: const Key('reset-confirm'), label: 'Nhập lại mật khẩu mới', controller: _confirm, obscure: !_show, maxLength: 128, enabled: !busy, onChanged: () => setState(() {})),
            if (_confirm.text.isNotEmpty && _confirm.text != _password.text) const ReasonNote('Hai mật khẩu chưa giống nhau.'),
            N11Button(
              key: const Key('reset-submit'),
              label: busy ? 'Đang gửi…' : 'Đặt lại mật khẩu',
              onPressed: busy || !_valid || controller.mode != ResetMode.available ? null : () => controller.submit(phone: _phone.text, password: _password.text),
            ),
          ],
        );
      },
    );
  }
}
