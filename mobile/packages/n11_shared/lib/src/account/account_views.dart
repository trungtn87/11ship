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
      return 'Số điện thoại hoặc mật khẩu không đúng. Vui lòng thử lại.';
    case AuthFailureKind.sessionEnded:
      return 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
    case AuthFailureKind.deviceUnsupported:
      return 'Thiết bị này chưa hỗ trợ xác thực phần cứng nên chưa dùng được tài khoản trên bản Android này. (DEVICE_PROOF_UNSUPPORTED)';
    case AuthFailureKind.deviceProofRefused:
      return 'Máy chủ chưa xác nhận được thiết bị. Hãy kiểm tra giờ của điện thoại rồi thử lại.';
    case AuthFailureKind.serverUnavailable:
      return failure.outcomeUnknown
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
    failure != null && failure.outcomeUnknown;

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
  const AccountTab({super.key, required this.session, required this.brand, required this.actions, required this.entries, this.registerLabel = 'Tạo tài khoản', this.signedInEntries = const <Widget>[], this.signedInTitle = 'Cửa hàng', this.reset});

  final SessionController session;
  final ResetController? reset;

  /// Rows shown only while signed in (the shop / driver entry), before [entries].
  final List<Widget> signedInEntries;

  /// Heading of the [signedInEntries] group.
  final String signedInTitle;
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

  /// The welcome block of the design (f-welcome / s-welcome): big logo and the approved slogan.
  Widget _hero() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, N11Space.gap4, 0, N11Space.gap2),
      child: Column(
        children: <Widget>[
          BrandLogo(brand: brand, height: 96),
          const SizedBox(height: N11Space.gap3),
          Text(brand.slogan, textAlign: TextAlign.center, style: N11Text.display),
          const SizedBox(height: 6),
          Text(brand.id == AppId.food ? 'Đặt món từ quán gần bạn.' : 'Ứng dụng dành cho tài xế 11Ship.', textAlign: TextAlign.center, style: N11Text.lead),
        ],
      ),
    );
  }

  Widget _tools(BuildContext context, {required bool signedIn}) {
    return N11List(title: signedIn ? 'Cài đặt' : null, children: <Widget>[
      if (signedIn)
        N11ListItem(
          key: const Key('open-profile'),
          icon: Icons.badge_outlined,
          title: 'Thông tin cá nhân',
          sub: 'Xem và sửa họ tên',
          onTap: () => Navigator.of(context).push(n11Route(ProfileScreen(session: session))),
        ),
      ...entries,
      N11ListItem(icon: Icons.network_check, title: 'Chẩn đoán kết nối', sub: 'Kiểm tra kết nối với máy chủ', onTap: actions.openDiagnostics),
    ]);
  }

  Widget _guest(BuildContext context) {
    final bool ended = session.sessionEndedNotice;
    return vstack(<Widget>[
      if (ended)
        // Session ended: the "Phiên hết hạn / thiết bị khác" state of the design, then the same sign-in actions.
        const N11StateBlock(
          key: Key('session-ended'),
          kind: StateKind.warn,
          title: 'Phiên đăng nhập đã kết thúc',
          text: 'Tài khoản có thể đã đăng nhập trên thiết bị khác hoặc phiên đã hết hạn. Vì an toàn, vui lòng đăng nhập lại.',
        )
      else
        _hero(),
      if (session.loggedOutNotice)
        N11Banner(
          key: const Key('logged-out'),
          kind: session.logoutUnconfirmed ? BannerKind.warn : BannerKind.success,
          title: session.logoutUnconfirmed ? 'Đã đăng xuất trên máy này' : 'Đã đăng xuất',
          text: session.logoutUnconfirmed ? 'Chưa xác nhận được với máy chủ rằng phiên đã bị thu hồi (không có kết nối).' : 'Phiên đã được thu hồi trên máy chủ.',
        ),
      if (!session.ready) const ReasonNote(kNoServerReason),
      if (ended)
        N11Button(key: const Key('open-login'), label: 'Đăng nhập lại', onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset))) : null)
      else ...<Widget>[
        N11Button(key: const Key('open-register'), label: registerLabel, onPressed: session.ready ? () => Navigator.of(context).push(n11Route(RegisterScreen(session: session, brand: brand))) : null),
        N11Button(key: const Key('open-login'), label: 'Đăng nhập', kind: ButtonKind.secondary, onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset))) : null),
      ],
      const SizedBox(height: N11Space.gap1),
      _tools(context, signedIn: false),
    ]);
  }

  Widget _signedIn(BuildContext context) {
    final Identity? identity = session.identity;
    final String name = session.profile?.fullName ?? 'Chưa có tên';
    final List<String> roles = identity?.availableRoles ?? const <String>[];
    return vstack(<Widget>[
      N11AvatarCard(
        name: name,
        phone: identity?.maskedPhone ?? '',
        nameKey: const Key('account-name'),
        phoneKey: const Key('account-phone'),
        chips: <Widget>[
          const N11Chip('Khách hàng'),
          if (roles.contains('SHOP_OWNER')) const N11Chip('Chủ quán', kind: ChipKind.yellow),
          if (roles.contains('DRIVER')) const N11Chip('Tài xế', kind: ChipKind.dark),
        ],
      ),
      // Only what the phone knows: a live, server-checked session. It does not claim a verified phone number (the test build
      // registers without verification).
      const N11List(title: 'Trạng thái', children: <Widget>[
        N11ListItem(icon: Icons.check, title: 'Trạng thái tài khoản', sub: 'Phiên đăng nhập đang hoạt động trên máy này', trailing: N11Chip('Hoạt động', kind: ChipKind.ok)),
      ]),
      if (signedInEntries.isNotEmpty) N11List(title: signedInTitle, children: signedInEntries),
      _tools(context, signedIn: true),
      N11Button(key: const Key('open-logout'), label: 'Đăng xuất', kind: ButtonKind.secondary, onPressed: () => confirmLogout(context, session)),
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

class N11FormScaffold extends StatelessWidget {
  const N11FormScaffold({super.key, required this.title, required this.children, required this.session, this.background = N11Colors.bg});

  final String title;
  final List<Widget> children;
  final SessionController? session;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: background,
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
    title: failure.kind == AuthFailureKind.invalidCredentials ? 'Thông tin chưa đúng' : 'Chưa hoàn tất',
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
        final bool wrong = session.lastFailure?.kind == AuthFailureKind.invalidCredentials;
        return N11FormScaffold(
          title: 'Đăng nhập',
          session: session,
          children: <Widget>[
            N11Heading('Chào mừng trở lại', sub: widget.brand.id == AppId.food ? 'Đăng nhập để tiếp tục với 11Food.' : 'Đăng nhập tài khoản tài xế.'),
            _failureBanner(session),
            N11Field(fieldKey: const Key('login-phone'), label: 'Số điện thoại', placeholder: '0912 345 678', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('login-password'),
              label: 'Mật khẩu',
              controller: _password,
              password: true,
              maxLength: 128,
              enabled: !busy,
              tone: wrong ? FieldTone.error : FieldTone.normal,
              onChanged: () => setState(() {}),
            ),
            if (widget.reset != null)
              N11Link('Quên mật khẩu?', key: const Key('to-reset'), onPressed: busy ? null : () => Navigator.of(context).push(n11Route(ResetScreen(controller: widget.reset!, brand: widget.brand))))
            else
              ReasonNote(kNotOnAndroidReason),
            const SizedBox(height: N11Space.gap2),
            N11Button(
              key: const Key('login-submit'),
              label: busy ? 'Đang đăng nhập…' : 'Đăng nhập',
              loading: busy,
              onPressed: busy || !_valid || !session.ready ? null : () => session.login(phone: _phone.text, password: _password.text),
            ),
            if (!session.ready) const ReasonNote(kNoServerReason),
            N11Link('Chưa có tài khoản? Đăng ký', key: const Key('to-register'), onPressed: busy ? null : () {
              // The login form's refusal must not show on the register form.
              session.dismissNotices();
              Navigator.of(context).pushReplacement(n11Route(RegisterScreen(session: session, brand: widget.brand)));
            }),
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
        final bool taken = session.lastFailure?.kind == AuthFailureKind.phoneRegistered;
        final bool food = widget.brand.id == AppId.food;
        return N11FormScaffold(
          title: 'Đăng ký',
          session: session,
          children: <Widget>[
            N11Heading(food ? 'Tạo tài khoản 11Food' : 'Tạo tài khoản 11Ship', sub: food ? 'Tài khoản khách hàng dùng để đặt món.' : 'Tài khoản khách hàng; hồ sơ xế gửi sau trong mục Tài khoản.'),
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
            N11Field(
              fieldKey: const Key('register-phone'),
              label: 'Số điện thoại',
              placeholder: '0912 345 678',
              controller: _phone,
              keyboard: TextInputType.phone,
              maxLength: 20,
              enabled: !busy,
              tone: taken ? FieldTone.error : FieldTone.normal,
              hint: taken ? 'Số điện thoại này đã có tài khoản.' : null,
              onChanged: () => setState(() {}),
            ),
            N11Field(fieldKey: const Key('register-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !busy, onChanged: () => setState(() {})),
            N11Field(
              fieldKey: const Key('register-password'),
              label: 'Mật khẩu',
              controller: _password,
              password: true,
              maxLength: 128,
              enabled: !busy,
              hint: 'Dùng từ 8 đến 128 ký tự.',
              onChanged: () => setState(() {}),
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
              activeColor: N11Colors.yellow,
              checkColor: N11Colors.black,
              side: const BorderSide(color: N11Colors.lineStrong, width: 2),
              value: _agree,
              onChanged: busy ? null : (bool? value) => setState(() => _agree = value ?? false),
              title: const Text(kConsentLabel, style: N11Text.body),
            ),
            N11Banner(
              kind: BannerKind.info,
              title: food ? 'Muốn mở quán?' : 'Muốn nhận đơn giao?',
              text: food
                  ? 'Mở Quản lý cửa hàng sau khi đăng ký, trong mục Tài khoản. Bạn vẫn giữ vai trò khách hàng.'
                  : 'Gửi hồ sơ xế sau khi đăng ký, trong mục Tài khoản. Bạn vẫn giữ vai trò khách hàng; nhận đơn chưa mở.',
            ),
            N11Button(
              key: const Key('register-submit'),
              label: busy ? 'Đang đăng ký…' : 'Hoàn tất đăng ký',
              loading: busy,
              onPressed: busy || !open || !_valid ? null : () => session.register(phone: _phone.text, password: _password.text, fullName: _name.text),
            ),
            if (!session.ready) const ReasonNote(kNoServerReason),
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
            const N11Heading('Thông tin cá nhân', sub: 'Xem và sửa họ tên hiển thị trên tài khoản.'),
            if (_loading) const N11Banner(kind: BannerKind.info, title: 'Đang tải hồ sơ…'),
            if (_message != null) N11Banner(key: const Key('profile-message'), kind: _messageOk ? BannerKind.success : BannerKind.error, title: _message!),
            N11Field(fieldKey: const Key('profile-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !session.busy && !_loading, onChanged: () => setState(() {})),
            Text('Số điện thoại: ${session.identity?.maskedPhone ?? ''}', key: const Key('profile-phone'), style: N11Text.caption),
            N11Button(
              key: const Key('profile-save'),
              label: session.busy ? 'Đang lưu…' : 'Lưu',
              loading: session.busy,
              onPressed: session.busy || _loading || !dirty || _name.text.trim().isEmpty ? null : _save,
            ),
          ],
        );
      },
    );
  }
}
