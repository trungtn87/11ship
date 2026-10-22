import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// M07 phone screens. Sample sources feed them and are always labelled; the checks that matter: the shop cannot cancel after pickup, a
// reason is required to cancel, the Shipper sees no phone / address / map before accepting, a lost answer keeps the form and retries with the
// SAME operation key, a conflict reloads, an old position is never drawn as live, and an unknown fee is never 0đ.

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

/// Several short pumps: the screens refresh on timers, so pumpAndSettle would never finish.
Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));
Finder containing(String value) => find.textContaining(value);

DeliveryView _delivery(String id, DeliveryState state, {Set<String> can = const <String>{}, int version = 1}) {
  final DateTime now = DateTime.utc(2026, 10, 18, 9);
  return DeliveryView(
    deliveryId: id,
    code: 'G-$id',
    source: 'DIRECT',
    state: state,
    version: version,
    pickup: const PickupView(shopName: 'Quán Mẫu', phone: '0900000001', addressText: 'Số 1 Phố Mẫu', lat: 22.665, lng: 106.257),
    recipient: const RecipientView(name: 'Người nhận', phone: '0900000002', addressText: 'Số 9 Phố Mẫu'),
    goods: const GoodsView(description: 'Hộp bánh', valueVnd: 150000, paidVnd: 100000),
    fee: const FeeView(mode: 'PICKUP_AGREEMENT', payer: 'CUSTOMER', status: 'UNKNOWN'),
    search: SearchView(startedAt: now.subtract(const Duration(minutes: 3)), expiresAt: now.add(const Duration(minutes: 27)), serverNow: now),
    can: can,
  );
}

/// A shop source whose first calls fail, and that records the operation key of every attempt.
class _FlakyShop extends SampleShopSource {
  _FlakyShop({this.failures = 1});

  int failures;
  final List<String> createKeys = <String>[];

  @override
  Future<DeliveryView> create(NewDeliveryInput input, {required String key}) async {
    createKeys.add(key);
    if (failures > 0) {
      failures--;
      throw const M07Failure(M07FailureKind.offline);
    }
    return super.create(input, key: key);
  }
}

