import 'package:flutter/material.dart';

/// Matches the existing API contract; do not silently rewrite a phone number.
String? phoneError(String value) {
  if (value.trim().isEmpty) return 'Nhập số điện thoại.';
  if (!RegExp(r'^(?:\+84|84|0)[0-9]{9}$').hasMatch(value.trim())) {
    return 'Nhập số Việt Nam: 10 số bắt đầu bằng 0, không có dấu cách.';
  }
  return null;
}

String? textError(
  String value,
  String label,
  int max, {
  bool optional = false,
}) {
  final String text = value.trim();
  if (text.isEmpty) return optional ? null : 'Nhập $label.';
  if (text.contains('\u0000') ||
      text.runes.any((int r) => r >= 0xd800 && r <= 0xdfff)) {
    return '$label chứa ký tự không hợp lệ.';
  }
  return text.runes.length > max ? '$label tối đa $max ký tự.' : null;
}

String? passwordError(String value) {
  if (value.isEmpty) return 'Nhập mật khẩu.';
  return value.runes.length < 8 || value.runes.length > 128
      ? 'Mật khẩu cần từ 8 đến 128 ký tự.'
      : null;
}

/// Stable anchors reveal the first invalid field after the error lines are laid out.
class FormFeedback {
  final Map<String, GlobalKey> _keys = <String, GlobalKey>{};
  bool attempted = false;
  GlobalKey key(String field) => _keys.putIfAbsent(field, GlobalKey.new);
  String? message(String? error) => attempted ? error : null;

  bool validate(Map<String, String?> errors) {
    attempted = true;
    final String? first = errors.keys
        .where((String id) => errors[id] != null)
        .firstOrNull;
    if (first == null) return true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final BuildContext? context = _keys[first]?.currentContext;
      if (context == null || !context.mounted) return;
      void focus(Element element) {
        final Widget widget = element.widget;
        if (widget is EditableText) {
          widget.focusNode.requestFocus();
          return;
        }
        element.visitChildElements(focus);
      }

      (context as Element).visitChildElements(focus);
      Scrollable.ensureVisible(
        context,
        alignment: 0.15,
        duration: const Duration(milliseconds: 200),
      );
    });
    return false;
  }
}

/// The action caller owns busy/session/business guards. This only checks visible input fields.
bool validateInputForm(BuildContext context) {
  final Set<FormFieldState<Object?>> invalid =
      Form.maybeOf(context)?.validateGranularly() ??
      <FormFieldState<Object?>>{};
  if (invalid.isEmpty) return true;
  for (final FormFieldState<Object?> field in invalid) {
    field.didChange(field.value);
  }
  final BuildContext first = invalid.first.context;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!first.mounted) return;
    void focus(Element element) {
      if (element.widget is EditableText) {
        (element.widget as EditableText).focusNode.requestFocus();
        return;
      }
      element.visitChildElements(focus);
    }

    (first as Element).visitChildElements(focus);
    Scrollable.ensureVisible(
      first,
      alignment: 0.15,
      duration: const Duration(milliseconds: 200),
    );
  });
  return false;
}

String? confirmPasswordError(String value, String password) => value.isEmpty
    ? 'Nhập lại mật khẩu.'
    : value != password
    ? 'Mật khẩu nhập lại chưa khớp.'
    : null;
String? otpError(String value) => RegExp(r'^\d{6}$').hasMatch(value.trim())
    ? null
    : 'Nhập mã xác minh gồm 6 số.';
String? bankNumberError(String value) =>
    RegExp(r'^[0-9]{6,20}$')
        .hasMatch(value.trim().replaceAll(RegExp(r'[ -]'), ''))
    ? null
    : 'Số tài khoản cần từ 6 đến 20 chữ số; có thể ngăn cách bằng dấu cách hoặc gạch ngang.';

String? recipientPhoneError(String value) {
  final String phone = value.replaceAll(RegExp(r'[\s.\-]'), '');
  return RegExp(r'^(0|\+84)\d{9}$').hasMatch(phone)
      ? null
      : 'Nhập số điện thoại người nhận gồm 10 số bắt đầu bằng 0 hoặc +84.';
}
