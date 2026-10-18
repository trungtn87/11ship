import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../brand.dart';
import '../features.dart';
import '../shell.dart';
import '../tokens.dart';
import '../widgets/components.dart';
import '../flows/shop_controller.dart';
import '../flows/shop_views.dart';
import '../flows/reset_controller.dart';
import '../flows/reset_views.dart';
import 'models.dart';
import 'api_client.dart';
import 'phone_verification.dart';
import 'otp_input.dart';
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
      return 'Tài khoản này đang bị khóa. Nếu bạn đã yêu cầu xóa tài khoản, hãy đăng ký lại bằng số điện thoại này để khôi phục (cần mã SMS). Nếu không, vui lòng liên hệ hỗ trợ.';
    case AuthFailureKind.accountRecoverable:
      return 'Số điện thoại này thuộc một tài khoản đã khóa theo yêu cầu xóa. Hãy khôi phục tài khoản: xác minh mã SMS và đặt mật khẩu mới.';
    case AuthFailureKind.passwordResetDisabled:
      return 'Chức năng tự đặt lại mật khẩu đang tạm khóa. Vui lòng liên hệ hỗ trợ.';
    case AuthFailureKind.verificationModeChanged:
      return 'Cách xác minh số điện thoại vừa thay đổi. Hãy tải lại màn hình đăng ký rồi thử lại.';
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
    case AuthFailureKind.otpInvalid:
      return 'Mã xác minh chưa đúng, hoặc tin nhắn chưa được gửi đi. Kiểm tra lại mã trong tin nhắn.';
    case AuthFailureKind.otpExpired:
      return 'Mã xác minh đã hết hạn. Hãy gửi mã mới.';
    case AuthFailureKind.otpAlreadyUsed:
      return 'Mã xác minh này đã được dùng hoặc bị khóa. Hãy gửi mã mới.';
    case AuthFailureKind.proofInvalid:
      return 'Xác minh số điện thoại không còn hiệu lực. Hãy xác minh lại.';
  }
}

bool canRetryFailure(AuthFailure? failure) =>
    failure != null && failure.outcomeUnknown;

Route<void> n11Route(Widget screen) => MaterialPageRoute<void>(builder: (BuildContext context) => screen);

/// The guest prompt of Home / Orders: sends the person to the real login screen (guests open Home first, signing in is chosen in
/// Tài khoản or here).
class GuestPrompt extends StatelessWidget {
  const GuestPrompt({super.key, required this.session, required this.brand, required this.text, this.reset, this.shop});

  final SessionController session;
  final ResetController? reset;
  final ShopController? shop;
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
              ? N11Button(key: const Key('guest-login'), label: 'Đăng nhập', kind: ButtonKind.secondary, compact: true, onPressed: () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset, shop: shop))))
              : const ReasonNote(kNoServerReason),
        );
      },
    );
  }
}

/// Tài khoản: guest, checking, unverified and signed-in states of one app. [entries] are that app's own rows (shop / driver entry,
/// help, policy), shown for guests and signed-in people alike and kept locked with their reason.
class AccountTab extends StatelessWidget {
  const AccountTab({super.key, required this.session, required this.brand, required this.actions, required this.entries, this.registerLabel = 'Tạo tài khoản', this.signedInEntries = const <Widget>[], this.signedInTitle = 'Cửa hàng', this.reset, this.shop, this.showAccountStatus = true, this.showDiagnostics = true, this.settingsEntries = const <Widget>[]});

  final SessionController session;
  final ResetController? reset;
  final ShopController? shop;

  /// Rows shown only while signed in (the shop / driver entry), before [entries].
  final List<Widget> signedInEntries;

