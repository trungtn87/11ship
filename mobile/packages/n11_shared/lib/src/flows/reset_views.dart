import 'dart:async';

import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../account/models.dart';
import '../account/vn_mobile.dart';
import '../brand.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../widgets/form_feedback.dart';
import 'reset_controller.dart';

// F13 / S15: forgotten password, test build. One form: phone, new password, confirmation (the confirmation is checked on the phone
// only and never sent). The submit stays closed until the SERVER says DISABLED_TEST; any other answer closes it with its reason.

const String kResetOtpSentTitle = 'Đã xử lý yêu cầu';
const String kResetOtpSentText = 'Nếu số điện thoại đã đăng ký, bạn sẽ nhận tin nhắn SMS chứa mã xác minh trong ít phút. Nhập mã vào ô bên dưới.';
const String kResetDoneTitle = 'Yêu cầu đã xử lý';
const String kResetDoneText = 'Nếu số điện thoại hợp lệ, hãy đăng nhập bằng mật khẩu mới. Ứng dụng không tự đăng nhập cho bạn.';
const String kRecoverDoneTitle = 'Đã khôi phục tài khoản';
const String kRecoverDoneText = 'Tài khoản đã được mở khóa với mật khẩu mới. Hãy đăng nhập. Dữ liệu và lịch sử của tài khoản được giữ nguyên; quán hoặc hồ sơ xế chỉ hoạt động lại khi đủ điều kiện.';

class ResetScreen extends StatefulWidget {
  const ResetScreen({super.key, required this.controller, required this.brand, this.recovery = false});

  final ResetController controller;
  final AppBrand brand;

  /// true = the recovery of an account locked at its owner's request (same form, its own wording); false = the forgotten password.
  final bool recovery;

  @override
  State<ResetScreen> createState() => _ResetScreenState();
}