void main() {
  group('models', () {
    test('a delivery parses from the wire and an unknown fee stays null', () {
      final DeliveryView d = DeliveryView.fromJson(<String, Object?>{
        'delivery_id': 'd1',
        'code': 'G-1',
        'source': 'DIRECT',
        'state': 'waiting_driver',
        'version': 3,
        'pickup': <String, Object?>{'shop_name': 'Quán'},
        'recipient': <String, Object?>{'name': 'A', 'phone': '0900000000', 'address_text': 'x', 'lat': null, 'lng': null},
        'goods': <String, Object?>{'description': 'g', 'value_vnd': 1000, 'paid_vnd': 0},
        'fee': <String, Object?>{'mode': 'PICKUP_AGREEMENT', 'payer': 'SHOP', 'amount_vnd': null, 'status': 'UNKNOWN', 'distance_m': null, 'agreement': null},
        'search': <String, Object?>{'started_at': '2026-10-18T09:00:00Z', 'expires_at': '2026-10-18T09:30:00Z', 'server_now': '2026-10-18T09:05:00Z', 'stopped_at': null},
        'can': <String, Object?>{'cancel': true, 'recall': false},
      });
      expect(d.state, DeliveryState.waitingDriver);
      expect(d.fee.amountVnd, isNull);
      expect(d.needsDestination, isTrue);
      expect(d.allows('cancel'), isTrue);
      expect(d.allows('recall'), isFalse);
      expect(d.search.elapsedMinutes, 5);
      expect(d.goods.unpaidVnd, 1000);
    });

    test('a body that is not the contract is refused, not half filled', () {
      expect(() => DeliveryView.fromJson(<String, Object?>{'delivery_id': 1}), throwsFormatException);
      expect(() => deliveryStateOf('on_the_moon'), throwsFormatException);
    });

    test('only waiting / accepted / confirmed / stopped are before pickup', () {
      expect(DeliveryState.waitingDriver.beforePickup, isTrue);
      expect(DeliveryState.accepted.beforePickup, isTrue);
      expect(DeliveryState.delivering.beforePickup, isFalse);
      expect(DeliveryState.completed.beforePickup, isFalse);
      expect(DeliveryState.failed.isActive, isFalse);
    });
  });

  group('11Food — shop', () {
    testWidgets('Q01 defaults to all deliveries, flags what needs attention, filters completed', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShopDeliveryHub(source: source))));
      expect(key('m07-sample-banner'), findsOneWidget);
      expect(key('m07-card-d-wait'), findsOneWidget);
      expect(key('m07-card-d-done'), findsOneWidget);
      expect(containing('Cần xử lý'), findsWidgets); // the stopped search and the open incident
      await tap(tester, key('m07-filter'));
      await tap(tester, key('order-filter-completed'));
      await tap(tester, key('order-filter-apply'));
      expect(key('m07-card-d-done'), findsOneWidget);
      expect(key('m07-card-d-wait'), findsNothing);
      await unmount(tester);
    });

    testWidgets('Q01 empty search reports no matching delivery', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShopDeliveryHub(source: source))));
      await tester.enterText(key('m07-search').first, 'không có mã này');
      await tester.pump(const Duration(milliseconds: 400));
      await settle(tester);
      expect(key('m07-list-empty'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('Q03 searching: server timer, marks, cancel needs a reason and does not touch the order', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'd-wait'));
      expect(key('m07-countdown'), findsOneWidget);
      expect(find.text('5 phút'), findsOneWidget);
      expect(key('m07-cancel'), findsOneWidget);
      await tap(tester, key('m07-cancel'));
      expect(containing('Không tự hủy đơn món'), findsOneWidget);
      // Submitting an empty reason explains the field and keeps the dialog open; Back remains available.
      expect(find.text('Quay lại'), findsOneWidget);
      expect(find.text('Hủy'), findsNothing);
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      expect(tester.widgetList<Text>(find.byType(Text)).any((Text text) => (text.data ?? '').startsWith('Nhập ')), isTrue);
      await tester.enterText(key('m07-reason-field').first, 'Khách đổi ý');
      await settle(tester);
      expect(tester.widget<TextButton>(key('m07-reason-confirm')).onPressed, isNotNull);
      await tap(tester, key('m07-reason-confirm'));
      expect((await source.get('d-wait')).state, DeliveryState.cancelledByMerchant);
      expect(containing('Đã hủy yêu cầu giao'), findsWidgets);
      expect(key('m07-cancel'), findsNothing);
      await unmount(tester);
    });

    testWidgets('Q05 delivering: no cancel button anywhere, position shown with its age', (WidgetTester tester) async {
      await mount(tester, ShopDeliveryDetailScreen(source: SampleShopSource(), deliveryId: 'd-run'));
      expect(key('m07-cancel'), findsNothing);
      expect(containing('Hủy yêu cầu giao'), findsNothing);
      expect(key('m07-location-card'), findsOneWidget);
      // The sample position is 400 s old: it is labelled old, not live.
      expect(containing('Vị trí cũ'), findsWidgets);
      expect(containing('Cập nhật lúc'), findsOneWidget);
      expect(containing('Trực tiếp'), findsNothing);
      await unmount(tester);
    });

    testWidgets('Q04 accepted: shipper card with live position', (WidgetTester tester) async {
      await mount(tester, ShopDeliveryDetailScreen(source: SampleShopSource(), deliveryId: 'd-acc'));
      expect(key('m07-shipper-card'), findsOneWidget);
      expect(containing('Trực tiếp'), findsOneWidget);
      expect(key('m07-cancel'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('Q06 search stopped: call again or cancel, the order is not cancelled', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'd-stop'));
      expect(key('m07-stopped'), findsOneWidget);
      expect(key('m07-recall'), findsOneWidget);
      expect(key('m07-cancel'), findsOneWidget);
      await tap(tester, key('m07-recall'));
      final List<DeliveryView> active = await source.list(history: false);
      expect(active.first.previousDeliveryId, 'd-stop');
      expect(active.first.state, DeliveryState.waitingDriver);
      await unmount(tester);
    });

    testWidgets('Q08 failed delivery: goods stay with the Shipper until the shop confirms they are back', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'd-fail'));
      expect(key('m07-incident'), findsOneWidget);
      expect(containing('Hàng đang ở shipper hoặc chưa rõ'), findsOneWidget);
      expect(key('m07-recall'), findsNothing); // cannot call again while the goods are out
      await tap(tester, key('m07-custody-returned'));
      await tap(tester, key('m07-confirm-yes'));
      expect(containing('Hàng đã về quán'), findsWidgets);
      expect(key('m07-recall'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('a conflict reloads and says the record changed', (WidgetTester tester) async {
      final _ConflictShop source = _ConflictShop();
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'd-wait'));
      await tap(tester, key('m07-cancel'));
      await tester.enterText(key('m07-reason-field').first, 'x');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-action-failed'), findsOneWidget);
      expect(containing('vừa thay đổi'), findsWidgets);
      expect(source.gets, greaterThan(1), reason: 'the screen reloads after a conflict');
      await unmount(tester);
    });

    testWidgets('Q02 a lost answer keeps the form and the retry uses the SAME operation key', (WidgetTester tester) async {
      final _FlakyShop source = _FlakyShop();
      await mount(tester, ShopCallScreen(source: source));
      await tester.enterText(key('m07-f-name').first, 'Chị Lan');
      await tester.enterText(key('m07-f-phone').first, '0912345678');
      await tester.enterText(key('m07-f-address').first, 'Số 5 Phố Mẫu');
      await tester.enterText(key('m07-f-goods').first, 'Bánh');
      await tester.enterText(key('m07-f-value').first, '120000');
      await settle(tester);
      await tap(tester, key('m07-submit-call'));
      expect(find.text('Gọi shipper?'), findsOneWidget); // the summary before sending
      await tap(tester, key('m07-confirm-yes'));
      expect(key('m07-action-failed'), findsOneWidget);
      expect(containing('mất kết nối'), findsWidgets);
      // The typed values are still there.
      expect(find.text('Chị Lan'), findsWidgets);
      await tap(tester, key('m07-submit-call'));
      await tap(tester, key('m07-confirm-yes'));
      expect(source.createKeys.length, 2);
      expect(source.createKeys[0], source.createKeys[1]);
      await unmount(tester);
      ShopCallDraft.clear();
    });

    testWidgets('Q02 checks the form before sending and never sends 0đ for an unknown fee', (WidgetTester tester) async {
      final _FlakyShop source = _FlakyShop(failures: 0);
      await mount(tester, ShopCallScreen(source: source));
      await tap(tester, key('m07-submit-call'));
      expect(find.text('Nhập tên người nhận.'), findsOneWidget);
      expect(tester.widget<TextField>(key('m07-f-name').first).focusNode!.hasFocus, isTrue);
      expect(source.createKeys, isEmpty);
      expect(containing('Chưa ghim điểm giao nên Chưa xác định phí'), findsOneWidget);
      await unmount(tester);
      ShopCallDraft.clear();
    });

    testWidgets('Q02 agreed fee: a phone number in the note is refused', (WidgetTester tester) async {
      final _FlakyShop source = _FlakyShop(failures: 0);
      await mount(tester, ShopCallScreen(source: source));
      await tester.enterText(key('m07-f-name').first, 'Lan');
      await tester.enterText(key('m07-f-phone').first, '0912345678');
      await tester.enterText(key('m07-f-address').first, 'Số 5');
      await tester.enterText(key('m07-f-goods').first, 'Bánh');
      await tester.enterText(key('m07-f-value').first, '1000');
      await tap(tester, key('m07-fee-agreed'));
      await tester.enterText(key('m07-f-amount').first, '25000');
      await tester.enterText(key('m07-f-fee-note').first, 'gọi 0912345678');
      await settle(tester);
      await tap(tester, key('m07-submit-call'));
      expect(containing('không được chứa số điện thoại'), findsOneWidget);
      expect(source.createKeys, isEmpty);
      await unmount(tester);
      ShopCallDraft.clear();
    });
  });

  group('11Ship — shipper', () {
    testWidgets('S01 offer shows only what is allowed before accepting', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShipperDeliveryHub(source: source))));
      await tap(tester, key('m07-ship-tab-offers'));
      expect(key('m07-offer-o-1'), findsOneWidget);
      // No customer phone, no street address, no map: the offer type has no field for them.
      expect(containing('0900000002'), findsNothing);
      expect(containing('Số 9'), findsNothing);
      expect(find.byType(CustomPaint).evaluate().where((e) => e.widget.key == const Key('m07-ship-map')), isEmpty);
      expect(containing('Chưa xác định phí'), findsOneWidget); // the offer without a fee
      expect(tester.widget<N11Button>(key('m07-accept-o-2')).onPressed, isNull); // not eligible
      expect(containing('3 km'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('S01 accepting moves the order to "đang thực hiện"', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShipperDeliveryHub(source: source))));
      await tap(tester, key('m07-ship-tab-offers'));
      await tap(tester, key('m07-accept-o-1'));
      expect((await source.mine(history: false)).map((DeliveryView d) => d.deliveryId), contains('o-1'));
      await unmount(tester);
    });

    testWidgets('S02/S03 before pickup: missing drop-off blocks pickup and asks for pin + fee; release needs a reason', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await mount(tester, ShipperDeliveryDetailScreen(source: source, deliveryId: 'm-acc'));
      expect(key('m07-missing-banner'), findsOneWidget);
      expect(key('m07-pickup'), findsNothing); // the server did not allow pickup yet
      expect(key('m07-confirm-destination'), findsOneWidget);
      expect(key('m07-release'), findsOneWidget);
      expect(containing('Hủy nhận đơn'), findsWidgets);
      await tap(tester, key('m07-release'));
      expect(containing('tìm shipper khác'), findsOneWidget);
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      expect(tester.widgetList<Text>(find.byType(Text)).any((Text text) => (text.data ?? '').startsWith('Nhập ')), isTrue);
      await unmount(tester);
    });

    testWidgets('S04 needs a pin and a fee; without a map it says so', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final DeliveryView d = await source.get('m-acc');
      await mount(tester, ConfirmDestinationScreen(source: source, delivery: d));
      expect(key('m07-no-map'), findsOneWidget);
      await tap(tester, key('m07-dest-submit'));
      expect(find.text('Nhập phí là số nguyên từ 0 đến 10.000.000đ.'), findsOneWidget);
      expect((await source.get('m-acc')).version, d.version);
      await unmount(tester);
    });

    testWidgets('S04 with a pin and an agreed fee confirms the drop-off', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final DeliveryView d = await source.get('m-acc');
      await mount(
        tester,
        ConfirmDestinationScreen(
          source: source,
          delivery: d,
          pinPicker: (BuildContext context, {required void Function(double lat, double lng) onPick, double? lat, double? lng}) =>
              TextButton(key: const Key('fake-pin'), onPressed: () => onPick(22.67, 106.26), child: const Text('ghim')),
        ),
      );
      await tap(tester, key('fake-pin'));
      await tester.enterText(key('m07-agreed-fee').first, '20000');
      await settle(tester);
      await tap(tester, key('m07-dest-submit'));
      final DeliveryView after = await source.get('m-acc');
      expect(after.state, DeliveryState.locationConfirmed);
      expect(after.fee.amountVnd, 20000);
      expect(after.allows('pickup'), isTrue);
      await unmount(tester);
    });

    testWidgets('S06 delivering: no release/cancel, complete and fail only', (WidgetTester tester) async {
      await mount(tester, ShipperDeliveryDetailScreen(source: SampleShipperSource(), deliveryId: 'm-run'));
      expect(key('m07-release'), findsNothing);
      expect(key('m07-pickup'), findsNothing);
      expect(key('m07-complete'), findsOneWidget);
      expect(key('m07-fail'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('S06 completing asks first, then shows the result', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await mount(tester, ShipperDeliveryDetailScreen(source: source, deliveryId: 'm-run'));
      await tap(tester, key('m07-complete'));
      expect(containing('Giao thành công?'), findsOneWidget);
      await tap(tester, key('m07-confirm-yes'));
      expect((await source.get('m-run')).state, DeliveryState.completed);
      expect(key('m07-result'), findsOneWidget);
      expect(key('m07-complete'), findsNothing);
      await unmount(tester);
    });

    testWidgets('S07 failing needs a reason and where the goods are, then shows who is responsible', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final DeliveryView d = await source.get('m-run');
      await mount(tester, FailDeliveryScreen(source: source, delivery: d));
      expect(tester.widget<N11Button>(key('m07-fail-submit')).onPressed, isNull);
      await tap(tester, key('m07-reason-RECIPIENT_UNREACHABLE'));
      expect(tester.widget<N11Button>(key('m07-fail-submit')).onPressed, isNull);
      await tap(tester, key('m07-goods-WITH_SHIPPER'));
      expect(tester.widget<N11Button>(key('m07-fail-submit')).onPressed, isNotNull);
      await tap(tester, key('m07-fail-submit'));
      await tap(tester, key('m07-confirm-yes'));
      expect(key('m07-fail-done'), findsOneWidget);
      expect(key('m07-fail-custody'), findsOneWidget);
      expect(containing('Hàng đang ở shipper hoặc chưa rõ'), findsOneWidget);
      await unmount(tester);
    });
  });

  group('failure texts', () {
    test('every failure kind has a Vietnamese sentence and never a raw code', () {
      for (final M07FailureKind kind in M07FailureKind.values) {
        final String text = M07Failure(kind).message;
        expect(text, isNotEmpty);
        expect(RegExp(r'[A-Z]{3,}_[A-Z]{3,}').hasMatch(text), isFalse);
      }
      expect(const M07Failure(M07FailureKind.refused, code: 'AFTER_PICKUP_NO_CANCEL').message, contains('không hủy'));
    });
  });

  test('delivery helper builds a valid view', () {
    expect(_delivery('x', DeliveryState.accepted).state, DeliveryState.accepted);
  });
}

class _ConflictShop extends SampleShopSource {
  int gets = 0;

  @override
  Future<DeliveryView> get(String id) {
    gets++;
    return super.get(id);
  }

  @override
  Future<DeliveryView> cancel(String id, {required String reason, required int expectedVersion, required String key}) async =>
      throw const M07Failure(M07FailureKind.conflict, code: 'DELIVERY_STATE_CONFLICT');
}
