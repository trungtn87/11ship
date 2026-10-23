import '../account/models.dart';

// M05-B: the delivery address book of the signed-in customer. Contract: docs/current/11Ship-M05-design-approved-v1.0.md and
// apps/backend/src/customers. Nothing here is invented: every address comes from the server.

enum AddressLabel {
  home('HOME', 'Nhà'),
  office('OFFICE', 'Cơ quan'),
  other('OTHER', 'Khác');

  const AddressLabel(this.code, this.text);

  final String code;
  final String text;

  static AddressLabel? parse(Object? code) {
    for (final AddressLabel l in AddressLabel.values) {
      if (l.code == code) {
        return l;
      }
    }
    return null;
  }
}

class DeliveryAddress {
  const DeliveryAddress({
    required this.id,
    required this.label,
    required this.recipientName,
    required this.contactPhone,
    required this.addressText,
    required this.deliveryNote,
    required this.isDefault,
    required this.version,
    this.latitude,
    this.longitude,
  });

  final String id;
  final AddressLabel label;
  final String? recipientName;

  /// E.164 as stored (+84…).
  final String contactPhone;
  final String addressText;
  final String? deliveryNote;
  final bool isDefault;
  final int version;
  final double? latitude;
  final double? longitude;

  /// 0901 234 567 style for the screen.
  String get phoneText => formatVnPhone(contactPhone);
}

String formatVnPhone(String e164) => e164.startsWith('+84') ? '0${e164.substring(3)}' : e164;

/// Address text and the point chosen by the person. Legacy text-only addresses remain readable.
class AddressInput {
  const AddressInput({required this.label, required this.recipientName, required this.phone, required this.addressText, required this.note, required this.makeDefault, this.latitude, this.longitude});

  final AddressLabel label;
  final String recipientName;
  final String phone;
  final String addressText;
  final String note;
  final bool makeDefault;
  final double? latitude;
  final double? longitude;
}

/// The port of the server. Failures are thrown as [AuthFailure] (see failureOf).
abstract class AddressApi {
  Future<List<DeliveryAddress>> list();

  Future<DeliveryAddress> create(AddressInput input, {required String key});

  Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key});

  /// Returns the id of the address that is the default afterwards (null = none left).
  Future<String?> delete(String id, {required String key});

  Future<void> setDefault(String id, {required String key});
}

typedef AddressFailure = AuthFailure;