  /// Heading of the [signedInEntries] group.
  final String signedInTitle;
  final AppBrand brand;
  final ShellActions actions;
  final List<Widget> entries;
  final String registerLabel;
  final bool showAccountStatus;
  final bool showDiagnostics;
  final List<Widget> settingsEntries;

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
          Text(brand.id == AppId.food ? 'Đặt món từ quán gần bạn.' : 'Ứng dụng dành cho shipper 11Ship.', textAlign: TextAlign.center, style: N11Text.lead),
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
      if (signedIn) ...settingsEntries,
      if (signedIn && brand.id == AppId.food)
        N11ListItem(key: const Key('change-password-entry'), icon: Icons.lock_outline, title: 'Đổi mật khẩu', onTap: () => Navigator.of(context).push(n11Route(ChangePasswordScreen(session: session)))),
      if (signedIn && brand.id == AppId.food && shop != null && session.identity?.availableRoles.contains('SHOP_OWNER') != true)
        N11ListItem(key: const Key('shop-entry'), icon: Icons.storefront_outlined, title: 'Đăng ký mở quán', sub: 'Gửi hồ sơ để được xét duyệt.', onTap: () => Navigator.of(context).push(n11Route(ShopStartScreen(controller: shop!)))),
      ...entries,
      if (showDiagnostics && brand.id != AppId.food) N11ListItem(icon: Icons.network_check, title: 'Chẩn đoán kết nối', sub: 'Kiểm tra kết nối với máy chủ', onTap: actions.openDiagnostics),
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
        N11Button(key: const Key('open-login'), label: 'Đăng nhập lại', onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset, shop: shop))) : null)
      else ...<Widget>[
        N11Button(key: const Key('open-register'), label: registerLabel, onPressed: session.ready ? () => Navigator.of(context).push(n11Route(RegisterScreen(session: session, brand: brand, shop: shop))) : null),
        N11Button(key: const Key('open-login'), label: 'Đăng nhập', kind: ButtonKind.secondary, onPressed: session.ready ? () => Navigator.of(context).push(n11Route(LoginScreen(session: session, brand: brand, reset: reset, shop: shop))) : null),
      ],
      const SizedBox(height: N11Space.gap1),
      _tools(context, signedIn: false),
    ]);
  }

  Widget _signedIn(BuildContext context) {
    final Identity? identity = session.identity;
    final String name = session.profile?.fullName ?? 'Chưa có tên';
    final List<String> roles = identity?.availableRoles ?? const <String>[];
    final bool locked = identity?.lockedWalletOnly ?? false;
    return vstack(<Widget>[
      N11AvatarCard(
        name: name,
        phone: identity?.maskedPhone ?? '',
        nameKey: const Key('account-name'),
        phoneKey: const Key('account-phone'),
        chips: <Widget>[
          const N11Chip('Khách hàng'),
          if (roles.contains('SHOP_OWNER')) const N11Chip('Chủ quán', kind: ChipKind.yellow),
          if (roles.contains('DRIVER')) const N11Chip('Shipper', kind: ChipKind.dark),
        ],
      ),
      // Only what the phone knows: a live, server-checked session. It does not claim a verified phone number (an account registered while
      // SYSTEM had the registration OTP off has an unverified one).
      if (locked)
        // A locked driver keeps the wallet and nothing else (Owner decision 2026-10-14): no new orders, no other function.
        const N11Banner(
          key: Key('locked-wallet-only'),
          kind: BannerKind.warn,
          title: 'Tài khoản đã khóa',
          text: 'Bạn không nhận đơn mới và không dùng các chức năng giao hàng. Bạn vẫn xem được số dư ví, lịch sử giao dịch và gửi yêu cầu rút tiền theo điều kiện hiện hành khi mục Ví mở.',
        )
      else if (showAccountStatus && brand.id != AppId.food)
        const N11List(title: 'Trạng thái', children: <Widget>[
          N11ListItem(icon: Icons.check, title: 'Trạng thái tài khoản', sub: 'Phiên đăng nhập đang hoạt động trên máy này', trailing: N11Chip('Hoạt động', kind: ChipKind.ok)),
        ]),
      if (signedInEntries.isNotEmpty && !locked) N11List(title: signedInTitle, children: signedInEntries),
      if (brand.id == AppId.food && !locked)
        N11List(title: 'Ưu đãi', children: <Widget>[
          N11ListItem(key: const Key('voucher-entry'), icon: Icons.local_offer_outlined, title: 'Voucher của tôi', onTap: () => Navigator.of(context).push(n11Route(VoucherScreen(session: session)))),
        ]),
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
  const N11FormScaffold({super.key, required this.title, required this.children, required this.session, this.background = N11Colors.bg, this.onBack});

  final String title;
  final List<Widget> children;
  final SessionController? session;
  final Color background;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: background,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            N11AppBar(title: title, onBack: onBack ?? () => Navigator.of(context).maybePop()),
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
    text: failureMessage(failure) + (failure.diagnostic == null ? '' : '\n${failure.diagnostic}'),
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
  const LoginScreen({super.key, required this.session, required this.brand, this.reset, this.shop});

  final SessionController session;
  final AppBrand brand;

  /// The forgotten-password flow (public, no proof). Null = not wired in this build.
  final ResetController? reset;
  final ShopController? shop;

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
            N11Heading('Chào mừng trở lại', sub: widget.brand.id == AppId.food ? 'Đăng nhập để tiếp tục với 11Food.' : 'Đăng nhập tài khoản shipper.'),
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
              Navigator.of(context).pushReplacement(n11Route(RegisterScreen(session: session, brand: widget.brand, shop: widget.shop)));
            }),
          ],
        );
      },
    );
  }
}

// The two texts and the checkbox label identify the pair of versions kConsentTermsVersion / kConsentPrivacyVersion (same as
// apps/client-shared/src/consent.ts and docs/current/M01-terms-privacy-20261014.md): they are not reworded here without a new
// version. They describe what the app really does today and nothing it does not do yet.
const String kTermsTitle = 'Điều khoản sử dụng';
const String kTermsText =
    'Bạn dùng 11Food/11Ship đúng pháp luật, cung cấp thông tin đúng sự thật và tự giữ bí mật mật khẩu. Tài khoản gắn với số điện thoại bạn xác minh bằng mã SMS. Hiện ứng dụng có đăng ký, đăng nhập, hồ sơ cá nhân và gửi hồ sơ quán hoặc hồ sơ shipper; đặt món, giao hàng, ví và doanh thu chưa hoạt động. Tạo tài khoản hoặc gửi hồ sơ chưa mở quyền bán hàng hay nhận đơn: quyền đó chỉ có sau khi hồ sơ được duyệt. 11Ship có thể khóa tài khoản khi phát hiện gian lận hoặc vi phạm điều khoản.';
