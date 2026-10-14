import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:gateway/main.dart';

void main() {
  test('valid Vietnamese numbers', () {
    expect(normalizeVietnamPhone('0912345678'), '+84912345678');
    expect(normalizeVietnamPhone('+84912345678'), '+84912345678');
    expect(normalizeVietnamPhone('0912 345 678'), '+84912345678');
  });
  test('rejects invalid recipients', () {
    expect(normalizeVietnamPhone(''), null);
    expect(normalizeVietnamPhone('123'), null);
    expect(normalizeVietnamPhone('+14155550123'), null);
    expect(normalizeVietnamPhone('09123456789'), null);
  });
  test('hardware feature flag cannot suppress manual test send', () {
    // Permission is the only static send gate; a negative Android feature flag
    // still allows an explicitly confirmed SMS send test.
    expect(mayAttemptSms(permissionGranted: true, busy: false), isTrue);
    expect(mayAttemptSms(permissionGranted: false, busy: false), isFalse);
    expect(mayAttemptSms(permissionGranted: true, busy: true), isFalse);
  });

  testWidgets('missing messaging feature does not disable send', (tester) async {
    const channel = MethodChannel('vn.eleven.gateway/sms');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'deviceStatus') {
        return {'supported': false, 'granted': true};
      }
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });
    await tester.pumpWidget(const GatewayApp());
    await tester.pumpAndSettle();
    expect(find.textContaining('không khai báo tính năng SMS'), findsOneWidget);
    final button = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Gửi một SMS thử'),
    );
    expect(button.onPressed, isNotNull);
  });

  test('only a test text can be sent', () {
    expect(testSmsMessage, contains('thu nghiem'));
    expect(testSmsMessage, contains('Khong phai ma OTP'));
  });
}
