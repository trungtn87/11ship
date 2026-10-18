import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// The app's parsers against the JSON the REAL backend produced (captured from the integration run on PostgreSQL: tests/integration/m07-delivery.int.spec.ts).
// A field the server renames or drops fails here, not on a phone.

Map<String, Object?> _data(String name) {
  final Object? decoded = jsonDecode(File('test/fixtures/m07/$name.json').readAsStringSync());
  return ((decoded! as Map<String, Object?>)['data']! as Map<String, Object?>);
}

void main() {
  test('the offer a Shipper sees before accepting carries no phone, no street address and no point', () {
    final List<Object?> offers = _data('offers')['offers']! as List<Object?>;
    final OfferView offer = OfferView.fromJson(offers.first);
    expect(offer.eligible, isTrue);
    expect(offer.feeVnd, 10000);
    expect(offer.dropoffAreaText, 'Hai Bà Trưng, Hà Nội');
    expect(jsonEncode(offers.first), isNot(contains('+84')));
    expect(jsonEncode(offers.first), isNot(contains('Phố Huế')));
  });

  test('the shop sees the whole delivery, the Shipper who holds it and its latest position with the time and freshness', () {
    final DeliveryView d = DeliveryView.fromJson(_data('shop_accepted'));
    expect(d.state, DeliveryState.accepted);
    expect(d.assignment?.shipperPhone, isNotNull);
    expect(d.location?.freshness, Freshness.live);
    expect(d.location?.recordedAt, isNotNull);
    expect(d.allows('cancel'), isTrue);
    expect(d.pickup.lat, 21.0);
  });

  test('the Shipper who holds it sees the contacts, the pickup point and the actions allowed now', () {
    final DeliveryView accepted = DeliveryView.fromJson(_data('shipper_accepted'));
    expect(accepted.recipient.phone, '+84912345678');
    expect(accepted.pickup.shopName, 'Fixture shop');
    expect(accepted.allows('pickup'), isTrue);
    expect(accepted.allows('release'), isTrue);
    final DeliveryView running = DeliveryView.fromJson(_data('shipper_delivering'));
    expect(running.state, DeliveryState.delivering);
    expect(running.allows('release'), isFalse, reason: 'no ordinary cancel after pickup');
    expect(running.allows('complete'), isTrue);
    expect(running.allows('fail'), isTrue);
  });

  test('a failed delivery shows the open custody incident to the shop and lets it settle the goods', () {
    final DeliveryView failed = DeliveryView.fromJson(_data('shop_failed'));
    expect(failed.state, DeliveryState.failed);
    expect(failed.incident?.custody, 'SHIPPER');
    expect(failed.allows('resolve_custody'), isTrue);
    expect(failed.allows('recall'), isFalse);
    expect(failed.timeline, isNotEmpty);
  });

  test("the Shipper's history after giving a delivery back keeps their own outcome and shows no contact", () {
    final List<Object?> list = _data('mine_after_release')['deliveries']! as List<Object?>;
    final DeliveryView d = DeliveryView.fromJson(list.first);
    expect(d.ownOutcome, 'released');
    expect(d.recipient.phone, isNull);
    expect(d.recipient.addressText, isNull);
    expect(d.pickup.phone, isNull);
  });

  test('the shop list is a list of the same shape', () {
    final List<Object?> list = _data('shop_list')['deliveries']! as List<Object?>;
    expect(DeliveryView.fromJson(list.first).state, DeliveryState.waitingDriver);
  });
}
