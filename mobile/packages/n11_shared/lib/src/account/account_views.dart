import 'package:flutter/material.dart';

import '../brand.dart';
import '../features.dart';
import '../shell.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../flows/reset_controller.dart';
import '../flows/reset_views.dart';
import 'models.dart';
import 'session_controller.dart';

// Account screens of both phone apps, laid out like the approved web screens (docs/ui/m01-food-web.md F04/F10/F11/F16/F17/F18 and
// docs/ui/m01-ship-web.md S05/S10/S11): guest, login, register, signed-in account, own profile and the logout dialog. They reuse
// the shell, the components and the tokens; nothing here knows a role as an authority, every value comes from [SessionController].

const String kNoServerReason = 'Bản dựng này thiếu địa chỉ máy chủ HTTPS (API_BASE_URL).';

/// A refusal in words (Vietnamese, fixed): never the server's text.
String failureMessage(AuthFailure failure) {
  switch (failure.kind) {
    case AuthFailureKind.unknownOutcome:
      return 'Chưa nhận được phản hồi từ máy chủ. Yêu cầu có thể đã được xử lý. Nhấn "Thử lại" để gửi lại đúng yêu cầu đó.';
    case AuthFailureKind.tls:
      return 'Chứng chỉ bảo mật của máy chủ không hợp lệ. Ứng dụng không bỏ qua bước kiểm tra này.';
    case AuthFailureKind.invalidCredentials:
      return 'Số điện thoại hoặc mật khẩu không đúng.';
    case AuthFailureKind.sessionEnded:
      return 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
    case AuthFailureKind.deviceUnsupported:
      return 'Thiết bị này chưa hỗ trợ xác thực phần cứng nên chưa dùng được tài khoản trên bản Android này. (DEVICE_PROOF_UNSUPPORTED)';
    case AuthFailureKind.deviceProofRefused:
      return 'Máy chủ chưa xác nhận được thiết bị. Hãy kiểm tra giờ của điện thoại rồi thử lại.';
    case AuthFailureKind.serverUnavailable:
      return failure.code == 'TRANSACTION_OUTCOME_UNKNOWN'
          ? 'Máy chủ chưa xác nhận được kết quả. Nhấn "Thử lại" để gửi lại đúng yêu cầu đó.'
          : 'Máy chủ chưa sẵn sàng cho bản Android. Vui lòng thử lại sau.';
    case AuthFailureKind.versionConflict:
      return 'Hồ sơ đã được cập nhật ở nơi khác. Đã tải bản mới; kiểm tra rồi lưu lại nếu cần.';
    case AuthFailureKind.phoneRegistered:
      return 'Số điện thoại này đã đăng ký. Hãy đăng nhập.';
    case AuthFailureKind.notReplayable:
      return 'Không gửi lại được yêu cầu trước đó. Vui lòng thực hiện lại.';
    case AuthFailureKind.accountDisabled:
      return 'Tài khoản này đang bị khóa.';
    case AuthFailureKind.badRequest:
      return 'Thông tin chưa hợp lệ. Kiểm tra số điện thoại, mật khẩu (8 đến 128 ký tự) và họ tên.';
    case AuthFailureKind.rateLimited:
      return 'Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại.';
    case AuthFailureKind.verificationUnsupported:
      return 'Máy chủ yêu cầu xác minh số điện thoại, bước này chưa hỗ trợ trên Android.';
    case AuthFailureKind.badResponse:
      return 'Phản hồi của máy chủ không đúng như mong đợi.';
    case AuthFailureKind.stateConflict:
      return 'Hồ sơ đã ở trạng thái khác trên máy chủ. Hãy tải lại để xem bản hiện tại.';
    case AuthFailureKind.invalidServiceArea:
      return 'Khu vực đã chọn không còn hợp lệ. Hãy tải lại danh sách khu vực và chọn lại.';
    case AuthFailureKind.roleNotAvailable:
      return 'Tài khoản chưa dùng được chế độ này.';
  }
}

