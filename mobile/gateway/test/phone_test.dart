import 'package:flutter_test/flutter_test.dart';
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
  test('only a test text can be sent', () {
    expect(testSmsMessage, contains('thu nghiem'));
    expect(testSmsMessage, contains('Khong phai ma OTP'));
  });
}