const String kPrivacyTitle = 'Chính sách quyền riêng tư';
const String kPrivacyText =
    '11Ship lưu số điện thoại, họ tên, mật khẩu ở dạng mã hóa một chiều, phiên đăng nhập, thông tin xác thực thiết bị Android để bảo vệ tài khoản, và thời điểm cùng phiên bản bạn đã chấp thuận. Mã xác minh được gửi bằng tin nhắn SMS tới số bạn nhập. Khi bạn tạo hồ sơ quán, ứng dụng chỉ lấy vị trí một lần lúc bạn bấm nút để ghi vị trí quán; ứng dụng không theo dõi vị trí nền. Hồ sơ Shipper có thể bao gồm họ tên, số điện thoại, biển số xe và thông tin tài khoản ngân hàng. Thông tin ngân hàng được sử dụng để xác minh chủ tài khoản và phục vụ các nghiệp vụ thanh toán liên quan. Thông tin này không được công khai cho khách hàng, chủ quán hoặc Shipper khác. Dữ liệu dùng để vận hành, bảo mật và hỗ trợ tài khoản.';
const String kConsentLabel = 'Tôi đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư.';

/// The same two texts, readable without an account (Tài khoản -> Chính sách và điều khoản). Static: it sends nothing.
class PolicyScreen extends StatelessWidget {
  const PolicyScreen({super.key, required this.session});

  final SessionController session;