bool canRetryFailure(AuthFailure? failure) =>
    failure != null && (failure.kind == AuthFailureKind.unknownOutcome || (failure.kind == AuthFailureKind.serverUnavailable && failure.code == 'TRANSACTION_OUTCOME_UNKNOWN'));

Route<void> n11Route(Widget screen) => MaterialPageRoute<void>(builder: (BuildContext context) => screen);

/// The guest prompt of Home / Orders: sends the person to the real login screen (guests open Home first, signing in is chosen in
/// Tài khoản or here).
class GuestPrompt extends StatelessWidget {
  const GuestPrompt({super.key, required this.session, required this.brand, required this.text, this.reset});

  final SessionController session;
  final ResetController? reset;
  final AppBrand brand;
  final String text;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        if (session.status == SessionStatus.signedIn) {
          return const SizedBox.shrink();
        }
        return N11Banner(
          kind: BannerKind.info,
          title: 'Bạn chưa đăng nhập',
          text: text,
          trailing: session.ready
              ? N11Button(key: const Key('guest-login'), label: 'Đăng nhập', kind: ButtonKind.secondary, compact: true, onPressed: () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset))))
              : const ReasonNote(kNoServerReason),
        );
      },
    );
  }
}

/// Tài khoản: guest, checking, unverified and signed-in states of one app. [entries] are that app's own rows (shop / driver entry,
/// help, policy), shown for guests and signed-in people alike and kept locked with their reason.
class AccountTab extends StatelessWidget {
  const AccountTab({super.key, required this.session, required this.brand, required this.actions, required this.entries, this.registerLabel = 'Đăng ký', this.signedInEntries = const <Widget>[], this.reset});

  final SessionController session;
  final ResetController? reset;

  /// Rows shown only while signed in (the shop / driver entry), before [entries].
  final List<Widget> signedInEntries;
  final AppBrand brand;
  final ShellActions actions;
  final List<Widget> entries;
  final String registerLabel;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        switch (session.status) {
          case SessionStatus.starting:
            return vstack(<Widget>[
              _hero(),
              const N11Banner(kind: BannerKind.info, title: 'Đang kiểm tra phiên đăng nhập…', text: 'Vui lòng chờ trong giây lát.'),
              _tools(context, signedIn: false),
            ]);
          case SessionStatus.unverified:
            return vstack(<Widget>[
              _hero(),
              N11Banner(
                kind: BannerKind.warn,
                title: 'Chưa kiểm tra được phiên đăng nhập',
                text: session.lastFailure == null ? 'Máy chủ chưa trả lời.' : failureMessage(session.lastFailure!),
                trailing: N11Button(key: const Key('revalidate'), label: 'Thử lại', kind: ButtonKind.secondary, compact: true, onPressed: session.revalidate),
              ),
              _tools(context, signedIn: false),
            ]);
          case SessionStatus.guest:
            return _guest(context);
          case SessionStatus.signedIn:
            return _signedIn(context);
        }
      },
    );
  }

  Widget _hero() {
    return Container(
      padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap8, N11Space.pad, N11Space.gap6),
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: <Color>[N11Colors.yellowSoft, N11Colors.white]),
      ),
      child: Column(
        children: <Widget>[
          BrandLogo(brand: brand, height: 64),
          const SizedBox(height: N11Space.gap2),
          Text(brand.slogan, style: N11Text.captionInk2.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _tools(BuildContext context, {required bool signedIn}) {
    return N11List(children: <Widget>[
      if (signedIn)
        N11ListItem(
          key: const Key('open-profile'),
          icon: Icons.badge_outlined,
          title: 'Thông tin cá nhân',
          sub: 'Xem và sửa họ tên',
          onTap: () => Navigator.of(context).push(n11Route(ProfileScreen(session: session))),
        ),
      if (signedIn) ...signedInEntries,
      ...entries,
      N11ListItem(icon: Icons.network_check, title: 'Chẩn đoán kết nối', sub: 'Kiểm tra kết nối với máy chủ', onTap: actions.openDiagnostics),
      if (signedIn) N11ListItem(key: const Key('open-logout'), icon: Icons.logout, title: 'Đăng xuất', onTap: () => confirmLogout(context, session)),
    ]);
  }

  Widget _guest(BuildContext context) {
    return vstack(<Widget>[
      _hero(),
      if (session.sessionEndedNotice)
        N11Banner(
          key: const Key('session-ended'),
          kind: BannerKind.warn,
          title: 'Phiên đăng nhập đã kết thúc',
          text: 'Tài khoản có thể đã đăng nhập trên thiết bị khác hoặc phiên đã hết hạn. Vui lòng đăng nhập lại.',
        ),
      if (session.loggedOutNotice)
        N11Banner(
          key: const Key('logged-out'),
          kind: session.logoutUnconfirmed ? BannerKind.warn : BannerKind.success,
          title: session.logoutUnconfirmed ? 'Đã đăng xuất trên máy này' : 'Đã đăng xuất',
          text: session.logoutUnconfirmed ? 'Chưa xác nhận được với máy chủ rằng phiên đã bị thu hồi (không có kết nối).' : 'Phiên đã được thu hồi trên máy chủ.',
        ),
      if (!session.ready) const ReasonNote(kNoServerReason),
      N11Button(key: const Key('open-login'), label: 'Đăng nhập', onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset))) : null),
      N11Button(key: const Key('open-register'), label: registerLabel, kind: ButtonKind.secondary, onPressed: session.ready ? () => Navigator.of(context).push(n11Route(RegisterScreen(session: session, brand: brand))) : null),
      _tools(context, signedIn: false),
    ]);
  }

  Widget _signedIn(BuildContext context) {
    final Identity? identity = session.identity;
    final String name = session.profile?.fullName ?? 'Chưa có tên';
    return vstack(<Widget>[
      N11Card(
        child: Row(
          children: <Widget>[
            const CircleAvatar(radius: 24, backgroundColor: N11Colors.yellowSoft, child: Icon(Icons.person, color: N11Colors.yellowStrong)),
            const SizedBox(width: N11Space.gap3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(name, key: const Key('account-name'), style: N11Text.bodyStrong),
                  Text(identity?.maskedPhone ?? '', key: const Key('account-phone'), style: N11Text.caption),
                ],
              ),
            ),
          ],
        ),
      ),
      _tools(context, signedIn: true),
    ]);
  }
}

