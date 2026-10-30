import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

void main() {
  group('Identity.phoneVerification (M01-OTP-TEST-01)', () {
    test('an account made while the registration OTP was off is reported unverified', () {
      final Identity? identity = Identity.tryParse(identityJson(phoneVerification: 'UNVERIFIED'));
      expect(identity, isNotNull);
      expect(identity!.phoneVerification, 'UNVERIFIED');
      expect(identity.phoneUnverified, isTrue);
    });

    test('a proven phone is verified; a reply without the field (older server) is read as verified, never as unverified', () {
      expect(Identity.tryParse(identityJson())!.phoneUnverified, isFalse);
      final Map<String, Object?> old = identityJson()..remove('phone_verification_status');
      expect(Identity.tryParse(old)!.phoneVerification, 'VERIFIED');
    });

    test('the test-only unverified origin is unverified too', () {
      expect(Identity.tryParse(identityJson(phoneVerification: 'UNVERIFIED_TEST'))!.phoneUnverified, isTrue);
    });
  });
}
