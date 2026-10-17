import 'm06_models.dart';
import 'm06_source.dart';

// Sample data of the approved reference screens, for the preview build (--dart-define=M06_UI_PREVIEW=true) and the tests. It is NEVER used by a
// real build and every screen it feeds says so. Nothing in it is a real order, fee, phone number or address.

const String kM06SampleLabel = 'Dữ liệu minh họa · không phải đơn hay phí thật';

class SampleM06Source
    implements ShippingFeeSource, OrderOfferSource, BatchEvaluationSource {
  const SampleM06Source(
      {this.feeKnown = true,
      this.eligible = true,
      this.reasonCodes = const <String>[]});

  /// False: a delivery without a drop-off position (the fee must read "Chưa xác định phí", never 0đ).
  final bool feeKnown;
  final bool eligible;
  final List<String> reasonCodes;

  @override
  bool get isSample => true;

  @override
  Future<M06Load<ShippingFeeView>> fee() async => M06Ready<ShippingFeeView>(
        feeKnown
            ? const ShippingFeeView(
                pickupConfirmed: true,
                dropoffChosen: true,
                distanceMeters: 5500,
                feeVnd: 15000)
            : const ShippingFeeView(
                pickupConfirmed: true, dropoffChosen: false),
      );

  @override
  Future<M06Load<OrderOfferView>> offer() async => M06Ready<OrderOfferView>(
        OrderOfferView(
          orderRef: '#GH-1024',
          shopName: 'Quán Ốc 11',
          pickupArea: 'Khu vực TP. Cao Bằng',
          dropoffArea: 'Khu vực khách cung cấp',
          distanceToShopMeters: 2800,
          goodsVnd: 180000,
          shipFeeVnd: feeKnown ? 15000 : null,
          eligibility:
              EligibilityView(eligible: eligible, reasonCodes: reasonCodes),
        ),
      );

  @override
  Future<M06Load<BatchEvaluationView>> evaluation() async =>
      M06Ready<BatchEvaluationView>(
        BatchEvaluationView(
          orderRef: '#GH-1008',
          originalEta: DateTime(2026, 10, 17, 18, 30),
          maxDelaySeconds: 300,
          attempts: <BatchAttempt>[
            BatchAttempt(
                label: 'đơn B',
                ok: true,
                etaAfter: DateTime(2026, 10, 17, 18, 33),
                addedDelaySeconds: 180),
            BatchAttempt(
                label: 'thêm C',
                ok: false,
                etaAfter: DateTime(2026, 10, 17, 18, 37),
                addedDelaySeconds: 420,
                reasonCode: 'BATCH_DELAY_EXCEEDED'),
          ],
        ),
      );
}
