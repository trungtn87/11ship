import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// The HTTP side of the M07 sources against a scripted server: the contract body and path of every command, the Idempotency-Key, the strict parse
// of an answer, and the closed mapping from a refusal / lost answer to an M07Failure.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> deliveryJson({String id = 'd1', String state = 'waiting_driver', int version = 1}) => <String, Object?>{
      'delivery_id': id,
      'code': 'G-1',
      'source': 'DIRECT',
      'state': state,
      'version': version,
      'pickup': <String, Object?>{'shop_name': 'Quán', 'lat': 22.6, 'lng': 106.2},
      'recipient': <String, Object?>{'name': 'A', 'phone': '0900000000', 'address_text': 'x', 'lat': null, 'lng': null},
      'goods': <String, Object?>{'description': 'g', 'value_vnd': 1000, 'paid_vnd': 0},
      'fee': <String, Object?>{'mode': 'PICKUP_AGREEMENT', 'payer': 'CUSTOMER', 'amount_vnd': null, 'status': 'UNKNOWN', 'distance_m': null, 'agreement': null},
      'search': <String, Object?>{'started_at': '2026-10-18T09:00:00Z', 'expires_at': '2026-10-18T09:30:00Z', 'server_now': '2026-10-18T09:01:00Z', 'stopped_at': null},
      'can': <String, Object?>{'cancel': true},
    };

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

const NewDeliveryInput input = NewDeliveryInput(
  recipientName: 'Lan',
  recipientPhone: '0912345678',
  addressText: 'Số 5',
  goodsDescription: 'Bánh',
  goodsValueVnd: 120000,
  paidVnd: 20000,
  feePayer: 'CUSTOMER',
);

