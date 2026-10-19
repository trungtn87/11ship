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
