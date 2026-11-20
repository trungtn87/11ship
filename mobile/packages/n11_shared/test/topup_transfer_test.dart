import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:qr_flutter/qr_flutter.dart';

// M04 top-up transfer details: the VietQR payload, the typed-by-hand fields with their copy buttons, the PENDING and CONFIRMED states.

const String _code = 'NAPA1B2C3D4E';

/// A real-looking source: MB receiving account from the server, a request with the NAP code, and the status the test sets.
class _TopupSource extends SampleWalletSource {
  _TopupSource({this.status = TopupStatus.pending, this.bankCode = 'MB'});

  final TopupStatus status;
  final String bankCode;

  @override
  bool get isSample => false;

  @override
  Future<WalletLoad<BankTransferInfo>> transferInfo() async => WalletReady<BankTransferInfo>(
        BankTransferInfo(bankName: 'MB Bank', accountNumber: '0123456789', holder: 'CONG TY 11SHIP', bankCode: bankCode),
      );

  @override
  Future<WalletLoad<TopupRequest>> topup(String code) async => WalletReady<TopupRequest>(
        TopupRequest(code: code, amount: 150000, createdAt: DateTime(2026, 11, 20, 9, 0), status: status, transferCode: _code, displayCode: 'NAPA1B2C'),
      );

  @override
  Future<WalletLoad<Wallet>> wallet() async => WalletReady<Wallet>(const Wallet(total: 300000, held: 50000));
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 5200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await tester.pump();
  await tester.pump();
  await tester.pumpAndSettle();
}

/// Records every text the app puts on the clipboard.
List<String> captureClipboard(WidgetTester tester) {
  final List<String> copied = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (MethodCall call) async {
    if (call.method == 'Clipboard.setData') {
      copied.add((call.arguments as Map<Object?, Object?>)['text'] as String);
    }
    return null;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return copied;
}

Future<void> tapCopy(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
}

void main() {
  group('VietQR payload', () {
    test('CRC-16/CCITT-FALSE matches the standard check value', () {
      expect(crc16Ccitt('123456789'), 0x29B1);
    });

    test('carries the MB bin, the account, the amount and the NAP code, and ends with a matching CRC', () {
      final String? payload = buildVietQrPayload(napasBin: '970422', accountNumber: '0123456789', amount: 150000, content: _code);
      expect(payload, isNotNull);
      final String p = payload!;
      expect(p.startsWith('000201010212'), isTrue);
      expect(p, contains('A000000727'));
      expect(p, contains('0006970422'));
      expect(p, contains('01100123456789'));
      expect(p, contains('5406150000'));
      expect(p, contains('5802VN'));
      // Additional data (62) of 16 characters: purpose (08) of length 12 holding the NAP code.
      expect(p, contains('62160812$_code'));
      // The last four characters are the CRC of everything before them, including the "6304" tag.
      final String body = p.substring(0, p.length - 4);
      expect(p.substring(p.length - 4), crc16Ccitt(body).toRadixString(16).toUpperCase().padLeft(4, '0'));
    });

    test('the topup helper encodes the amount and NAP code of this request for the MB account, and nothing for a bank without a QR', () {
      final BankTransferInfo info = const BankTransferInfo(bankName: 'MB Bank', accountNumber: '0123456789', holder: 'CONG TY 11SHIP', bankCode: 'MB');
      final TopupRequest request = TopupRequest(code: 'req-1', amount: 150000, createdAt: DateTime(2026, 11, 20), status: TopupStatus.pending, transferCode: _code);
      expect(vietQrForTopup(info, request), buildVietQrPayload(napasBin: '970422', accountNumber: '0123456789', amount: 150000, content: _code));
      final BankTransferInfo other = const BankTransferInfo(bankName: 'Vietcombank', accountNumber: '0123456789', holder: 'X', bankCode: 'VCB');
      expect(vietQrForTopup(other, request), isNull);
      final TopupRequest noCode = TopupRequest(code: 'req-1', amount: 150000, createdAt: DateTime(2026, 11, 20), status: TopupStatus.pending);
      expect(vietQrForTopup(info, noCode), isNull);
    });

    test('refuses a missing or malformed part instead of building a QR', () {
      expect(buildVietQrPayload(napasBin: '970422', accountNumber: '0123456789', amount: 0, content: _code), isNull);
      expect(buildVietQrPayload(napasBin: '970422', accountNumber: '0123456789', amount: 1000, content: 'NAP A1'), isNull);
      expect(buildVietQrPayload(napasBin: '97042', accountNumber: '0123456789', amount: 1000, content: _code), isNull);
      expect(napasBinOf('MB'), '970422');
      expect(napasBinOf('VCB'), isNull);
      expect(napasBinOf(null), isNull);
    });
  });

  group('topup transfer screen', () {
    testWidgets('PENDING: the VietQR is the real payload for this amount and NAP code, and every field shows and copies its exact value', (WidgetTester tester) async {
      final List<String> copied = captureClipboard(tester);
      await mount(tester, TopupDetailScreen(source: _TopupSource(), code: 'req-1'));

      expect(find.byKey(const Key('topup-vietqr')), findsOneWidget);
      expect(find.byType(QrImageView), findsOneWidget);

      expect(find.text('MB Bank'), findsWidgets);
      expect(find.text('0123456789'), findsOneWidget);
      expect(find.text('CONG TY 11SHIP'), findsOneWidget);
      expect(find.text('150.000đ'), findsWidgets);
      expect(find.text(_code), findsOneWidget);
      expect(find.text('Chờ xác nhận'), findsWidgets);
      expect(find.text('Đã cộng vào ví'), findsNothing);

      await tapCopy(tester, 'copy-content');
      expect(copied.last, _code);
      expect(find.text('Đã sao chép'), findsOneWidget);
      await tapCopy(tester, 'copy-account');
      expect(copied.last, '0123456789');
      await tapCopy(tester, 'copy-holder');
      expect(copied.last, 'CONG TY 11SHIP');
      await tapCopy(tester, 'copy-bank');
      expect(copied.last, 'MB Bank');
      await tapCopy(tester, 'copy-amount');
      expect(copied.last, '150000');

      expect(find.byKey(const Key('topup-transfer-note')), findsOneWidget);
      expect(find.textContaining('đúng nội dung chuyển khoản và đúng số tiền'), findsOneWidget);
    });

    testWidgets('PENDING with a bank that has no VietQR: no QR, a neutral note, and the text fields still copy', (WidgetTester tester) async {
      final List<String> copied = captureClipboard(tester);
      await mount(tester, TopupDetailScreen(source: _TopupSource(bankCode: 'VCB'), code: 'req-1'));

      expect(find.byKey(const Key('topup-vietqr')), findsNothing);
      expect(find.byKey(const Key('topup-no-qr')), findsOneWidget);
      await tapCopy(tester, 'copy-content');
      expect(copied.last, _code);
    });

    testWidgets('CONFIRMED: says the amount is credited, shows the new balance, and offers no transfer details or QR', (WidgetTester tester) async {
      await mount(tester, TopupDetailScreen(source: _TopupSource(status: TopupStatus.confirmed), code: 'req-1'));

      expect(find.text('Admin đã xác nhận. Số tiền thực nhận đã được ghi vào ví.'), findsOneWidget);
      expect(find.byKey(const Key('topup-new-balance')), findsOneWidget);
      expect(find.text('250.000đ'), findsOneWidget);
      expect(find.byKey(const Key('topup-vietqr')), findsNothing);
      expect(find.byKey(const Key('topup-transfer-card')), findsNothing);
    });
  });
}