// ---- Logout (F18) ----------------------------------------------------------------------------------------------------

Future<void> confirmLogout(BuildContext context, SessionController session) async {
  final bool? yes = await showDialog<bool>(
    context: context,
    builder: (BuildContext context) => AlertDialog(
      title: const Text('Đăng xuất?'),
      content: const Text('Bạn sẽ cần đăng nhập lại để dùng tài khoản. Phiên trên máy chủ sẽ được thu hồi khi có kết nối.'),
      actions: <Widget>[
        TextButton(key: const Key('logout-cancel'), onPressed: () => Navigator.of(context).pop(false), child: const Text('Huỷ')),
        TextButton(key: const Key('logout-confirm'), onPressed: () => Navigator.of(context).pop(true), child: const Text('Đăng xuất')),
      ],
    ),
  );
  if (yes == true) {
    await session.logout();
  }
}

// ---- Forms -----------------------------------------------------------------------------------------------------------

class N11Field extends StatelessWidget {
  const N11Field({super.key, required this.fieldKey, required this.label, required this.controller, this.keyboard, this.obscure = false, this.suffix, this.maxLength, this.onChanged, this.enabled = true});

  final Key fieldKey;
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboard;
  final bool obscure;
  final Widget? suffix;
  final int? maxLength;
  final VoidCallback? onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: N11Text.label),
        const SizedBox(height: N11Space.gap2),
        TextField(
          key: fieldKey,
          controller: controller,
          enabled: enabled,
          keyboardType: keyboard,
          obscureText: obscure,
          maxLength: maxLength,
          autocorrect: false,
          enableSuggestions: !obscure,
          onChanged: onChanged == null ? null : (String _) => onChanged!(),
          decoration: InputDecoration(
            counterText: '',
            filled: true,
            fillColor: N11Colors.field,
            suffixIcon: suffix,
            contentPadding: const EdgeInsets.symmetric(horizontal: N11Space.gap3, vertical: 14),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.line, width: 1.5)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(kRadiusControl), borderSide: const BorderSide(color: N11Colors.yellow, width: 1.5)),
          ),
        ),
      ],
    );
  }
}

