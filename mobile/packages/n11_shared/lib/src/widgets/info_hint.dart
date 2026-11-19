import 'package:flutter/material.dart';

import '../tokens.dart';

/// Icon ⓘ đặt cạnh nhãn trường hoặc tiêu đề để xem phần giải thích khi cần (issue #388).
///
/// Chạm mở hộp giải thích có nút "Đã hiểu"; đóng được bằng nút, Back hoặc chạm ra ngoài.
/// Vùng chạm 44dp, không làm tăng chiều cao dòng đáng kể, icon có nhãn cho TalkBack.
class InfoHint extends StatelessWidget {
  const InfoHint({super.key, required this.title, required this.message});

  /// Tiêu đề hộp giải thích, thường là nhãn của trường/công tắc tương ứng.
  final String title;

  /// Nội dung giải thích đầy đủ.
  final String message;

  void _open(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        key: const Key('info-hint-dialog'),
        title: Text(title, style: N11Text.h2),
        content: Text(message, style: N11Text.body),
        actions: <Widget>[TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Đã hiểu'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => IconButton(
    key: const Key('info-hint-button'),
    tooltip: 'Xem giải thích: $title',
    icon: const Icon(Icons.info_outline, color: N11Colors.ink2),
    iconSize: 20,
    padding: const EdgeInsets.all(12),
    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
    onPressed: () => _open(context),
  );
}
