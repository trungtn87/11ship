class AddressRecipientView {
  const AddressRecipientView({
    required this.name,
    required this.phone,
    required this.addressText,
    this.lat,
    this.lng,
  });

  factory AddressRecipientView.fromJson(Object? raw) {
    if (raw is! Map<String, Object?>) {
      return const AddressRecipientView(name: '', phone: '', addressText: '');
    }
    return AddressRecipientView(
      name: raw['name'] as String? ?? '',
      phone: raw['phone'] as String? ?? '',
      addressText: raw['address_text'] as String? ?? '',
      lat: (raw['lat'] as num?)?.toDouble(),
      lng: (raw['lng'] as num?)?.toDouble(),
    );
  }

  final String name;
  final String phone;
  final String addressText;
  final double? lat;
  final double? lng;
}

class AddressChangeView {
  const AddressChangeView({
    required this.changeRequestId,
    required this.status,
    required this.isExpired,
    required this.timeRemainingSeconds,
    required this.source,
    required this.targetActor,
    this.targetDriverId,
    required this.originalRecipient,
    required this.newRecipient,
    this.originalFeeVnd,
    this.newFeeVnd,
    this.feeDifferenceVnd,
    this.note,
    this.rejectReason,
    required this.version,
    required this.expiresAt,
    required this.createdAt,
    this.resolvedAt,
  });

  factory AddressChangeView.fromJson(Object? raw) {
    if (raw is! Map<String, Object?>) {
      throw const FormatException('Expected map for AddressChangeView');
    }
    return AddressChangeView(
      changeRequestId: raw['change_request_id'] as String? ?? '',
      status: raw['status'] as String? ?? 'PENDING',
      isExpired: raw['is_expired'] == true,
      timeRemainingSeconds: (raw['time_remaining_seconds'] as num?)?.toInt() ?? 0,
      source: raw['source'] as String? ?? '',
      targetActor: raw['target_actor'] as String? ?? '',
      targetDriverId: raw['target_driver_id'] as String?,
      originalRecipient: AddressRecipientView.fromJson(raw['original_recipient']),
      newRecipient: AddressRecipientView.fromJson(raw['new_recipient']),
      originalFeeVnd: (raw['original_fee_vnd'] as num?)?.toInt(),
      newFeeVnd: (raw['new_fee_vnd'] as num?)?.toInt(),
      feeDifferenceVnd: (raw['fee_difference_vnd'] as num?)?.toInt(),
      note: raw['note'] as String?,
      rejectReason: raw['reject_reason'] as String?,
      version: (raw['version'] as num?)?.toInt() ?? 1,
      expiresAt: DateTime.tryParse(raw['expires_at'] as String? ?? '') ?? DateTime.now(),
      createdAt: DateTime.tryParse(raw['created_at'] as String? ?? '') ?? DateTime.now(),
      resolvedAt: raw['resolved_at'] != null ? DateTime.tryParse(raw['resolved_at'] as String) : null,
    );
  }

  final String changeRequestId;
  final String status;
  final bool isExpired;
  final int timeRemainingSeconds;
  final String source;
  final String targetActor;
  final String? targetDriverId;
  final AddressRecipientView originalRecipient;
  final AddressRecipientView newRecipient;
  final int? originalFeeVnd;
  final int? newFeeVnd;
  final int? feeDifferenceVnd;
  final String? note;
  final String? rejectReason;
  final int version;
  final DateTime expiresAt;
  final DateTime createdAt;
  final DateTime? resolvedAt;

  bool get isPending => status == 'PENDING' && !isExpired;
  bool get isAccepted => status == 'ACCEPTED';
  bool get isRejected => status == 'REJECTED';
  bool get isCancelled => status == 'CANCELLED';
}
