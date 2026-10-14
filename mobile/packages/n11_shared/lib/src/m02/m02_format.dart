// Small pure helpers of the M02 screens: Vietnamese day names, money, search folding.

const List<String> kDayNames = <String>['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

/// 120000 -> "120.000 đ".
String formatVnd(int amount) {
  final String digits = amount.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) {
      out.write('.');
    }
    out.write(digits[i]);
  }
  return '$out đ';
}

/// Digits of what the person typed, with thousands dots: "120000" -> "120.000".
String groupDigits(String raw) {
  final String digits = raw.replaceAll(RegExp(r'\D'), '');
  return digits.isEmpty ? '' : formatVnd(int.parse(digits)).replaceAll(' đ', '');
}

const String _from = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const String _to = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

/// Lower case without Vietnamese marks, for the in-shop search ("oc huong" finds "Ốc hương").
String foldVietnamese(String input) {
  final StringBuffer out = StringBuffer();
  for (final int rune in input.toLowerCase().runes) {
    final String ch = String.fromCharCode(rune);
    final int i = _from.indexOf(ch);
    out.write(i >= 0 ? _to[i] : ch);
  }
  return out.toString();
}
