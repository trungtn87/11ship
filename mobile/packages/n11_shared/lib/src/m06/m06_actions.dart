import 'm06_models.dart';

// The actions of the fee agreement. They exist only when the module that carries them is connected (M07 calls and answers deliveries; M06 holds the
// amounts and rules): until then the apps get null, every control that would send one stays disabled with its reason, and nothing is simulated.
// An implementation throws on a refusal or a lost answer; the screen shows "Chưa gửi được" and the person tries again.

/// What the SHOP can do about the fee of a delivery it is requesting.
abstract class ShopFeeActions {
  /// Use the fee of the three bands (only when there is one).
  Future<void> useStandard(FeePayer payer);

  /// Propose an agreed amount for a stated reason. [note] is shown to Shippers before they accept: no phone number or address.
  Future<void> propose({required FeePayer payer, required FeeReason reason, String? note, required int amountVnd});

  /// Accept / reject the Shipper's counter-offer. Rejecting keeps the original proposal and the search goes on.
  Future<void> acceptCounter();
  Future<void> rejectCounter();
}

/// What a SHIPPER can do about the proposed fee before accepting the delivery.
abstract class ShipperFeeActions {
  Future<void> agree();
  Future<void> skip();
  Future<void> counter(int amountVnd);
}
