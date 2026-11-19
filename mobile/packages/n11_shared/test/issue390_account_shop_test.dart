import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// Issue #390: "Đánh giá của khách" lives in Quán -> Hồ sơ quán (read-only profile), not in the Account list; the finance entry is hidden.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

/// Only the shop reviews screen is reached from these tests; every other M11 call fails loudly if it is ever made.
class _NoReviewsM11 extends M11Source {
  const _NoReviewsM11();
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

Future<M02Flows> _flows(WidgetTester tester, {M11Source? feedback}) async {
  tester.view.physicalSize = const Size(390 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  FakeShopOpsServer(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final M02Flows flows = createM02Flows(
    session: session,
    location: FakeLocationProvider(),
    menuApi: FakeMenuApi(),
    publicApi: FakePublicShopApi(null),
    picker: FakeImagePicker(),
    cropper: (PickedImage raw) async => raw,
    pollEvery: Duration.zero,
    feedback: feedback,
  );
  addTearDown(flows.dispose);
  return flows;
}

Future<void> _show(WidgetTester tester, Widget home) async {
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: home));
  await tester.pumpAndSettle();
}

void main() {
  group('Quán -> Hồ sơ quán: đánh giá của khách', () {
    testWidgets('the read-only profile opens the shop reviews when the M11 source is there', (WidgetTester tester) async {
      final M02Flows flows = await _flows(tester, feedback: const _NoReviewsM11());
      await _show(tester, ShopProfileScreen(flows: flows));
      expect(find.byKey(const Key('open-shop-reviews')), findsOneWidget);
      expect(find.text('Đánh giá của khách'), findsOneWidget);
    });

    testWidgets('without an M11 source the profile shows no reviews row (no empty block left)', (WidgetTester tester) async {
      final M02Flows flows = await _flows(tester);
      await _show(tester, ShopProfileScreen(flows: flows));
      expect(find.byKey(const Key('open-shop-reviews')), findsNothing);
      expect(find.text('Khách hàng'), findsNothing);
    });

    testWidgets('the edit form never shows the reviews row', (WidgetTester tester) async {
      final M02Flows flows = await _flows(tester, feedback: const _NoReviewsM11());
      await _show(tester, ShopProfileScreen(flows: flows, startEditing: true));
      expect(find.byKey(const Key('open-shop-reviews')), findsNothing);
    });
  });

  group('Tài khoản: vai trò CUSTOMER / SHOP_OWNER', () {
    Future<void> pumpEntries(WidgetTester tester, M11Role role) async {
      tester.view.physicalSize = const Size(390 * 3, 800 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: ListView(
              children: m11AccountEntries(context, source: const _NoReviewsM11(), picker: FakeImagePicker(), role: role),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('SHOP_OWNER: the account no longer lists the customers\' reviews, but keeps "Phản ánh của tôi"', (WidgetTester tester) async {
      await pumpEntries(tester, M11Role.shop);
      expect(find.byKey(const Key('open-shop-reviews')), findsNothing);
      expect(find.text('Đánh giá của khách'), findsNothing);
      expect(find.byKey(const Key('open-complaints')), findsOneWidget);
    });

    testWidgets('CUSTOMER: the account shows only "Phản ánh của tôi" (no shop rows)', (WidgetTester tester) async {
      await pumpEntries(tester, M11Role.customer);
      expect(find.byKey(const Key('open-shop-reviews')), findsNothing);
      expect(find.byKey(const Key('open-shipper-reviews')), findsNothing);
      expect(find.byKey(const Key('open-complaints')), findsOneWidget);
    });
  });
}