void main() {
  test('shop: list asks the right scope and query, and parses the deliveries', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/shop/me/deliveries?scope=history&q=G-1'] = (String m, String p, Map<String, String> h, String b) async =>
        json(200, <String, Object?>{'data': <String, Object?>{'deliveries': <Object?>[deliveryJson(state: 'completed')]}});
    final List<DeliveryView> list = await HttpShopDeliverySource(session: t.session).list(history: true, query: ' G-1 ');
    expect(list.single.state, DeliveryState.completed);
    expect(list.single.fee.amountVnd, isNull);
  });

  test('shop: create sends the contract body with the key, no coordinates when not pinned', () async {
    final t = await signedIn();
    t.api.routes['POST /v1/shop/me/deliveries'] = (String m, String p, Map<String, String> h, String b) async => json(201, <String, Object?>{'data': <String, Object?>{'delivery': deliveryJson()}});
    final DeliveryView made = await HttpShopDeliverySource(session: t.session).create(input, key: '11111111-1111-4111-8111-111111111111');
    expect(made.code, 'G-1');
    final RecordedRequest sent = t.api.to('POST', '/v1/shop/me/deliveries').single;
    expect(sent.headers['idempotency-key'], '11111111-1111-4111-8111-111111111111');
    final Map<String, Object?> body = jsonDecode(sent.body) as Map<String, Object?>;
    expect(body['recipient_name'], 'Lan');
    expect(body['goods_value_vnd'], 120000);
    expect(body['paid_vnd'], 20000);
    expect(body.containsKey('dropoff_lat'), isFalse);
    expect(body.containsKey('agreed_fee'), isFalse);
  });

  test('shop: an agreed fee is sent as the M06 proposal', () async {
    const NewDeliveryInput agreed = NewDeliveryInput(
        recipientName: 'Lan', recipientPhone: '0912345678', addressText: 'x', goodsDescription: 'g', goodsValueVnd: 1, paidVnd: 0, feePayer: 'SHOP', agreedReasonCode: 'BULKY', agreedReasonNote: 'To', agreedAmountVnd: 30000);
    expect(agreed.toJson()['agreed_fee'], <String, Object?>{'reason_code': 'BULKY', 'reason_note': 'To', 'amount_vnd': 30000});
  });

  test('shop: a fee band is an estimate sent only for an address with no map point and never with an agreed fee', () async {
    const NewDeliveryInput banded = NewDeliveryInput(recipientName: 'Lan', recipientPhone: '0912345678', addressText: 'x', goodsDescription: 'g', goodsValueVnd: 1, paidVnd: 0, feePayer: 'SHOP', feeBand: 1);
    expect(banded.toJson()['fee_band'], 1);
    const NewDeliveryInput pinned = NewDeliveryInput(recipientName: 'Lan', recipientPhone: '0912345678', addressText: 'x', lat: 22.6, lng: 106.2, goodsDescription: 'g', goodsValueVnd: 1, paidVnd: 0, feePayer: 'SHOP', feeBand: 1);
    expect(pinned.toJson().containsKey('fee_band'), isFalse);
    const NewDeliveryInput agreed = NewDeliveryInput(recipientName: 'Lan', recipientPhone: '0912345678', addressText: 'x', goodsDescription: 'g', goodsValueVnd: 1, paidVnd: 0, feePayer: 'SHOP', feeBand: 1, agreedAmountVnd: 5000, agreedReasonCode: 'URGENT');
    expect(agreed.toJson().containsKey('fee_band'), isFalse);
  });

  test('a lost answer is offline (outcome unknown) and the retry carries the same key', () async {
    final t = await signedIn();
    t.api.routes['POST /v1/shop/me/deliveries'] = (String m, String p, Map<String, String> h, String b) async => json(201, <String, Object?>{'data': <String, Object?>{'delivery': deliveryJson()}});
    final HttpShopDeliverySource source = HttpShopDeliverySource(session: t.session);
    t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
    await expectLater(source.create(input, key: '22222222-2222-4222-8222-222222222222'), throwsA(isA<M07Failure>().having((M07Failure f) => f.kind, 'kind', M07FailureKind.offline)));
    await source.create(input, key: '22222222-2222-4222-8222-222222222222');
    final List<RecordedRequest> posts = t.api.to('POST', '/v1/shop/me/deliveries');
    expect(posts.length, 2);
    expect(posts[0].headers['idempotency-key'], posts[1].headers['idempotency-key']);
  });

  test('refusals map to closed failures: conflict, not ready, refused, server', () async {
    final t = await signedIn();
    final HttpShopDeliverySource source = HttpShopDeliverySource(session: t.session);
    Future<M07Failure> fail(int status, String code) async {
      t.api.routes['POST /v1/shop/me/deliveries/d1/cancel'] = (String m, String p, Map<String, String> h, String b) async => apiError(status, code);
      try {
        await source.cancel('d1', reason: 'x', expectedVersion: 1, key: '33333333-3333-4333-8333-333333333333');
      } on M07Failure catch (failure) {
        return failure;
      }
      throw StateError('no failure');
    }

    expect((await fail(409, 'DELIVERY_STATE_CONFLICT')).kind, M07FailureKind.conflict);
    expect((await fail(409, 'VERSION_CONFLICT')).kind, M07FailureKind.conflict);
    expect((await fail(409, 'AFTER_PICKUP_NO_CANCEL')).kind, M07FailureKind.refused);
    expect((await fail(409, 'AFTER_PICKUP_NO_CANCEL')).message, contains('không hủy'));
    expect((await fail(403, 'SHIPPER_FAIL_NOT_ALLOWED')).message, contains('gọi quán'));
    expect((await fail(400, 'FEE_REQUIRED')).message, contains('mức phí'));
    expect((await fail(503, 'ORDER_MODULE_NOT_READY')).kind, M07FailureKind.notReady);
    expect((await fail(500, 'INTERNAL')).kind, M07FailureKind.refused);
  });

  test('a body that is not the contract is a server failure, never a half-filled delivery', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/shop/me/deliveries/d1'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'delivery_id': 'd1'}});
    await expectLater(HttpShopDeliverySource(session: t.session).get('d1'), throwsA(isA<M07Failure>().having((M07Failure f) => f.kind, 'kind', M07FailureKind.server)));
  });

  test('shipper: the commands use the contract paths and bodies', () async {
    final t = await signedIn();
    final HttpShipperDeliverySource source = HttpShipperDeliverySource(session: t.session);
    for (final String tail in <String>['accept', 'release', 'destination', 'pickup', 'complete']) {
      t.api.routes['POST /v1/driver/deliveries/d1/$tail'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'delivery': deliveryJson(state: 'accepted')}});
    }
    const String k = '44444444-4444-4444-8444-444444444444';
    await source.accept('d1', key: k);
    await source.release('d1', reason: 'xe hỏng', expectedVersion: 2, key: k);
    await source.confirmFee('d1', feeVnd: 20000, expectedVersion: 2, key: k);
    await source.pickup('d1', expectedVersion: 3, key: k);
    await source.complete('d1', expectedVersion: 4, key: k);
    Map<String, Object?> bodyOf(String tail) => jsonDecode(t.api.to('POST', '/v1/driver/deliveries/d1/$tail').single.body) as Map<String, Object?>;
    expect(bodyOf('release'), <String, Object?>{'reason': 'xe hỏng', 'expected_version': 2});
    // Only the agreed amount is sent: the Shipper never pins a point any more.
    expect(bodyOf('destination'), <String, Object?>{'fee_vnd': 20000, 'expected_version': 2});
    expect(bodyOf('pickup'), <String, Object?>{'expected_version': 3});
    // There is no way to report a failed delivery from the app.
    expect(t.api.to('POST', '/v1/driver/deliveries/d1/fail'), isEmpty);
  });

  test('shipper: an offer parses with no field for a phone, a street address or a drop-off position', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/driver/deliveries/offers'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{
          'data': <String, Object?>{
            'offers': <Object?>[
              <String, Object?>{
                'delivery_id': 'o1',
                'code': 'G-9',
                'shop': <String, Object?>{'name': 'Quán', 'area_text': 'Phường A'},
                'distance_to_shop_m': 1500,
                'dropoff_area_text': null,
                'destination_known': false,
                'goods_value_vnd': 50000,
                'unpaid_vnd': 0,
                'fee_vnd': null,
                'fee_status': 'UNKNOWN',
                'fee_payer': 'SHOP',
                'search_expires_at': '2026-10-18T09:30:00Z',
                'server_now': '2026-10-18T09:10:00Z',
                'eligible': false,
                'reasons': <String>['OUT_OF_SEARCH_RADIUS'],
                'agreement': null,
              },
            ],
          },
        });
    final List<OfferView> offers = await HttpShipperDeliverySource(session: t.session).offers();
    expect(offers.single.feeVnd, isNull);
    expect(offers.single.remaining, const Duration(minutes: 20));
    expect(offers.single.reasons, <String>['OUT_OF_SEARCH_RADIUS']);
  });
}
