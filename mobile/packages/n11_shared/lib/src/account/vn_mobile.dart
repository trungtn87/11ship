import 'vn_mobile_prefixes.g.dart';

// The OTP phone rule on the phone (issue #117), the same as the backend's `normalizeVietnamMobile`: 0…, 84… and +84… all normalize to
// +84 + 9 digits, and the 10 national digits must start with an ALLOCATED mobile prefix (config/vn-mobile-prefixes.json, one list for the
// backend and both apps; shared test vectors in config/vn-mobile-phone-cases.json). The check is local and only saves a useless request:
// the backend decides again. A prefix only says the range was allocated: it says nothing about the subscriber or the current operator
// (ported numbers are fine). Login keeps its own looser format check on purpose, so no existing account is affected.

const String kInvalidMobileMessage = 'Số điện thoại không hợp lệ. Hãy nhập số di động Việt Nam.';

final RegExp _vietnamNumber = RegExp(r'^(?:\+84|84|0)([0-9]{9})$');

/// The normalized `+84XXXXXXXXX` form of an allocated Vietnamese mobile number, or null.
String? normalizeVnMobile(String input, {List<String> prefixes = vnMobilePrefixes}) {
  final RegExpMatch? match = _vietnamNumber.firstMatch(input.trim());
  if (match == null) {
    return null;
  }
  final String subscriber = match.group(1)!;
  final String national = '0$subscriber';
  for (final String prefix in prefixes) {
    if (national.startsWith(prefix)) {
      return '+84$subscriber';
    }
  }
  return null;
}

bool isVnMobile(String input, {List<String> prefixes = vnMobilePrefixes}) => normalizeVnMobile(input, prefixes: prefixes) != null;

/// The field error of a number that is about to receive an OTP SMS (null = fine).
String? otpPhoneError(String value) {
  if (value.trim().isEmpty) {
    return 'Nhập số điện thoại.';
  }
  return isVnMobile(value) ? null : kInvalidMobileMessage;
}
