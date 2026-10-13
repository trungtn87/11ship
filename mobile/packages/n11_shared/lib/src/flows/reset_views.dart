import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../brand.dart';
import '../tokens.dart';
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

  @override
  void initState() {
    super.initState();
    widget.controller.begin();
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
            background: N11Colors.white,
            children: <Widget>[
              const N11StateBlock(key: Key('reset-done'), kind: StateKind.ok, title: kResetDoneTitle, text: kResetDoneText),
              const SizedBox(height: N11Space.gap4),
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
            const N11Heading('Đặt lại mật khẩu', sub: 'Nhập số điện thoại đã đăng ký và mật khẩu mới.'),
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
                trailing: controller.pendingMatches(phone: _phone.text, password: _password.text) && canRetryFailure(failure)
                    ? N11Button(key: const Key('retry-pending'), label: 'Thử lại', compact: true, onPressed: busy ? null : controller.retryPending)
                    : null,
              ),
            N11Field(fieldKey: const Key('reset-phone'), label: 'Số điện thoại', placeholder: '0912 345 678', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('reset-password'),
              label: 'Mật khẩu mới',
              controller: _password,
              password: true,
              maxLength: 128,
              enabled: !busy,
              hint: 'Dùng từ 8 đến 128 ký tự.',
              onChanged: () => setState(() {}),
            ),
            N11Field(
              fieldKey: const Key('reset-confirm'),
              label: 'Nhập lại mật khẩu mới',
              controller: _confirm,
              password: true,
              maxLength: 128,
              enabled: !busy,
              tone: _confirm.text.isNotEmpty && _confirm.text != _password.text ? FieldTone.error : FieldTone.normal,
              hint: _confirm.text.isNotEmpty && _confirm.text != _password.text ? 'Hai mật khẩu chưa giống nhau.' : null,
              onChanged: () => setState(() {}),
            ),
            N11Button(
              key: const Key('reset-submit'),
              label: busy ? 'Đang gửi…' : 'Đặt lại mật khẩu',
              loading: busy,
              onPressed: busy || !_valid || controller.mode != ResetMode.available ? null : () => controller.submit(phone: _phone.text, password: _password.text),
            ),
          ],
        );
      },
    );
  }
}