  @override
  Widget build(BuildContext context) {
    return N11FormScaffold(
      title: 'Chính sách và điều khoản',
      session: session,
      children: const <Widget>[
        N11Card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(kTermsTitle, style: N11Text.bodyStrong),
              SizedBox(height: N11Space.gap2),
              Text(kTermsText, key: Key('policy-terms'), style: N11Text.caption),
              SizedBox(height: N11Space.gap3),
              Text(kPrivacyTitle, style: N11Text.bodyStrong),
              SizedBox(height: N11Space.gap2),
              Text(kPrivacyText, key: Key('policy-privacy'), style: N11Text.caption),
            ],
          ),
        ),
      ],
    );
  }
}

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.session, required this.brand, this.shop});

  final SessionController session;
  final AppBrand brand;
  final ShopController? shop;

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _otpPage = false;
  bool get _ship => widget.brand.id == AppId.ship;
  final TextEditingController _code = TextEditingController();
  late final PhoneVerificationController _otp = PhoneVerificationController(transport: widget.session.api.transport);
  Timer? _tick;
  bool _agree = false;
  int _step = 0;
  bool? _owner;
  bool _leaving = false;

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_leaveWhenSignedIn);
    _otp.addListener(_otpChanged);
    widget.session.loadRegistrationMode();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _otp.removeListener(_otpChanged);
    _otp.dispose();
    widget.session.removeListener(_leaveWhenSignedIn);
    widget.session.abandon();
    _phone.dispose();
    _name.dispose();
    _password.dispose();
    _confirm.dispose();
    _code.dispose();
    super.dispose();
  }

  /// A timer exists only while the "send again" button is locked, so an idle screen schedules nothing.
  void _otpChanged() {
    if (_tick == null && !_otp.canResend && _otp.step != OtpStep.verified) {
      _tick = Timer.periodic(const Duration(seconds: 1), (Timer timer) {
        if (!mounted || _otp.canResend || _otp.step == OtpStep.verified) {
          timer.cancel();
          _tick = null;
        }
        if (mounted) {
          setState(() {});
        }
      });
    }
  }

  /// The proof belongs to ONE number: editing the phone drops the challenge and the proof.
  void _phoneEdited() {
    final String? requestedFor = _otp.phone;
    if (requestedFor != null && requestedFor != _phone.text.trim()) {
      _otp.reset();
      _code.clear();
    }
    setState(() {});
  }

  Future<void> _completeOtp() async {
    if (await _otp.verify(_code.text) && mounted && _otpPage && _valid) {
      await widget.session.register(phone: _phone.text, password: _password.text, fullName: _name.text, verificationToken: _otp.token);
    }
  }

  List<Widget> _otpSection(bool busy) {
    final bool verified = _otp.step == OtpStep.verified;
    final AuthFailure? failure = _otp.failure;
    final String? note = switch (_otp.delivery) {
      OtpDelivery.failed => 'Không gửi được tin nhắn. Hãy gửi lại mã.',
      OtpDelivery.expired => 'Mã đã hết hạn hoặc chưa gửi được. Hãy gửi lại mã.',
      OtpDelivery.uncertain => 'Chưa chắc tin nhắn đã đến. Nếu bạn đã nhận được mã, hãy nhập; nếu không, hãy gửi lại.',
      OtpDelivery.closed => 'Mã này không dùng được nữa. Hãy gửi mã mới.',
      _ => null,
    };
    if (_ship) {
      return <Widget>[
        if (verified)
          const N11Banner(key: Key('otp-verified'), kind: BannerKind.success, title: 'Đã xác minh số điện thoại')
        else ...<Widget>[
          if (failure != null) N11Banner(key: const Key('otp-error'), kind: BannerKind.error, title: 'Chưa xác minh được', text: failureMessage(failure)),
          if (_otp.step == OtpStep.waiting) const N11Banner(key: Key('otp-waiting'), kind: BannerKind.info, title: 'Đang gửi tin nhắn…', text: 'Bạn có thể nhập mã khi tin nhắn đã được gửi.'),
          if (note != null) N11Banner(key: const Key('otp-note'), kind: BannerKind.warn, title: 'Lưu ý', text: note),
          RegistrationOtpInput(controller: _code, enabled: !busy && _otp.step == OtpStep.sent, onChanged: () => setState(() {})),
          N11Button(
            key: const Key('otp-verify'),
            label: _otp.step == OtpStep.verifying ? 'Đang kiểm tra…' : 'Xác nhận mã',
            loading: _otp.step == OtpStep.verifying,
            onPressed: busy || _otp.step != OtpStep.sent || _code.text.length != 6 ? null : _completeOtp,
          ),
          const Text('Không nhận được mã?', textAlign: TextAlign.center, style: N11Text.caption),
          N11Link(
            _otp.step == OtpStep.requesting ? 'Đang gửi…' : 'Gửi lại mã',
            key: const Key('otp-request'),
            onPressed: busy || !_otp.canResend ? null : () => _otp.request(_phone.text),
          ),
          if (!_otp.canResend && _otp.resendSeconds > 0)
            Text('Gửi lại sau ${_otp.resendSeconds} giây', key: const Key('otp-resend-countdown'), textAlign: TextAlign.center, style: N11Text.caption),
        ],
      ];
    }
    return <Widget>[
      if (verified)
        const N11Banner(key: Key('otp-verified'), kind: BannerKind.success, title: 'Đã xác minh số điện thoại')
      else ...<Widget>[
        const N11Banner(key: Key('required-note'), kind: BannerKind.info, title: 'Xác minh số điện thoại', text: 'Mã gồm 6 số được gửi bằng tin nhắn SMS đến số điện thoại đăng ký.'),
        if (failure != null) N11Banner(key: const Key('otp-error'), kind: BannerKind.error, title: 'Chưa xác minh được', text: failureMessage(failure)),
        if (note != null && _otp.step == OtpStep.idle) N11Banner(key: const Key('otp-note'), kind: BannerKind.warn, title: 'Mã chưa dùng được', text: note),
        if (_otp.step == OtpStep.waiting) const N11Banner(key: Key('otp-waiting'), kind: BannerKind.info, title: 'Đang gửi tin nhắn…', text: 'Vui lòng đợi, chưa nhập mã khi tin nhắn chưa được gửi đi.'),
        if (_otp.step == OtpStep.sent && note != null) N11Banner(key: const Key('otp-note'), kind: BannerKind.warn, title: 'Lưu ý', text: note),
        N11Button(
          key: const Key('otp-request'),
          label: !_otp.canResend && !_otp.busy ? 'Gửi lại sau ${_otp.resendSeconds} giây' : _otp.step == OtpStep.requesting ? 'Đang gửi…' : (_otp.step == OtpStep.idle && _otp.phone == null ? 'Gửi mã xác minh' : 'Gửi lại mã'),
          kind: ButtonKind.secondary,
          loading: _otp.step == OtpStep.requesting,
          onPressed: busy || _phone.text.trim().isEmpty || !_otp.canResend ? null : () => _otp.request(_phone.text),
        ),
        if (_otp.canEnterCode) ...<Widget>[
          N11Field(fieldKey: const Key('otp-code'), label: 'Mã xác minh', placeholder: '6 số', controller: _code, keyboard: TextInputType.number, maxLength: 6, enabled: _otp.step == OtpStep.sent, onChanged: () => setState(() {})),
          N11Button(
            key: const Key('otp-verify'),
            label: _otp.step == OtpStep.verifying ? 'Đang kiểm tra…' : 'Xác nhận mã',
            loading: _otp.step == OtpStep.verifying,
            onPressed: _otp.step != OtpStep.sent || !RegExp(r'^\d{6}$').hasMatch(_code.text.trim()) ? null : () => _otp.verify(_code.text),
          ),
        ],
      ],
    ];
  }

  /// The recovery flow: its own controller and wording, the same public routes family; OTP is always required.
  void _openRecovery(BuildContext context) {
    final ResetController recovery = ResetController(transport: widget.session.api.transport, session: widget.session, endpoints: ResetEndpoints.recover);
    Navigator.of(context).push(n11Route(ResetScreen(controller: recovery, brand: widget.brand, recovery: true)));
  }

  void _leaveWhenSignedIn() {
    if (widget.session.status == SessionStatus.signedIn && mounted && !_leaving) {
      _leaving = true;
      final NavigatorState navigator = Navigator.of(context);
      navigator.popUntil((Route<dynamic> route) => route.isFirst);
      if (widget.brand.id == AppId.food && _owner == true && widget.shop != null) {
        navigator.push(n11Route(ShopStartScreen(controller: widget.shop!)));
      }
    }
  }

  Widget _termsCard() => N11Card(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Text(kTermsTitle, style: N11Text.bodyStrong),
        const SizedBox(height: N11Space.gap2),
        const Text(kTermsText, key: Key('terms-text'), style: N11Text.caption),
        const SizedBox(height: N11Space.gap3),
        Text(_ship ? 'Chính sách bảo mật' : kPrivacyTitle, style: N11Text.bodyStrong),
        const SizedBox(height: N11Space.gap2),
        const Text(kPrivacyText, key: Key('privacy-text'), style: N11Text.caption),
      ],
    ),
  );

  bool get _valid {
    final bool basic = _phone.text.trim().isNotEmpty &&
        _name.text.trim().isNotEmpty && _agree;
    if (!_ship) return basic && _password.text.length >= 8;
    final int length = _password.text.runes.length;
    return basic &&
        RegExp(r'^(?:\+84|84|0)[0-9]{9}$').hasMatch(_phone.text.trim()) &&
        _name.text.trim().runes.length <= 120 &&
        length >= 8 && length <= 128 &&
        _confirm.text == _password.text;
  }

  bool get _detailsValid => _name.text.trim().isNotEmpty && _password.text.runes.length >= 8 && _password.text.runes.length <= 128 && _password.text == _confirm.text && _agree;

  Widget _foodForm(SessionController session, bool busy, bool open, bool taken) {
    final bool locked = busy || _otp.busy || session.pending != null;
    void back() {
      if (locked) return;
      if (_step > 0) { setState(() => _step--); } else { Navigator.of(context).maybePop(); }
    }
    return PopScope(
      canPop: _step == 0 && !locked,
      onPopInvokedWithResult: (bool didPop, Object? result) { if (!didPop) back(); },
      child: N11FormScaffold(
        title: 'Đăng ký · ${_step + 1}/3', session: session, onBack: back,
        children: <Widget>[
          N11Heading(<String>['Tạo tài khoản', 'Mục đích sử dụng', 'Số điện thoại & OTP'][_step]),
          if (session.lastFailure?.kind == AuthFailureKind.accountRecoverable || _otp.failure?.kind == AuthFailureKind.accountRecoverable)
            N11Banner(
              key: const Key('recover-account'),
              kind: BannerKind.warn,
              title: 'Tài khoản này đã khóa theo yêu cầu xóa',
              text: 'Số điện thoại này thuộc một tài khoản cũ. Bạn có thể khôi phục: xác minh mã SMS rồi đặt mật khẩu mới. Dữ liệu cũ được giữ nguyên.',
              trailing: N11Button(key: const Key('recover-open'), label: 'Khôi phục tài khoản', compact: true, onPressed: locked ? null : () => _openRecovery(context)),
            )
          else
            _failureBanner(session),
          if (_step == 2 && session.registrationMode == RegistrationMode.notRequired)
            const N11Banner(
              key: Key('not-required-note'),
              kind: BannerKind.info,
              title: 'Đăng ký không cần mã xác minh',
              text: 'Số điện thoại sẽ ở trạng thái chưa xác minh. Hãy nhập đúng số của bạn: số này dùng để đăng nhập và khôi phục tài khoản.',
            ),
          if (_step == 0) ...<Widget>[
            N11Field(fieldKey: const Key('register-name'), label: 'Họ và tên', controller: _name, maxLength: 120, enabled: !locked, onChanged: () => setState(() {})),
            N11Field(fieldKey: const Key('register-password'), label: 'Mật khẩu', controller: _password, password: true, maxLength: 128, enabled: !locked, hint: 'Dùng từ 8 đến 128 ký tự.', onChanged: () => setState(() {})),
            N11Field(fieldKey: const Key('register-confirm'), label: 'Nhập lại mật khẩu', controller: _confirm, password: true, maxLength: 128, enabled: !locked, hint: _confirm.text.isNotEmpty && _confirm.text != _password.text ? 'Mật khẩu chưa khớp.' : null, tone: _confirm.text.isNotEmpty && _confirm.text != _password.text ? FieldTone.error : FieldTone.normal, onChanged: () => setState(() {})),
            const N11Card(child: SizedBox(height: 140, child: SingleChildScrollView(key: Key('consent-scroll'), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
              Text(kTermsTitle, style: N11Text.bodyStrong), Text(kTermsText, key: Key('terms-text'), style: N11Text.caption), SizedBox(height: 12),
              Text(kPrivacyTitle, style: N11Text.bodyStrong), Text(kPrivacyText, key: Key('privacy-text'), style: N11Text.caption),
            ])))),
            CheckboxListTile(key: const Key('register-consent'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, activeColor: N11Colors.yellow, checkColor: N11Colors.black, value: _agree, onChanged: locked ? null : (bool? value) => setState(() => _agree = value ?? false), title: const Text(kConsentLabel, style: N11Text.body)),
            N11Button(key: const Key('register-next'), label: 'Tiếp tục', onPressed: !locked && _detailsValid ? () => setState(() => _step = 1) : null),
          ],
          if (_step == 1) ...<Widget>[
            for (final bool owner in <bool>[false, true])
              N11Card(child: Material(color: Colors.transparent, child: ListTile(key: Key(owner ? 'purpose-owner' : 'purpose-customer'), selected: _owner == owner, selectedTileColor: N11Colors.yellow.withValues(alpha: 0.2), leading: Icon(owner ? Icons.storefront_outlined : Icons.person_outline), title: Text(owner ? 'Chủ quán' : 'Khách hàng'), subtitle: Text(owner ? 'Gửi hồ sơ đăng ký quán sau khi xác minh. Chỉ bán hàng sau khi được duyệt.' : 'Tìm quán và đặt món khi tính năng sẵn sàng.'), trailing: Icon(_owner == owner ? Icons.radio_button_checked : Icons.radio_button_off), onTap: locked ? null : () => setState(() => _owner = owner)))),
            const ReasonNote('Bạn luôn là khách hàng và có thể đăng ký mở quán trong mục Tài khoản theo luồng hồ sơ hiện có.'),
            N11Button(key: const Key('purpose-next'), label: 'Tiếp tục', onPressed: !locked && _owner != null ? () => setState(() => _step = 2) : null),
          ],
          if (_step == 2) ...<Widget>[
            N11Field(fieldKey: const Key('register-phone'), label: 'Số điện thoại', placeholder: '0912 345 678', controller: _phone, keyboard: TextInputType.phone, maxLength: 20, enabled: !locked && _otp.phone == null, tone: taken ? FieldTone.error : FieldTone.normal, hint: taken ? 'Số điện thoại này đã có tài khoản.' : null, onChanged: _phoneEdited),
            if (_otp.phone != null) N11Link('Đổi số điện thoại', key: const Key('otp-change-phone'), onPressed: locked ? null : () { _otp.reset(); _code.clear(); setState(() {}); }),
            if (session.registrationMode == RegistrationMode.required) ..._otpSection(locked),
            if (session.registrationMode == RegistrationMode.unknown) N11Banner(kind: BannerKind.warn, title: 'Chưa đọc được cấu hình đăng ký', trailing: N11Button(label: 'Thử lại', onPressed: session.loadRegistrationMode)),
            N11Button(key: const Key('register-submit'), label: busy ? 'Đang đăng ký…' : 'Hoàn tất đăng ký', loading: busy, onPressed: locked || !open || !_detailsValid || _owner == null ? null : () => session.register(phone: _phone.text, password: _password.text, fullName: _name.text, verificationToken: _otp.token)),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final SessionController session = widget.session;
    return ListenableBuilder(
      listenable: Listenable.merge(<Listenable>[session, _otp]),
      builder: (BuildContext context, Widget? child) {
        final bool busy = session.busy;
        final RegistrationMode mode = session.registrationMode;
        // With the SMS proof the submit needs the verified code; when SYSTEM turned the registration OTP off there is no code step.
        final bool open = session.ready && ((mode == RegistrationMode.required && _otp.token != null) || mode == RegistrationMode.notRequired);
        final bool taken = session.lastFailure?.kind == AuthFailureKind.phoneRegistered;
        // A phone that belongs to an account locked at its owner's request is recovered, never registered again.
        final bool recoverable = session.lastFailure?.kind == AuthFailureKind.accountRecoverable || _otp.failure?.kind == AuthFailureKind.accountRecoverable;
        final bool food = widget.brand.id == AppId.food;
        if (_ship && _otpPage) {
          void back() => setState(() => _otpPage = false);
          return PopScope(
            canPop: false,
            onPopInvokedWithResult: (bool didPop, Object? result) {
              if (!didPop && !busy && !_otp.busy) back();
            },
            child: N11FormScaffold(
              title: 'Xác thực số điện thoại',
              background: N11Colors.white,
              session: session,
              onBack: busy || _otp.busy ? () {} : back,
              children: <Widget>[
                const Text('Bước 2/2 · Nhập mã OTP gồm 6 số được gửi qua SMS đến', textAlign: TextAlign.center, style: N11Text.lead),
                Text(_phone.text.trim(), key: const Key('register-otp-phone'), textAlign: TextAlign.center, style: N11Text.h2),
                N11Link('Sửa số điện thoại', key: const Key('register-edit-phone'), onPressed: busy || _otp.busy ? null : back),
                _failureBanner(session),
                ..._otpSection(busy),
                if (_otp.token != null)
                  N11Button(
                    key: const Key('register-submit'),
                    label: busy ? 'Đang đăng ký…' : 'Hoàn tất đăng ký',
                    loading: busy,
                    onPressed: busy || !_valid ? null : () => session.register(phone: _phone.text, password: _password.text, fullName: _name.text, verificationToken: _otp.token),
                  ),
              ],
            ),
          );
        }
        if (food) return _foodForm(session, busy, open, taken);
        return N11FormScaffold(
          title: 'Đăng ký',
          background: _ship ? N11Colors.white : N11Colors.bg,
          session: session,
          children: <Widget>[
            N11Heading(food ? 'Tạo tài khoản 11Food' : 'Đăng ký shipper', sub: food ? 'Tài khoản khách hàng dùng để đặt món.' : 'Bước 1/2 · Tạo tài khoản để bắt đầu cùng 11Ship', size: _ship ? 22 : null),
            if (mode == RegistrationMode.unknown && session.ready)
              N11Banner(
                key: const Key('config-unknown'),
                kind: BannerKind.warn,
                title: 'Chưa đọc được cấu hình đăng ký',
                text: 'Chưa thể đăng ký vì ứng dụng không đoán cách xác minh của máy chủ.',
                trailing: N11Button(key: const Key('reload-config'), label: 'Thử lại', compact: true, kind: ButtonKind.secondary, onPressed: session.loadRegistrationMode),
              ),
            if (mode == RegistrationMode.notRequired)
              const N11Banner(
                key: Key('not-required-note'),
                kind: BannerKind.info,
                title: 'Đăng ký không cần mã xác minh',
                text: 'Số điện thoại sẽ ở trạng thái chưa xác minh. Hãy nhập đúng số của bạn: số này dùng để đăng nhập và khôi phục tài khoản.',
              ),
            if (recoverable)
              N11Banner(
                key: const Key('recover-account'),
                kind: BannerKind.warn,
                title: 'Tài khoản này đã khóa theo yêu cầu xóa',
                text: 'Số điện thoại này thuộc một tài khoản cũ. Bạn có thể khôi phục: xác minh mã SMS rồi đặt mật khẩu mới. Dữ liệu cũ được giữ nguyên.',
                trailing: N11Button(key: const Key('recover-open'), label: 'Khôi phục tài khoản', compact: true, onPressed: busy ? null : () => _openRecovery(context)),
              )
            else
              _failureBanner(session),
            N11Field(
              fieldKey: const Key('register-phone'),
              label: 'Số điện thoại',
              placeholder: '0912345678',
              controller: _phone,
              keyboard: TextInputType.phone,
              maxLength: 20,
              enabled: !busy,
              tone: taken ? FieldTone.error : FieldTone.normal,
              hint: taken ? 'Số điện thoại này đã có tài khoản.' : null,
              onChanged: _phoneEdited,
            ),
            if (!_ship && mode == RegistrationMode.required) ..._otpSection(busy),
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
            if (_ship)
              N11Field(fieldKey: const Key('register-confirm-password'), label: 'Nhập lại mật khẩu', controller: _confirm, password: true, maxLength: 128, enabled: !busy, hint: _confirm.text.isNotEmpty && _confirm.text != _password.text ? 'Mật khẩu nhập lại chưa khớp.' : null, onChanged: () => setState(() {})),
            if (_ship)
              SizedBox(height: 160, child: SingleChildScrollView(child: _termsCard()))
            else
              _termsCard(),
            CheckboxListTile(
              key: const Key('register-consent'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              activeColor: N11Colors.yellow,
              checkColor: N11Colors.black,
              side: const BorderSide(color: N11Colors.lineStrong, width: 2),
              value: _agree,
              onChanged: busy ? null : (bool? value) => setState(() => _agree = value ?? false),
              title: Text(_ship ? 'Tôi đã đọc và đồng ý với Điều khoản sử dụng và Chính sách bảo mật' : kConsentLabel, style: N11Text.body),
            ),
            if (food) N11Banner(
              kind: BannerKind.info,
              title: food ? 'Muốn mở quán?' : 'Muốn nhận đơn giao?',
              text: food
                  ? 'Mở Quản lý cửa hàng sau khi đăng ký, trong mục Tài khoản. Bạn vẫn giữ vai trò khách hàng.'
                  : 'Gửi hồ sơ shipper sau khi đăng ký, trong mục Tài khoản. Bạn vẫn giữ vai trò khách hàng; nhận đơn chưa mở.',
            ),
            N11Button(
              key: const Key('register-submit'),
              label: busy ? 'Đang đăng ký…' : (_ship ? 'Tiếp tục' : 'Hoàn tất đăng ký'),
              loading: busy,
              onPressed: busy || !_valid || (_ship ? !session.ready || mode == RegistrationMode.unknown : !open) ? null : () {
                if (_ship && mode == RegistrationMode.required) {
                  setState(() => _otpPage = true);
                  if (_otp.phone == null) _otp.request(_phone.text);
                } else {
                  session.register(phone: _phone.text, password: _password.text, fullName: _name.text, verificationToken: _otp.token);
                }
              },
            ),
            if (!session.ready) const ReasonNote(kNoServerReason),
          ],
        );
      },
    );
  }
}

class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key, required this.session});
  final SessionController session;
  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final TextEditingController _current = TextEditingController();
  final TextEditingController _next = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _busy = false;
  bool _saved = false;
  AuthFailure? _failure;
  String? _pendingBody;
  String? _pendingKey;
  bool get _valid => _current.text.isNotEmpty && _next.text.runes.length >= 8 && _next.text.runes.length <= 128 && _next.text == _confirm.text;
  @override
  void initState() {
    super.initState();
    widget.session.addListener(_sessionChanged);
  }
  void _sessionChanged() {
    if (mounted && widget.session.status != SessionStatus.signedIn) {
      Navigator.of(context).popUntil((Route<dynamic> route) => route.isFirst);
    }
  }
  @override
  void dispose() {
    widget.session.removeListener(_sessionChanged);
    _current.dispose(); _next.dispose(); _confirm.dispose();
    super.dispose();
  }
  Future<void> _save() async {
    if (_busy) return;
    final String body = _pendingBody ?? jsonEncode(<String, Object?>{'current_password': _current.text, 'new_password': _next.text});
    final String key = _pendingKey ?? newIdempotencyKey();
    setState(() { _busy = true; _failure = null; _saved = false; _pendingBody = body; _pendingKey = key; });
    try {
      final ApiResponse response = await widget.session.protectedCall('POST', '/v1/client-auth/change-password', body: body, idempotencyKey: key);
      if (response.status != 200) throw failureOf(response);
      final Object? data = response.data;
      if (data is! Map<String, Object?> || data['changed'] != true) throw const AuthFailure(AuthFailureKind.badResponse);
      if (!mounted) return;
      setState(() { _saved = true; _pendingBody = null; _pendingKey = null; _current.clear(); _next.clear(); _confirm.clear(); });
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() { _failure = failure; if (!failure.outcomeUnknown) { _pendingBody = null; _pendingKey = null; } });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
  @override
  Widget build(BuildContext context) {
    final bool locked = _busy || _pendingBody != null;
    return N11FormScaffold(title: 'Đổi mật khẩu', session: widget.session, children: <Widget>[
      const ReasonNote('Dùng từ 8 đến 128 ký tự. Sau khi đổi, các phiên khác sẽ được đăng xuất.'),
      if (_saved) const N11Banner(key: Key('password-saved'), kind: BannerKind.success, title: 'Đã đổi mật khẩu', text: 'Bạn có thể dùng mật khẩu mới để đăng nhập.'),
      if (_failure != null) N11Banner(key: const Key('password-error'), kind: BannerKind.error, title: 'Chưa đổi được mật khẩu', text: _failure!.kind == AuthFailureKind.invalidCredentials ? 'Mật khẩu hiện tại không đúng.' : failureMessage(_failure!)),
      N11Field(fieldKey: const Key('password-current'), label: 'Mật khẩu hiện tại', controller: _current, password: true, maxLength: 128, enabled: !locked, onChanged: () => setState(() {})),
      N11Field(fieldKey: const Key('password-new'), label: 'Mật khẩu mới', controller: _next, password: true, maxLength: 128, enabled: !locked, onChanged: () => setState(() {})),
      N11Field(fieldKey: const Key('password-confirm'), label: 'Nhập lại mật khẩu mới', controller: _confirm, password: true, maxLength: 128, enabled: !locked, hint: _confirm.text.isNotEmpty && _confirm.text != _next.text ? 'Mật khẩu chưa khớp.' : null, onChanged: () => setState(() {})),
      N11Button(key: const Key('password-submit'), label: _busy ? 'Đang lưu…' : _pendingBody != null ? 'Thử lại' : 'Đổi mật khẩu', loading: _busy, onPressed: _busy || (!_valid && _pendingBody == null) || widget.session.status != SessionStatus.signedIn ? null : _save),
    ]);
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

/// Empty by design: no voucher API, storage or redemption is implied.
class VoucherScreen extends StatelessWidget {
  const VoucherScreen({super.key, required this.session});
  final SessionController session;
  @override
  Widget build(BuildContext context) => DefaultTabController(length: 3, child: Scaffold(
    backgroundColor: N11Colors.bg,
    appBar: AppBar(title: const Text('Voucher của tôi'), bottom: const TabBar(tabs: <Widget>[Tab(text: 'Khả dụng'), Tab(text: 'Đã dùng'), Tab(text: 'Hết hạn')])),
    body: const TabBarView(children: <Widget>[
      EmptyState(icon: Icons.local_offer_outlined, title: 'Chưa có voucher', text: 'Tính năng voucher chưa được hỗ trợ. Chưa thể nhập hoặc áp mã.'),
      EmptyState(icon: Icons.local_offer_outlined, title: 'Chưa có voucher đã dùng', text: 'Tính năng voucher chưa được hỗ trợ.'),
      EmptyState(icon: Icons.local_offer_outlined, title: 'Chưa có voucher hết hạn', text: 'Tính năng voucher chưa được hỗ trợ.'),
    ]),
  ));
}
