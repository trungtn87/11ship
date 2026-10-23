import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:n11_shared/n11_shared.dart';

/// The OS photo picker for a dish picture. The person chooses one existing picture; there is no camera and no storage permission
/// (the system picker hands over only the chosen file). The picture is scaled down so that an upload stays small.
class DeviceImagePicker implements ImagePickerPort, ShopLogoPickerPort {
  DeviceImagePicker({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Native sampling accepts a large source without first decoding it at full size in Dart.
  @override
  Future<PickedImage?> pickLogo() async {
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1536,
        maxHeight: 1536,
        requestFullMetadata: false,
      );
      if (file == null) return null;
      final Uint8List bytes = await file.readAsBytes();
      final String? type = sniffContentType(bytes);
      if (type == null) {
        throw const ShopLogoException(
          'Ảnh không đúng định dạng. Vui lòng chọn JPG, PNG hoặc WebP.',
        );
      }
      return PickedImage(bytes: bytes, contentType: type);
    } on PlatformException {
      throw const ShopLogoException(
        'Không đọc được ảnh này. Vui lòng chọn ảnh khác.',
      );
    }
  }

  @override
  Future<PickedImage?> pick() async {
    try {
      final XFile? file = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1280,
        maxHeight: 1280,
        imageQuality: 85,
        requestFullMetadata: false,
      );
      if (file == null) {
        return null;
      }
      final Uint8List bytes = await file.readAsBytes();
      final String? type = sniffContentType(bytes);
      if (type == null) {
        throw const ImagePickException();
      }
      return PickedImage(bytes: bytes, contentType: type);
    } on PlatformException {
      throw const ImagePickException();
    }
  }
}

/// JPEG, PNG or WebP by the file's first bytes; anything else is not a usable picture.
String? sniffContentType(Uint8List b) {
  if (b.length >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) {
    return 'image/jpeg';
  }
  if (b.length >= 8 &&
      b[0] == 0x89 &&
      b[1] == 0x50 &&
      b[2] == 0x4e &&
      b[3] == 0x47) {
    return 'image/png';
  }
  if (b.length >= 12 &&
      String.fromCharCodes(b.sublist(0, 4)) == 'RIFF' &&
      String.fromCharCodes(b.sublist(8, 12)) == 'WEBP') {
    return 'image/webp';
  }
  return null;
}
