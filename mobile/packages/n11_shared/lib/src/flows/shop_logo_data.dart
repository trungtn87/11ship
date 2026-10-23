import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

import '../account/models.dart';
import '../m02/menu_models.dart';

const int shopLogoMaxBytes = 1048576;

/// Optional capability: logo selection does not change the dish picker.
abstract class ShopLogoPickerPort {
  Future<PickedImage?> pickLogo();
}

class ShopLogoException implements Exception {
  const ShopLogoException(this.message);
  final String message;
}

/// A replay refusal is not proof that the original write did not commit.
bool shopWriteOutcomeUnknown(AuthFailure failure) =>
    failure.outcomeUnknown ||
    failure.kind == AuthFailureKind.badResponse ||
    failure.kind == AuthFailureKind.notReplayable ||
    failure.code == 'IDEMPOTENCY_BUSY' ||
    failure.code == 'IDEMPOTENCY_KEY_REUSED';

String? shopLogoFailureText(AuthFailure failure) {
  if (failure.code == 'INVALID_SHOP_LOGO' ||
      failure.code == 'SHOP_LOGO_TOO_LARGE' ||
      failure.status == 413) {
    return 'Logo không hợp lệ hoặc vượt dung lượng cho phép.';
  }
  if (failure.kind == AuthFailureKind.unknownOutcome &&
      failure.status == null) {
    return 'Không kết nối được máy chủ. Vui lòng thử lại yêu cầu cũ để kiểm tra kết quả lưu.';
  }
  return null;
}

/// 384px PNG normally fits already (even uncompressed RGBA is under 600 KiB).
/// Retain a bounded JPEG fallback and always measure bytes before Base64.
Future<ShopLogoData> encodeShopLogo(Uint8List png) async {
  if (png.isNotEmpty && png.length <= shopLogoMaxBytes) {
    return ShopLogoData(contentType: 'image/png', encoded: base64Encode(png));
  }
  Uint8List? jpeg;
  try {
    jpeg = await compute(_jpegUnderLimit, png);
  } catch (_) {
    throw const ShopLogoException(
      'Không thể xử lý ảnh dưới 1 MB. Vui lòng chọn ảnh khác.',
    );
  }
  if (jpeg == null || jpeg.isEmpty || jpeg.length > shopLogoMaxBytes) {
    throw const ShopLogoException(
      'Không thể xử lý ảnh dưới 1 MB. Vui lòng chọn ảnh khác.',
    );
  }
  return ShopLogoData(contentType: 'image/jpeg', encoded: base64Encode(jpeg));
}

Uint8List? _jpegUnderLimit(Uint8List png) {
  final img.Image? decoded = img.decodePng(png);
  if (decoded == null || decoded.width != 384 || decoded.height != 384) {
    return null;
  }
  for (final int quality in <int>[90, 80, 65, 50, 35]) {
    final Uint8List bytes = img.encodeJpg(decoded, quality: quality);
    if (bytes.length <= shopLogoMaxBytes) return bytes;
  }
  return null;
}

@immutable
class ShopLogoData {
  const ShopLogoData({required this.contentType, required this.encoded});
  final String contentType;
  final String encoded;
  Uint8List get bytes => base64Decode(encoded);
  Map<String, Object?> toWire() {
    if (tryParse(<String, Object?>{
          'content_type': contentType,
          'data_base64': encoded,
        }) ==
        null) {
      throw const ShopLogoException(
        'Logo không hợp lệ hoặc vượt dung lượng cho phép.',
      );
    }
    return <String, Object?>{
      'content_type': contentType,
      'data_base64': encoded,
    };
  }

  static ShopLogoData? tryParse(Object? value) {
    if (value is! Map<String, Object?> ||
        value['content_type'] is! String ||
        value['data_base64'] is! String) {
      return null;
    }
    final String type = value['content_type']! as String;
    final String data = value['data_base64']! as String;
    if (!<String>['image/png', 'image/jpeg', 'image/webp'].contains(type) ||
        data.isEmpty ||
        data.length > 1398104) {
      return null;
    }
    try {
      final Uint8List decoded = base64Decode(data);
      if (decoded.isEmpty || decoded.length > shopLogoMaxBytes) return null;
    } on FormatException {
      return null;
    }
    return ShopLogoData(contentType: type, encoded: data);
  }

  @override
  bool operator ==(Object other) =>
      other is ShopLogoData &&
      contentType == other.contentType &&
      encoded == other.encoded;
  @override
  int get hashCode => Object.hash(contentType, encoded);
}