class _ResetScreenState extends State<ResetScreen> {
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  final TextEditingController _code = TextEditingController();
  final FormFeedback _feedback = FormFeedback();
  bool _phoneAttempted = false;
  bool _codeAttempted = false;
  bool _lockHandled = false;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    widget.controller.begin();
    widget.controller.loadConfig();
    widget.controller.addListener(_changed);
  }

  /// A timer exists only while "send again" is locked, so an idle screen schedules nothing.
  void _changed() {
    final ResetController controller = widget.controller;
    // The server closed the challenge (too many wrong codes): the flow is back at its first step and the temporary data is wiped
    // (code, new password, confirmation). The number stays typed and the cooldown stays; no account is touched.
    if (controller.lockedOut && !_lockHandled) {
      _lockHandled = true;
      _code.clear();
      _password.clear();
      _confirm.clear();
      _codeAttempted = false;
    } else if (!controller.lockedOut) {
      _lockHandled = false;
    }
    if (_tick == null && controller.mode == ResetMode.smsOtp && !controller.canResend && controller.otpStep != ResetOtpStep.verified) {
      _tick = Timer.periodic(const Duration(seconds: 1), (Timer timer) {
        if (!mounted || widget.controller.canResend) {
          timer.cancel();
          _tick = null;
        }
        if (mounted) {
          setState(() {});
        }
      });
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    widget.controller.removeListener(_changed);
    widget.controller.abandon();
    _code.dispose();
    _phone.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }


  @override
  Widget build(BuildContext context) {
    final ResetController controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final bool recovery = widget.recovery;
        if (controller.done) {
          return N11FormScaffold(
            title: recovery ? 'Khôi phục tài khoản' : 'Quên mật khẩu',
            session: null,
            background: N11Colors.white,
            children: <Widget>[
              N11StateBlock(key: const Key('reset-done'), kind: StateKind.ok, title: recovery ? kRecoverDoneTitle : kResetDoneTitle, text: recovery ? kRecoverDoneText : kResetDoneText),
              const SizedBox(height: N11Space.gap4),
              N11Button(key: const Key('reset-to-login'), label: 'Đăng nhập', onPressed: () => Navigator.of(context).maybePop()),
            ],
          );
        }
        final bool busy = controller.busy;
        final AuthFailure? failure = controller.failure;
        final bool sms = controller.mode == ResetMode.smsOtp;
        // In SMS_OTP mode the password is asked only after the code was verified.
        final bool passwordStep = !sms || controller.otpVerified;
        final bool open = sms && controller.otpVerified;
        return N11FormScaffold(
          title: recovery ? 'Khôi phục tài khoản' : 'Quên mật khẩu',
          session: null,
          children: <Widget>[
            N11Heading(
              recovery ? 'Khôi phục tài khoản đã khóa' : 'Đặt lại mật khẩu',
              sub: recovery
                  ? 'Nhập số điện thoại của tài khoản, mã xác minh nhận qua SMS (bắt buộc), rồi đặt mật khẩu mới. Tài khoản cũ được mở khóa và giữ nguyên dữ liệu.'
                  : 'Nhập số điện thoại đã đăng ký, mã xác minh nhận qua SMS, rồi đặt mật khẩu mới.',
            ),
            if (controller.lockedOut)
              const N11Banner(
                key: Key('reset-otp-locked'),
                kind: BannerKind.error,
                title: 'Đã hủy luồng xác minh',
                text: 'Bạn đã nhập sai mã quá số lần cho phép. Dữ liệu đang nhập đã được xóa; hãy bắt đầu lại. Bạn vẫn phải đợi hết thời gian chờ trước khi yêu cầu mã mới. Tài khoản của bạn không bị ảnh hưởng.',
              ),
            if (sms && controller.otpStep == ResetOtpStep.requested) const N11Banner(key: Key('reset-otp-sent'), kind: BannerKind.info, title: kResetOtpSentTitle, text: kResetOtpSentText),
            if (sms && controller.otpVerified) const N11Banner(key: Key('reset-otp-verified'), kind: BannerKind.success, title: 'Đã xác minh mã'),
            if (controller.mode == ResetMode.closed)
              N11Banner(
                key: const Key('reset-closed'),
                kind: BannerKind.warn,
                title: recovery ? 'Chưa thể khôi phục tài khoản' : 'Tự đặt lại mật khẩu đang tạm khóa',
                text: recovery
                    ? 'Máy chủ chưa gửi được mã SMS nên chưa thể khôi phục tài khoản. Mã SMS là bắt buộc; ứng dụng không bỏ qua bước này.'
                    : 'Chức năng tự đặt lại mật khẩu đang tạm khóa. Vui lòng liên hệ hỗ trợ.',
              ),
            if (controller.mode == ResetMode.unknown)
              N11Banner(
                key: const Key('reset-unknown'),
                kind: BannerKind.warn,
                title: 'Chưa đọc được cấu hình',
                text: 'Ứng dụng không đoán trạng thái của máy chủ nên chưa gửi yêu cầu.',
                trailing: N11Button(key: const Key('reset-reload'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: controller.loadConfig),
              ),
            if (failure != null && !controller.lockedOut)
              N11Banner(
                key: const Key('form-error'),
                kind: BannerKind.error,
                title: 'Chưa hoàn tất',
                text: failureMessage(failure),
                trailing: controller.pendingMatches(phone: _phone.text, password: _password.text) && canRetryFailure(failure)
                    ? N11Button(key: const Key('retry-pending'), label: 'Thử lại', compact: true, onPressed: busy ? null : controller.retryPending)
                    : null,
              ),
            N11Field(
              validator: otpPhoneError,
              hint: _phoneAttempted ? otpPhoneError(_phone.text) : null,
              tone: _phoneAttempted && otpPhoneError(_phone.text) != null ? FieldTone.error : FieldTone.normal,
              key: _feedback.key('phone'),
              fieldKey: const Key('reset-phone'),
              label: 'Số điện thoại',
              placeholder: '0912345678',
              controller: _phone,
              keyboard: TextInputType.phone,
              maxLength: 20,
              enabled: !busy,
              onChanged: () {
                controller.phoneEdited(_phone.text);
                setState(() {});
              },
            ),
            if (sms && !controller.otpVerified) ...<Widget>[
              N11Button(
                key: const Key('reset-otp-request'),
                label: controller.otpStep == ResetOtpStep.requesting ? 'Đang gửi…' : (!controller.canResend && controller.resendSeconds > 0 ? 'Gửi lại sau ${formatWait(controller.resendSeconds)}' : (controller.otpStep == ResetOtpStep.idle ? 'Gửi mã xác minh' : 'Gửi lại mã')),
                kind: ButtonKind.secondary,
                loading: controller.otpStep == ResetOtpStep.requesting,
                onPressed: busy || !controller.canResend ? null : () { setState(() => _phoneAttempted = true); if (_feedback.validate(<String, String?>{'phone': otpPhoneError(_phone.text)})) controller.requestOtp(_phone.text); },
              ),
              if (controller.otpStep == ResetOtpStep.requested || controller.otpStep == ResetOtpStep.verifying) ...<Widget>[
                N11Field(key: _feedback.key('code'), validator: otpError, hint: _codeAttempted ? otpError(_code.text) : null, tone: _codeAttempted && otpError(_code.text) != null ? FieldTone.error : FieldTone.normal, fieldKey: const Key('reset-otp-code'), label: 'Mã xác minh', placeholder: '6 số', controller: _code, keyboard: TextInputType.number, maxLength: 6, enabled: !busy, onChanged: () => setState(() {})),
                N11Button(
                  key: const Key('reset-otp-verify'),
                  label: controller.otpStep == ResetOtpStep.verifying ? 'Đang kiểm tra…' : 'Xác nhận mã',
                  loading: controller.otpStep == ResetOtpStep.verifying,
                  onPressed: busy ? null : () { setState(() => _codeAttempted = true); if (_feedback.validate(<String, String?>{'code': otpError(_code.text)})) controller.verifyOtp(_code.text); },
                ),
              ],
            ],
            if (passwordStep) N11Field(
              validator: passwordError,
              fieldKey: const Key('reset-password'),
              label: 'Mật khẩu mới',
              controller: _password,
              password: true,
              maxLength: 128,
              enabled: !busy,
              hint: 'Dùng từ 8 đến 128 ký tự.',
              onChanged: () => setState(() {}),
            ),
            if (passwordStep) N11Field(
              validator: (String value) => confirmPasswordError(value, _password.text),
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
            if (passwordStep) N11Button(
              key: const Key('reset-submit'), validate: true,
              label: busy ? 'Đang gửi…' : (recovery ? 'Khôi phục tài khoản' : 'Đặt lại mật khẩu'),
              loading: busy,
              onPressed: busy || !open ? null : () => controller.submit(phone: _phone.text, password: _password.text),
            ),
          ],
        );
      },
    );
  }
}