class N11FormScaffold extends StatelessWidget {
  const N11FormScaffold({super.key, required this.title, required this.children, required this.session});

  final String title;
  final List<Widget> children;
  final SessionController? session;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: N11Colors.white,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            N11AppBar(title: title, onBack: () => Navigator.of(context).maybePop()),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(N11Space.pad, N11Space.gap4, N11Space.pad, N11Space.gap8),
                child: vstack(children),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Banner for the last failure of a form, with "Thử lại" when the outcome of the write is unknown.
Widget _failureBanner(SessionController session) {
  final AuthFailure? failure = session.lastFailure;
  if (failure == null) {
    return const SizedBox.shrink();
  }
  return N11Banner(
    key: const Key('form-error'),
    kind: BannerKind.error,
    title: failure.kind == AuthFailureKind.invalidCredentials ? 'Không đăng nhập được' : 'Chưa hoàn tất',
    text: failureMessage(failure),
    trailing: canRetryFailure(failure) && session.pending != null
        ? Row(children: <Widget>[
            N11Button(key: const Key('retry-pending'), label: 'Thử lại', compact: true, onPressed: session.busy ? null : session.retryPending),
            const SizedBox(width: N11Space.gap3),
            N11Button(key: const Key('cancel-pending'), label: 'Bỏ qua', compact: true, kind: ButtonKind.secondary, onPressed: session.cancelPending),
          ])
        : null,
  );
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.session, required this.brand, this.reset});

  final SessionController session;
  final AppBrand brand;

  /// The forgotten-password flow (public, no proof). Null = not wired in this build.
  final ResetController? reset;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _show = false;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_leaveWhenSignedIn);
  }

  @override
  void dispose() {
    widget.session.removeListener(_leaveWhenSignedIn);
    widget.session.abandon();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  void _leaveWhenSignedIn() {
    if (widget.session.status == SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  bool get _valid => _phone.text.trim().isNotEmpty && _password.text.isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final SessionController session = widget.session;
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        final bool busy = session.busy;
        return N11FormScaffold(
          title: 'Đăng nhập',
          session: session,
          children: <Widget>[
            Center(child: BrandLogo(brand: widget.brand, height: 48)),
            _failureBanner(session),
            N11Field(fieldKey: const Key('login-phone'), label: 'Số điện thoại', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('login-password'),
              label: 'Mật khẩu',
              controller: _password,
              obscure: !_show,
              maxLength: 128,
              enabled: !busy,
              onChanged: () => setState(() {}),
              suffix: IconButton(tooltip: _show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)),
            ),
            N11Button(
              key: const Key('login-submit'),
              label: busy ? 'Đang đăng nhập…' : 'Đăng nhập',
              onPressed: busy || !_valid || !session.ready ? null : () => session.login(phone: _phone.text, password: _password.text),
            ),
            if (!session.ready) const ReasonNote(kNoServerReason),
            if (widget.reset != null)
              Center(
                child: TextButton(
                  key: const Key('to-reset'),
                  onPressed: busy ? null : () => Navigator.of(context).push(n11Route(ResetScreen(controller: widget.reset!, brand: widget.brand))),
                  child: const Text('Quên mật khẩu?', style: TextStyle(fontWeight: FontWeight.w700, color: N11Colors.yellowStrong)),
                ),
              )
            else
              ReasonNote(kNotOnAndroidReason),
            Center(
              child: TextButton(
                key: const Key('to-register'),
                onPressed: busy ? null : () => Navigator.of(context).pushReplacement(n11Route(RegisterScreen(session: session, brand: widget.brand))),
                child: const Text('Chưa có tài khoản? Đăng ký', style: TextStyle(fontWeight: FontWeight.w700, color: N11Colors.yellowStrong)),
              ),
            ),
          ],
        );
      },
    );
  }
}

