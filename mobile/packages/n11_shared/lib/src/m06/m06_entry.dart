import 'package:flutter/material.dart';

import '../account/account_views.dart';
import '../widgets/components.dart';
import 'm06_sample.dart';
import 'm06_source.dart';
import 'm06_views.dart';

// How the two apps reach the M06 screens. Real builds get [NotReadySource] (the screens say what is missing and show no fee, offer or evaluation).
// The sample source exists only in a preview build: flutter build apk --dart-define=M06_UI_PREVIEW=true. The main tabs and navigation are unchanged.

const bool kM06UiPreview = bool.fromEnvironment('M06_UI_PREVIEW');

/// The one source of this build for all three screens.
({ShippingFeeSource fee, OrderOfferSource offer, BatchEvaluationSource batch})
    buildM06Sources({bool preview = kM06UiPreview}) => preview
        ? (
            fee: const SampleM06Source(),
            offer: const SampleM06Source(),
            batch: const SampleM06Source()
          )
        : (
            fee: const NotReadySource(),
            offer: const NotReadySource(),
            batch: const NotReadySource()
          );

String _sub(bool sample) =>
    sample ? kM06SampleLabel : 'Chưa sẵn sàng · cần M07 và M14';

/// 11Food, "Đơn hàng": the "Phí giao hàng" row (fee, distance and who pays).
class ShippingFeeEntry extends StatelessWidget {
  const ShippingFeeEntry({super.key, this.source});

  final ShippingFeeSource? source;

  @override
  Widget build(BuildContext context) {
    final ShippingFeeSource fee = source ?? buildM06Sources().fee;
    return N11List(
      children: <Widget>[
        N11ListItem(
          key: const Key('m06-fee-entry'),
          icon: Icons.local_shipping_outlined,
          title: 'Phí giao hàng',
          sub: _sub(fee.isSample),
          onTap: () => Navigator.of(context)
              .push(n11Route(ShippingFeeScreen(source: fee))),
        ),
      ],
    );
  }
}

/// 11Ship, "Đơn hàng": "Đơn có thể nhận" and "Đánh giá ghép đơn".
class OrderEvaluationEntries extends StatelessWidget {
  const OrderEvaluationEntries({super.key, this.offer, this.batch});

  final OrderOfferSource? offer;
  final BatchEvaluationSource? batch;

  @override
  Widget build(BuildContext context) {
    final OrderOfferSource offerSource = offer ?? buildM06Sources().offer;
    final BatchEvaluationSource batchSource = batch ?? buildM06Sources().batch;
    return N11List(
      children: <Widget>[
        N11ListItem(
          key: const Key('m06-offer-entry'),
          icon: Icons.inventory_2_outlined,
          title: 'Đơn có thể nhận',
          sub: _sub(offerSource.isSample),
          onTap: () => Navigator.of(context)
              .push(n11Route(OrderOfferScreen(source: offerSource))),
        ),
        N11ListItem(
          key: const Key('m06-batch-entry'),
          icon: Icons.merge_type,
          title: 'Đánh giá ghép đơn',
          sub: _sub(batchSource.isSample),
          onTap: () => Navigator.of(context)
              .push(n11Route(BatchEvaluationScreen(source: batchSource))),
        ),
      ],
    );
  }
}
