import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:n11_shared/src/account/legal_links.dart';
import 'package:n11_shared/src/account/registration_consent.dart';

// App Review (issue #440 section 1 and 6): the privacy and terms pages must be reachable from inside the app, at the public address of the
// configured server. The links open the system browser through the iOS `browse` method; where that is not available the link is copied.

const AppConfig _config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');
final Uri _origin = Uri.parse('https://api.example.test');
const MethodChannel _launch = MethodChannel('test.n11.launch');

void main() {
  test('legal page paths are the backend paths and the origin keeps only scheme, host and port', () {
    expect(kPrivacyPagePath, '/chinh-sach-quyen-rieng-tu');
    expect(kTermsPagePath, '/dieu-khoan-su-dung');
    expect(legalPageUri(_origin, kPrivacyPagePath).toString(), 'https://api.example.test/chinh-sach-quyen-rieng-tu');
    expect(legalPageUri(Uri.parse('https://192.168.1.10:8443'), kTermsPagePath).toString(), 'https://192.168.1.10:8443/dieu-khoan-su-dung');
    expect(legalPageUri(null, kTermsPagePath), isNull);
  });

  testWidgets('both links are shown and hidden without a server address', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: LegalPageLinks(origin: _origin))));
    expect(find.byKey(const Key('legal-link-privacy')), findsOneWidget);
    expect(find.byKey(const Key('legal-link-terms')), findsOneWidget);
    expect(find.text('Chính sách quyền riêng tư'), findsOneWidget);
    expect(find.text('Điều khoản sử dụng'), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: LegalPageLinks(origin: null))));
    expect(find.byKey(const Key('legal-link-privacy')), findsNothing);
    expect(find.byKey(const Key('legal-link-terms')), findsNothing);
  });

  testWidgets('tapping a link asks the iOS channel to open exactly that page', (WidgetTester tester) async {
    final List<Object?> asked = <Object?>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(_launch, (MethodCall call) async {
      asked.add(call.method == 'browse' ? (call.arguments as Map<Object?, Object?>)['url'] : call.method);
      return true;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(_launch, null));

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: LegalPageLinks(origin: _origin, launcher: const LegalPageLauncher(channel: _launch))),
    ));
    await tester.tap(find.byKey(const Key('legal-link-privacy')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('legal-link-terms')));
    await tester.pumpAndSettle();

    expect(asked, <Object?>['https://api.example.test/chinh-sach-quyen-rieng-tu', 'https://api.example.test/dieu-khoan-su-dung']);
    expect(find.text('Không mở được trình duyệt. Đã chép liên kết.'), findsNothing);
  });

  testWidgets('a link that cannot be opened is copied, and the user is told so', (WidgetTester tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (MethodCall call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map<Object?, Object?>)['text'] as String?;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

    // No handler on the channel: the same MissingPluginException that Android (no `browse` method) produces.
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: LegalPageLinks(origin: _origin, launcher: const LegalPageLauncher(channel: _launch))),
    ));
    await tester.tap(find.byKey(const Key('legal-link-terms')));
    // The channel answer and the clipboard call are real asynchronous hops: let the event loop run before checking them.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    await tester.pumpAndSettle();

    expect(copied, 'https://api.example.test/dieu-khoan-su-dung');
    expect(find.text('Không mở được trình duyệt. Đã chép liên kết.'), findsOneWidget);
  });

  testWidgets('the registration policy popup carries the links when the origin is known', (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (BuildContext context) => Scaffold(
          body: TextButton(
            key: const Key('open-popup'),
            onPressed: () => showRegistrationPoliciesPopup(context, origin: _origin),
            child: const Text('mở'),
          ),
        ),
      ),
    ));
    await tester.tap(find.byKey(const Key('open-popup')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('legal-link-privacy')), findsOneWidget);
    expect(find.byKey(const Key('legal-link-terms')), findsOneWidget);
    expect(find.byKey(const Key('close-policy-popup')), findsOneWidget);
  });

  testWidgets('the Account policy page shows the links from the session server address', (WidgetTester tester) async {
    final SessionController withServer = createSessionController(ClientApp.food, _config, bridge: FakeDeviceBridge());
    expect(legalOriginOf(withServer)?.toString(), 'https://api.example.test');
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: PolicyScreen(session: withServer)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('policy-links')), findsOneWidget);
    expect(find.byKey(const Key('legal-link-privacy')), findsOneWidget);
    expect(find.byKey(const Key('legal-link-terms')), findsOneWidget);

    final SessionController withoutServer = createSessionController(ClientApp.food, _config, transport: FakeApiTransport(), bridge: FakeDeviceBridge());
    expect(legalOriginOf(withoutServer), isNull);
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: PolicyScreen(session: withoutServer)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('legal-link-privacy')), findsNothing);
  });
}
