import 'm06_models.dart';

// The data seam of the M06 phone screens. A screen asks a source and draws whatever state comes back; it never invents a value.
//
// Real builds use [NotReadySource]: every read says what is missing (M07 calls/accepts the delivery, M14 gives the route and the position),
// so no fee, no offer and no evaluation exists. There is no app-facing M06 API yet (the quote and eligibility endpoints need M07 and M14), so
// nothing is connected and nothing is simulated. [SampleM06Source] (m06_sample.dart) feeds the preview build and the tests only, always
// labelled. When M07/M14 land, a real source implements these interfaces and the screens stay as they are.

const String kM06NotReadyReason =
    'Cần M07 (gọi ship, nhận đơn) và M14 (tuyến đường, vị trí) để có dữ liệu thật.';

sealed class M06Load<T> {
  const M06Load();
}

class M06Loading<T> extends M06Load<T> {
  const M06Loading();
}

/// The data does not exist yet because a module it depends on is not connected.
class M06NotReady<T> extends M06Load<T> {
  const M06NotReady(this.reason);
  final String reason;
}

class M06Failed<T> extends M06Load<T> {
  const M06Failed(this.message);
  final String message;
}

class M06Ready<T> extends M06Load<T> {
  const M06Ready(this.value);
  final T value;
}

abstract class ShippingFeeSource {
  /// True only for sample data (preview/tests): every screen then carries the sample banner.
  bool get isSample;
  Future<M06Load<ShippingFeeView>> fee();
}

abstract class OrderOfferSource {
  bool get isSample;
  Future<M06Load<OrderOfferView>> offer();
}

abstract class BatchEvaluationSource {
  bool get isSample;
  Future<M06Load<BatchEvaluationView>> evaluation();
}

/// The honest default: nothing is connected, so every read says so.
class NotReadySource
    implements ShippingFeeSource, OrderOfferSource, BatchEvaluationSource {
  const NotReadySource([this.reason = kM06NotReadyReason]);

  final String reason;

  @override
  bool get isSample => false;

  @override
  Future<M06Load<ShippingFeeView>> fee() async =>
      M06NotReady<ShippingFeeView>(reason);

  @override
  Future<M06Load<OrderOfferView>> offer() async =>
      M06NotReady<OrderOfferView>(reason);

  @override
  Future<M06Load<BatchEvaluationView>> evaluation() async =>
      M06NotReady<BatchEvaluationView>(reason);
}
