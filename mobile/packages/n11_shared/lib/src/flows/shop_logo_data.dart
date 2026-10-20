import 'dart:convert';

import 'package:flutter/foundation.dart';

@immutable
class ShopLogoData {
  const ShopLogoData({required this.contentType, required this.encoded});
  final String contentType;
  final String encoded;
  Uint8List get bytes => base64Decode(encoded);
  Map<String, Object?> toWire() => <String, Object?>{'content_type': contentType, 'data_base64': encoded};

  static ShopLogoData? tryParse(Object? value) {
    if (value is! Map<String, Object?> || value['content_type'] is! String || value['data_base64'] is! String) return null;
    final String type = value['content_type']! as String;
    final String data = value['data_base64']! as String;
    if (!<String>['image/png', 'image/jpeg', 'image/webp'].contains(type) || data.isEmpty || data.length > 1398104) return null;
    try { base64Decode(data); } on FormatException { return null; }
    return ShopLogoData(contentType: type, encoded: data);
  }

  @override
  bool operator ==(Object other) => other is ShopLogoData && contentType == other.contentType && encoded == other.encoded;
  @override
  int get hashCode => Object.hash(contentType, encoded);
}
