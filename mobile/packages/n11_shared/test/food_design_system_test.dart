import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/src/flows/shop_logo_widgets.dart';
import 'package:n11_shared/testing.dart';

const AppConfig _config = AppConfig(
  apiBaseUrl: 'https://api.example.test',
  deviceEnvironment: 'fixture-env',
);

void main() {
  test('design tokens match warm WCAG AA palette and compact typography scale', () {
    expect(N11Colors.formBg, const Color(0xFFF5F5F2));
    expect(N11Colors.formDivider, const Color(0xFFE6E3DC));
    expect(N11Colors.fieldBorder, const Color(0xFFC7C2B8));
    expect(N11Colors.black, const Color(0xFF1C1917));
    expect(N11Colors.ink2, const Color(0xFF57534E));
    expect(N11Colors.ink3, const Color(0xFF57534E));
    expect(N11Colors.placeholder, const Color(0xFF78716C));
    expect(kFieldBorderWidth, 1.2);
    expect(kFieldFocusBorderWidth, 1.8);
    expect(kControlHeight, 48);
    expect(kTapMin, 48);

    expect(N11Text.title.fontSize, 22);
    expect(N11Text.title.fontWeight, FontWeight.w700);
    expect(N11Text.barTitle.fontSize, 18);
    expect(N11Text.barTitle.fontWeight, FontWeight.w700);
    expect(N11Text.section.fontSize, 15);
    expect(N11Text.section.fontWeight, FontWeight.w700);
    expect(N11Text.label.fontSize, 13.5);
    expect(N11Text.label.fontWeight, FontWeight.w600);
    expect(N11Text.input.fontSize, 15);
    expect(N11Text.input.fontWeight, FontWeight.w500);
    expect(N11Text.inputHint.fontSize, 15);
    expect(N11Text.inputHint.fontWeight, FontWeight.w400);
    expect(N11Text.button.fontSize, 15);
    expect(N11Text.button.fontWeight, FontWeight.w700);
    expect(N11Text.caption.fontSize, 13);
    expect(N11Text.caption.fontWeight, FontWeight.w400);
    expect(N11Text.link.fontSize, 13);
    expect(N11Text.link.fontWeight, FontWeight.w600);
  });

  testWidgets(
    'disabled primary N11Button uses warm muted fill without white/gray border at 48dp height',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: const Scaffold(
            body: N11Button(label: 'Gửi mã xác minh'),
          ),
        ),
      );
      expect(tester.getSize(find.byType(N11Button)).height, kControlHeight);
      final DecoratedBox box = tester.widget<DecoratedBox>(
        find.descendant(
          of: find.byType(N11Button),
          matching: find.byType(DecoratedBox),
        ),
      );
      final BoxDecoration dec = box.decoration as BoxDecoration;
      expect(dec.color, N11Colors.primaryDisabledBg);
      expect(dec.color, isNot(N11Colors.white));
      expect((dec.border! as Border).top.color, Colors.transparent);
    },
  );

  testWidgets(
    'LoginScreen uses formBg, highlights both fields on error, keeps 48dp heights & tap targets',
    (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api);
      final SessionController session = createSessionController(
        ClientApp.food,
        _config,
        transport: api,
        bridge: FakeDeviceBridge(),
      );
      await session.start();
      api.routes['POST /v1/client-auth/login'] =
          (String m, String p, Map<String, String> h, String b) async =>
              apiError(401, 'INVALID_CREDENTIALS');
      final ResetController reset = ResetController(
        transport: api,
        session: session,
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: LoginScreen(session: session, brand: foodBrand, reset: reset),
        ),
      );
      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        N11Colors.formBg,
      );
      expect(
        tester.getSize(find.byKey(const Key('login-phone'))).height,
        kControlHeight,
      );
      expect(
        tester.getSize(find.byKey(const Key('login-password'))).height,
        kControlHeight,
      );
      expect(
        tester.getSize(find.byKey(const Key('login-submit'))).height,
        kControlHeight,
      );
      expect(
        tester.getSize(find.byKey(const Key('login-password-toggle'))).height,
        greaterThanOrEqualTo(kTapMin),
      );
      expect(
        tester.getSize(find.byKey(const Key('to-reset'))).height,
        greaterThanOrEqualTo(kTapMin),
      );
      expect(
        tester.getSize(find.byKey(const Key('to-register'))).height,
        greaterThanOrEqualTo(kTapMin),
      );

      await tester.enterText(find.byKey(const Key('login-phone')), '0901234567');
      await tester.enterText(find.byKey(const Key('login-password')), 'wrong-pass-1');
      await tester.ensureVisible(find.byKey(const Key('login-submit')));
      await tester.tap(find.byKey(const Key('login-submit')));
      await tester.pumpAndSettle();

      final N11Field phone = tester.widget<N11Field>(
        find.ancestor(
          of: find.byKey(const Key('login-phone')),
          matching: find.byType(N11Field),
        ),
      );
      final N11Field password = tester.widget<N11Field>(
        find.ancestor(
          of: find.byKey(const Key('login-password')),
          matching: find.byType(N11Field),
        ),
      );
      expect(phone.tone, FieldTone.error);
      expect(password.tone, FieldTone.error);

      final N11Link forgot = tester.widget<N11Link>(
        find.byKey(const Key('to-reset')),
      );
      expect(forgot.compact, isTrue);
      expect(
        tester.getCenter(find.byKey(const Key('to-reset'))).dx,
        greaterThan(tester.getCenter(find.byKey(const Key('login-submit'))).dx),
      );

      final N11Link register = tester.widget<N11Link>(
        find.byKey(const Key('to-register')),
      );
      expect(register.prefix, 'Chưa có tài khoản? ');
      expect(register.label, 'Đăng ký');
    },
  );

  testWidgets(
    'RegisterScreen (food) uses formBg and >= 48dp checkbox tap target while ShopStartScreen keeps homeGradient',
    (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      FakeShopServer(api);
      final SessionController session = createSessionController(
        ClientApp.food,
        _config,
        transport: api,
        bridge: FakeDeviceBridge(),
      );
      await session.start();

      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: RegisterScreen(session: session, brand: foodBrand),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        N11Colors.formBg,
      );
      final Size consentSize = tester.getSize(
        find.byKey(const Key('register-consent')),
      );
      expect(consentSize.width, greaterThanOrEqualTo(kTapMin));
      expect(consentSize.height, greaterThanOrEqualTo(kTapMin));

      await session.login(phone: '0901234567', password: 'Correct-Horse-9');
      final ShopController shop = ShopController(
        session: session,
        location: FakeLocationProvider(),
      );
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: ShopStartScreen(controller: shop),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('n11-page-gradient')), findsOneWidget);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        Colors.transparent,
      );
    },
  );

  testWidgets(
    'ResetScreen uses formBg and primary N11Button for idle OTP request',
    (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      installResetRoutes(api, mode: 'SMS_OTP');
      final SessionController session = createSessionController(
        ClientApp.food,
        _config,
        transport: api,
        bridge: FakeDeviceBridge(),
      );
      await session.start();
      final ResetController reset = ResetController(
        transport: api,
        session: session,
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: ResetScreen(controller: reset, brand: foodBrand),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        N11Colors.formBg,
      );
      final N11Button btn = tester.widget<N11Button>(
        find.byKey(const Key('reset-otp-request')),
      );
      expect(btn.kind, ButtonKind.primary);
    },
  );

  testWidgets(
    'ShopFormScreen uses formBg, unified Logo optional label ink, 48dp Choose Logo button, and info ReasonNote',
    (WidgetTester tester) async {
      final FakeApiTransport api = FakeApiTransport();
      installAccountRoutes(api);
      FakeShopServer(api);
      final SessionController session = createSessionController(
        ClientApp.food,
        _config,
        transport: api,
        bridge: FakeDeviceBridge(),
      );
      await session.start();
      await session.login(phone: '0901234567', password: 'Correct-Horse-9');
      final ShopController shop = ShopController(
        session: session,
        location: FakeLocationProvider(),
      );
      await shop.load();

      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: ShopFormScreen(controller: shop),
        ),
      );
      await tester.pump();

      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        N11Colors.formBg,
      );
      expect(find.byType(N11Steps), findsNothing);
      expect(find.byType(N11SectionHeader), findsNWidgets(2));
      expect(find.text('Thông tin liên hệ'), findsOneWidget);
      expect(find.text('Vị trí & kênh liên hệ'), findsOneWidget);

      final N11FieldLabel logoLabel = tester.widget<N11FieldLabel>(
        find.descendant(
          of: find.byType(ShopLogoField),
          matching: find.byType(N11FieldLabel),
        ),
      );
      expect(logoLabel.label, 'Logo quán');
      expect(logoLabel.optional, isTrue);

      expect(
        tester.getSize(find.byKey(const Key('shop-logo-pick'))).height,
        kControlHeight,
      );
      final DecoratedBox logoBtnBox = tester.widget<DecoratedBox>(
        find.descendant(
          of: find.byKey(const Key('shop-logo-pick')),
          matching: find.byType(DecoratedBox),
        ),
      );
      final BoxDecoration logoDec = logoBtnBox.decoration as BoxDecoration;
      expect(logoDec.color, N11Colors.white);
      expect((logoDec.border! as Border).top.color, N11Colors.fieldBorder);
      expect((logoDec.border! as Border).top.width, kFieldBorderWidth);

      expect(
        tester
            .getSize(
              find.descendant(
                of: find.byKey(const Key('shop-address')),
                matching: find.byType(InkWell),
              ),
            )
            .height,
        kControlHeight,
      );

      final ReasonNote note = tester.widget<ReasonNote>(find.byType(ReasonNote));
      expect(note.icon, Icons.info_outline);
      final Icon noteIcon = tester.widget<Icon>(
        find.descendant(
          of: find.byType(ReasonNote),
          matching: find.byType(Icon),
        ),
      );
      expect(noteIcon.color, N11Colors.ink3);
    },
  );

  testWidgets(
    'AddressLocationPicker uses formBg, 48dp centered search input, shadowed bottom bar, and >= 48dp targets',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(pageGradient: N11V5.homeGradient),
          home: AddressLocationPicker(
            initial: const AddressLocation(
              '12 Nguyễn Huệ',
              latitude: 22.66,
              longitude: 106.25,
            ),
            mapBuilder: (_, __, ___, ____) => const SizedBox.shrink(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('n11-page-gradient')), findsNothing);
      expect(
        tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
        N11Colors.formBg,
      );
      final N11AppBar bar = tester.widget<N11AppBar>(find.byType(N11AppBar));
      expect(bar.transparent, isFalse);
      expect(bar.backgroundColor, N11Colors.formBg);
      expect(bar.borderColor, N11Colors.formDivider);

      final TextField searchField = tester.widget<TextField>(
        find.byKey(const Key('location-address-text')),
      );
      expect(searchField.maxLines, 1);
      expect(searchField.textAlignVertical, TextAlignVertical.center);
      expect(
        tester.getSize(find.byKey(const Key('location-address-text'))).height,
        kControlHeight,
      );
      expect(
        tester.getSize(find.byKey(const Key('location-address-clear'))),
        const Size(kTapMin, kControlHeight),
      );
      expect(
        tester.getSize(find.byKey(const Key('location-current'))),
        const Size(kTapMin, kTapMin),
      );
      expect(
        tester.getSize(find.byKey(const Key('location-clear-pin'))).height,
        greaterThanOrEqualTo(kTapMin),
      );

      final Container bottomBar = tester.widget<Container>(
        find.byKey(const Key('location-bottom-bar')),
      );
      final BoxDecoration bottomDec = bottomBar.decoration! as BoxDecoration;
      expect(bottomDec.color, N11Colors.white);
      expect((bottomDec.border! as Border).top.color, N11Colors.formDivider);
      expect(bottomDec.boxShadow, isNotEmpty);

      final N11Button save = tester.widget<N11Button>(
        find.byKey(const Key('location-save')),
      );
      expect(save.kind, ButtonKind.primary);
      expect(save.label, 'Lưu địa chỉ');
      expect(
        tester.getSize(find.byKey(const Key('location-save'))).height,
        kControlHeight,
      );

      await tester.tap(find.byKey(const Key('location-address-clear')));
      await tester.pump();
      expect(find.byKey(const Key('location-address-clear')), findsNothing);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('location-address-text')))
            .controller!
            .text,
        isEmpty,
      );
    },
  );
}