// The two texts and the checkbox label are the ones the Owner approved for the pair of versions (same as
// apps/client-shared/src/consent.ts): they are not reworded here because the version identifies the text.
const String kTermsTitle = 'Điều khoản dùng thử';
const String kTermsText =
    'Đây là bản thử nghiệm 11Ship/11Food để kiểm tra đăng ký, đăng nhập và quản lý tài khoản. Chỉ sử dụng dữ liệu thử. Mã OTP được lấy từ công cụ SMS test trên máy tính, chưa gửi SMS đến điện thoại. Việc tạo tài khoản chưa kích hoạt cửa hàng hoặc quyền nhận đơn của tài xế.';
const String kPrivacyTitle = 'Thông tin dữ liệu thử nghiệm';
const String kPrivacyText =
    'Bản thử nghiệm lưu số điện thoại, tên bạn nhập, mật khẩu ở dạng băm, phiên đăng nhập và thời điểm/cặp phiên bản bạn chấp thuận để kiểm tra chức năng tài khoản. Không nhập thông tin nhạy cảm hoặc dùng mật khẩu đang dùng ở dịch vụ khác. Nội dung này chỉ dùng cho môi trường thử nghiệm, chưa phải chính sách phát hành chính thức.';
const String kConsentLabel = 'Tôi đồng ý với Điều khoản dùng thử và Thông tin dữ liệu thử nghiệm.';
const String kTestRegistrationNote = 'Bản test: tạm không xác minh số điện thoại';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.session, required this.brand});

  final SessionController session;
  final AppBrand brand;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _show = false;
  bool _agree = false;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_leaveWhenSignedIn);
    widget.session.loadRegistrationMode();
  }

  @override
  void dispose() {
    widget.session.removeListener(_leaveWhenSignedIn);
    widget.session.abandon();
    _phone.dispose();
    _name.dispose();
    _password.dispose();
    super.dispose();
  }

  void _leaveWhenSignedIn() {
    if (widget.session.status == SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  bool get _valid => _phone.text.trim().isNotEmpty && _name.text.trim().isNotEmpty && _password.text.length >= 8 && _agree;

  @override
  Widget build(BuildContext context) {
    final SessionController session = widget.session;
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        final bool busy = session.busy;
        final RegistrationMode mode = session.registrationMode;
        final bool open = mode == RegistrationMode.disabledTest && session.ready;
        return N11FormScaffold(
          title: 'Đăng ký',
          session: session,
          children: <Widget>[
            Center(child: BrandLogo(brand: widget.brand, height: 48)),
            if (mode == RegistrationMode.disabledTest) const N11Banner(key: Key('test-note'), kind: BannerKind.warn, title: kTestRegistrationNote, text: 'Tài khoản được tạo trực tiếp, không có mã OTP.'),
            if (mode == RegistrationMode.required)
              const N11Banner(key: Key('required-note'), kind: BannerKind.warn, title: 'Chưa hỗ trợ xác minh số điện thoại trên Android', text: 'Máy chủ đang yêu cầu mã OTP; bước này chưa được nối ở bản Android.'),
            if (mode == RegistrationMode.unknown && session.ready)
              N11Banner(
                key: const Key('config-unknown'),
                kind: BannerKind.warn,
                title: 'Chưa đọc được cấu hình đăng ký',
                text: 'Chưa thể đăng ký vì ứng dụng không đoán cách xác minh của máy chủ.',
                trailing: N11Button(key: const Key('reload-config'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: session.loadRegistrationMode),
              ),
            _failureBanner(session),
            N11Field(fieldKey: const Key('register-phone'), label: 'Số điện thoại', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(fieldKey: const Key('register-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('register-password'),
              label: 'Mật khẩu (8 đến 128 ký tự)',
              controller: _password,
              obscure: !_show,
              maxLength: 128,
              enabled: !busy,
              onChanged: () => setState(() {}),
              suffix: IconButton(tooltip: _show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu', icon: Icon(_show ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _show = !_show)),
            ),
            N11Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(kTermsTitle, style: N11Text.bodyStrong),
                  const SizedBox(height: N11Space.gap2),
                  const Text(kTermsText, key: Key('terms-text'), style: N11Text.caption),
                  const SizedBox(height: N11Space.gap3),
                  const Text(kPrivacyTitle, style: N11Text.bodyStrong),
                  const SizedBox(height: N11Space.gap2),
                  const Text(kPrivacyText, key: Key('privacy-text'), style: N11Text.caption),
                ],
              ),
            ),
            CheckboxListTile(
              key: const Key('register-consent'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _agree,
              onChanged: busy ? null : (bool? value) => setState(() => _agree = value ?? false),
              title: const Text(kConsentLabel, style: N11Text.body),
            ),
            N11Button(
              key: const Key('register-submit'),
              label: busy ? 'Đang đăng ký…' : 'Đăng ký',
              onPressed: busy || !open || !_valid ? null : () => session.register(phone: _phone.text, password: _password.text, fullName: _name.text),
            ),
            if (!session.ready) const ReasonNote(kNoServerReason),
            const ReasonNote('Tài khoản đăng ký ở đây là tài khoản khách hàng. Cửa hàng và hồ sơ xế chưa nối trên Android.'),
          ],
        );
      },
    );
  }
}

// ---- Own profile (F17) -----------------------------------------------------------------------------------------------

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.session});

  final SessionController session;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final TextEditingController _name = TextEditingController();
  String? _message;
  bool _messageOk = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_onSession);
    _load();
  }

  @override
  void dispose() {
    widget.session.removeListener(_onSession);
    _name.dispose();
    super.dispose();
  }

  void _onSession() {
    if (widget.session.status != SessionStatus.signedIn && mounted) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }

  Future<void> _load() async {
    await widget.session.loadProfile();
    if (!mounted) {
      return;
    }
    setState(() {
      _name.text = widget.session.profile?.fullName ?? '';
      _loading = false;
    });
  }

  Future<void> _save() async {
    final ProfileSave result = await widget.session.saveProfile(_name.text.trim());
    if (!mounted) {
      return;
    }
    setState(() {
      switch (result) {
        case ProfileSave.saved:
          _message = 'Đã lưu họ tên.';
          _messageOk = true;
          _name.text = widget.session.profile?.fullName ?? _name.text;
        case ProfileSave.conflict:
          _message = failureMessage(const AuthFailure(AuthFailureKind.versionConflict));
          _messageOk = false;
          _name.text = widget.session.profile?.fullName ?? '';
        case ProfileSave.unknown:
          _message = failureMessage(const AuthFailure(AuthFailureKind.unknownOutcome));
          _messageOk = false;
        case ProfileSave.failed:
          _message = widget.session.lastFailure == null ? 'Chưa lưu được. Vui lòng thử lại.' : failureMessage(widget.session.lastFailure!);
          _messageOk = false;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final SessionController session = widget.session;
    return ListenableBuilder(
      listenable: session,
      builder: (BuildContext context, Widget? child) {
        final bool dirty = _name.text.trim() != (session.profile?.fullName ?? '');
        return N11FormScaffold(
          title: 'Thông tin cá nhân',
          session: session,
          children: <Widget>[
            if (_loading) const N11Banner(kind: BannerKind.info, title: 'Đang tải hồ sơ…'),
            if (_message != null) N11Banner(key: const Key('profile-message'), kind: _messageOk ? BannerKind.success : BannerKind.error, title: _message!),
            N11Field(fieldKey: const Key('profile-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !session.busy && !_loading, onChanged: () => setState(() {})),
            Text('Số điện thoại: ${session.identity?.maskedPhone ?? ''}', style: N11Text.caption),
            N11Button(
              key: const Key('profile-save'),
              label: session.busy ? 'Đang lưu…' : 'Lưu',
              onPressed: session.busy || _loading || !dirty || _name.text.trim().isEmpty ? null : _save,
            ),
          ],
        );
      },
    );
  }
}
