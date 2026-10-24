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
        'fee': <String, Object?>{'mode': 'STANDARD', 'payer': 'SHOP', 'amount_vnd': null, 'status': 'UNKNOWN', 'distance_m': null, 'agreement': null, 'decider': 'SHOP', 'basis': null},
        'search': <String, Object?>{'started_at': '2026-10-18T09:00:00Z', 'expires_at': '2026-10-18T09:30:00Z', 'server_now': '2026-10-18T09:05:00Z', 'stopped_at': null},
        'can': <String, Object?>{'cancel': true, 'recall': false, 'confirm_fee': true},
      });
      expect(d.state, DeliveryState.waitingDriver);
      expect(d.fee.amountVnd, isNull);
      // What the Shipper is asked follows the server's permission, not a null amount or a missing map point.
      expect(d.recipient.hasPoint, isFalse);
      expect(d.needsFee, isTrue);
      expect(d.fee.decider, 'SHOP');
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

    testWidgets('Q05 delivering a DIRECT call: status only (no Shipper route); the creating shop alone may cancel, with a clear warning', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'd-run'));
      expect(key('m07-location-card'), findsNothing);
      expect(containing('Trực tiếp'), findsNothing);
      expect(containing('phí không sửa được'), findsOneWidget);
      expect(containing('Hủy giao (shipper đã lấy hàng)'), findsOneWidget);
      await tap(tester, key('m07-cancel'));
      expect(containing('hàng vẫn ở shipper'), findsOneWidget);
      await tester.enterText(key('m07-reason-field').first, 'Khách không nhận nữa');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      final DeliveryView after = await source.get('d-run');
      expect(after.state, DeliveryState.cancelledByMerchant);
      // The goods are NOT assumed to be back: an open incident asks the shop to settle them before it can call again.
      expect(after.incident?.isOpen, isTrue);
      expect(key('m07-incident'), findsOneWidget);
      expect(key('m07-recall'), findsNothing);
      await unmount(tester);
    });

    testWidgets('Q05 delivering a customer\'s order: the shop cannot cancel (the customer does) and sees the Shipper\'s position', (WidgetTester tester) async {
      final SampleShopSource source = SampleShopSource();
      final DeliveryView base = await source.get('d-run');
      final _OrderShop orderShop = _OrderShop(base.copyWith(can: const <String>{}, location: LocationView(lat: 22.666, lng: 106.258, recordedAt: DateTime.utc(2026, 10, 18, 8, 59), ageSeconds: 60, freshness: Freshness.live)));
      await mount(tester, ShopDeliveryDetailScreen(source: orderShop, deliveryId: 'd-run'));
      expect(key('m07-cancel'), findsNothing);
      expect(containing('chỉ khách mới hủy được'), findsOneWidget);
      expect(key('m07-location-card'), findsOneWidget);
      await unmount(tester);
    });

    testWidgets('Q04 accepted: shipper card, no Shipper route for a DIRECT call, cancel allowed before pickup', (WidgetTester tester) async {
      await mount(tester, ShopDeliveryDetailScreen(source: SampleShopSource(), deliveryId: 'd-acc'));
      expect(key('m07-shipper-card'), findsOneWidget);
      expect(containing('Trực tiếp'), findsNothing);
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
      await tap(tester, key('m07-band-0'));
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
      // An address is enough: no map is asked for, and the fee is a band of the table (an estimate) or an agreed amount.
      expect(key('m07-band-0'), findsOneWidget);
      expect(containing('không phải quãng đường đo trên bản đồ'), findsOneWidget);
      expect(containing('Ghim điểm giao'), findsNothing);
      expect(key('m07-f-paid'), findsNothing);
      await unmount(tester);
      ShopCallDraft.clear();
    });

    testWidgets('Q02 an address-only call needs a fee band (or an agreed fee) and sends the chosen band, never 0đ', (WidgetTester tester) async {
      final _FlakyShop source = _FlakyShop(failures: 0);
      await mount(tester, ShopCallScreen(source: source));
      await tester.enterText(key('m07-f-name').first, 'Lan');
      await tester.enterText(key('m07-f-phone').first, '0912345678');
      await tester.enterText(key('m07-f-address').first, 'Số 5 Phố Mẫu');
      await tester.enterText(key('m07-f-goods').first, 'Bánh');
      await tester.enterText(key('m07-f-value').first, '120000');
      await settle(tester);
      await tap(tester, key('m07-submit-call'));
      expect(key('m07-form-problem'), findsOneWidget);
      expect(containing('chọn mốc phí giao'), findsOneWidget);
      expect(source.createKeys, isEmpty);
      await tap(tester, key('m07-band-1'));
      await tap(tester, key('m07-submit-call'));
      expect(containing('15.000đ (ước tính theo mốc)'), findsOneWidget);
      expect(containing('Còn phải thu'), findsNothing);
      await tap(tester, key('m07-confirm-yes'));
      expect(source.createKeys, hasLength(1));
      final DeliveryView made = (await source.list(history: false)).first;
      expect(made.fee.amountVnd, 15000);
      expect(made.fee.estimated, isTrue);
      expect(made.recipient.hasPoint, isFalse);
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

    testWidgets('S02/S03 before pickup: a fee never settled blocks pickup and asks for the agreed amount only; release needs a reason', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await mount(tester, ShipperDeliveryDetailScreen(source: source, deliveryId: 'm-acc'));
      expect(key('m07-missing-banner'), findsOneWidget);
      expect(containing('Phí giao chưa được chốt'), findsWidgets);
      expect(key('m07-pickup'), findsNothing); // the server did not allow pickup yet
      expect(key('m07-confirm-fee'), findsOneWidget);
      expect(containing('Điểm giao'), findsNothing);
      expect(containing('ghim'), findsNothing);
      expect(key('m07-release'), findsOneWidget);
      expect(containing('Hủy nhận đơn'), findsWidgets);
      await tap(tester, key('m07-release'));
      expect(containing('tìm shipper khác'), findsOneWidget);
      await tap(tester, key('m07-reason-confirm'));
      expect(key('m07-reason-dialog'), findsOneWidget);
      expect(tester.widgetList<Text>(find.byType(Text)).any((Text text) => (text.data ?? '').startsWith('Nhập ')), isTrue);
      await unmount(tester);
    });

    testWidgets('S04 asks only for the agreed fee, no map; a bad amount is explained and nothing is sent', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final DeliveryView d = await source.get('m-acc');
      await mount(tester, ConfirmFeeScreen(source: source, delivery: d));
      expect(key('m07-no-map'), findsNothing);
      await tap(tester, key('m07-fee-submit'));
      expect(find.text('Nhập phí là số nguyên từ 0 đến 10.000.000đ.'), findsOneWidget);
      expect((await source.get('m-acc')).version, d.version);
      await unmount(tester);
    });

    testWidgets('S04 with an agreed fee the Shipper can pick up in one more step', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final DeliveryView d = await source.get('m-acc');
      await mount(tester, ConfirmFeeScreen(source: source, delivery: d));
      await tester.enterText(key('m07-agreed-fee').first, '20000');
      await settle(tester);
      await tap(tester, key('m07-fee-submit'));
      final DeliveryView after = await source.get('m-acc');
      expect(after.state, DeliveryState.locationConfirmed);
      expect(after.fee.amountVnd, 20000);
      expect(after.allows('pickup'), isTrue);
      expect(after.needsFee, isFalse);
      await unmount(tester);
    });

    testWidgets('S06 delivering: no release, no cancel and NO "Giao thất bại" — only complete, with a note to call the shop', (WidgetTester tester) async {
      await mount(tester, ShipperDeliveryDetailScreen(source: SampleShipperSource(), deliveryId: 'm-run'));
      expect(key('m07-release'), findsNothing);
      expect(key('m07-pickup'), findsNothing);
      expect(key('m07-fail'), findsNothing);
      expect(containing('Giao thất bại'), findsNothing);
      expect(key('m07-complete'), findsOneWidget);
      expect(key('m07-after-pickup-note'), findsOneWidget);
      expect(containing('gọi quán để thống nhất'), findsWidgets);
      await unmount(tester);
    });

    testWidgets('S06 a fee that is settled shows one "Đã nhận hàng" step and no fee screen', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      await source.accept('o-1', key: 'k');
      await mount(tester, ShipperDeliveryDetailScreen(source: source, deliveryId: 'o-1'));
      expect(key('m07-pickup'), findsOneWidget);
      expect(key('m07-confirm-fee'), findsNothing);
      expect(key('m07-missing-banner'), findsNothing);
      expect(containing('Còn phải thu'), findsNothing);
      expect(containing('Đã thanh toán'), findsNothing);
      await tap(tester, key('m07-pickup'));
      expect(containing('Xác nhận đã nhận hàng?'), findsOneWidget);
      await tap(tester, key('m07-confirm-yes'));
      expect((await source.get('o-1')).state, DeliveryState.delivering);
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

    testWidgets('S01 a fee in force can be questioned BEFORE taking (a table fee has no agreement): the button sends the amount; with a proposal waiting the offer cannot be taken', (WidgetTester tester) async {
      final _TableOfferShipper source = _TableOfferShipper();
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShipperDeliveryHub(source: source))));
      await tap(tester, key('m07-ship-tab-offers'));
      expect(key('m07-fee-counter'), findsOneWidget);
      expect(key('m07-fee-agree'), findsNothing); // nothing to agree to: the fee is already settled
      await tap(tester, key('m07-fee-counter'));
      await tester.enterText(find.descendant(of: key('m07-counter-amount'), matching: find.byType(EditableText)), '20000');
      await tap(tester, key('m07-counter-send'));
      expect(source.proposed, <int>[20000]);
      // The server now reports the waiting proposal: the offer says so and "Nhận đơn" is closed until it is answered.
      expect(key('m07-offer-waiting'), findsOneWidget);
      expect(containing('đang chờ quán (người trả phí) trả lời'), findsOneWidget);
      expect(tester.widget<N11Button>(key('m07-accept-t-1')).onPressed, isNull);
      expect(key('m07-fee-counter'), findsNothing);
      await unmount(tester);
    });

    testWidgets('S06 after taking and before the pickup: the Shipper may propose another fee, then pickup closes until the payer answers; nothing offers a failed delivery', (WidgetTester tester) async {
      final _HeldShipper source = _HeldShipper();
      await mount(tester, ShipperDeliveryDetailScreen(source: source, deliveryId: 'h-1'));
      expect(key('m07-propose-fee'), findsOneWidget);
      expect(key('m07-pickup'), findsOneWidget);
      expect(key('m07-release'), findsOneWidget);
      expect(key('m07-fee-waiting-banner'), findsNothing);
      await tap(tester, key('m07-propose-fee'));
      await tester.enterText(find.descendant(of: key('m07-counter-amount'), matching: find.byType(EditableText)), '18000');
      await tap(tester, key('m07-counter-send'));
      expect(source.proposed, <int>[18000]);
      expect(key('m07-fee-waiting-banner'), findsOneWidget);
      expect(containing('Chưa nhận hàng được cho đến khi khách đồng ý'), findsOneWidget);
      expect(key('m07-pickup'), findsNothing);
      expect(key('m07-propose-fee'), findsNothing);
      expect(key('m07-release'), findsOneWidget); // giving the delivery up stays possible
      expect(key('m07-fail'), findsNothing);
      await unmount(tester);
    });

    testWidgets('S06 once picked up there is no way to change the fee: no proposal button at all', (WidgetTester tester) async {
      await mount(tester, ShipperDeliveryDetailScreen(source: SampleShipperSource(), deliveryId: 'm-run'));
      expect(key('m07-propose-fee'), findsNothing);
      expect(key('m07-fee-waiting-banner'), findsNothing);
      await unmount(tester);
    });

    testWidgets('S08 a turn that ended because the proposed fee was not agreed says so in the history', (WidgetTester tester) async {
      final DeliveryView ended = _held(ownOutcome: 'fee_not_agreed', state: DeliveryState.cancelledByMerchant, can: const <String>{});
      await mount(tester, Scaffold(body: SingleChildScrollView(child: ShipperDeliveryHub(source: _FixedMine(<DeliveryView>[ended])))));
      await tap(tester, key('m07-ship-tab-history'));
      expect(containing('Phí không được đồng ý'), findsOneWidget);
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

  group('11Food — shop: a Shipper\'s other fee', () {
    testWidgets('Q09 the shop pays: it answers Đồng ý / Từ chối, also after the Shipper took the delivery', (WidgetTester tester) async {
      final _NegotiationShop source = _NegotiationShop(decider: 'SHOP', can: const <String>{'cancel', 'decide_fee'});
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'n-1'));
      expect(key('m07-fee-negotiation'), findsOneWidget);
      expect(containing('Phí hiện tại'), findsWidgets);
      expect(key('m07-wait-customer-fee'), findsNothing);
      await tap(tester, key('m07-counter-reject'));
      expect(source.answers, <bool>[false]);
      await unmount(tester);
      final _NegotiationShop accepting = _NegotiationShop(decider: 'SHOP', can: const <String>{'cancel', 'decide_fee'});
      await mount(tester, ShopDeliveryDetailScreen(source: accepting, deliveryId: 'n-1'));
      await tap(tester, key('m07-counter-accept'));
      expect(accepting.answers, <bool>[true]);
      await unmount(tester);
    });

    testWidgets('Q09 an order the CUSTOMER pays: the shop only waits (the customer decides in 11Food) and has no buttons', (WidgetTester tester) async {
      final _NegotiationShop source = _NegotiationShop(decider: 'CUSTOMER', can: const <String>{'cancel', 'wait_customer_fee'});
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'n-1'));
      expect(key('m07-fee-negotiation'), findsOneWidget);
      expect(key('m07-wait-customer-fee'), findsOneWidget);
      expect(key('m07-counter-accept'), findsNothing);
      expect(key('m07-counter-reject'), findsNothing);
      await unmount(tester);
    });

    testWidgets('Q09 a DIRECT call the customer pays: the shop answers for the customer and the screen says that is how it is recorded', (WidgetTester tester) async {
      final _NegotiationShop source = _NegotiationShop(decider: 'SHOP', payer: 'CUSTOMER', can: const <String>{'cancel', 'decide_fee'});
      await mount(tester, ShopDeliveryDetailScreen(source: source, deliveryId: 'n-1'));
      expect(containing('xác nhận thay khách'), findsOneWidget);
      expect(key('m07-counter-accept'), findsOneWidget);
      await unmount(tester);
    });
  });

  group('wire: the proposal that waits for the payer', () {
    test('the fee and the offer carry it; an older server (no field) still lets an agreed proposal be countered, as before', () {
      final FeeView fee = FeeView.fromJson(<String, Object?>{
        'mode': 'STANDARD',
        'payer': 'CUSTOMER',
        'status': 'FINAL',
        'amount_vnd': 15000,
        'negotiation': <String, Object?>{'state': 'WAITING', 'current_vnd': 15000, 'offered_vnd': 20000, 'decider': 'CUSTOMER', 'by_me': true, 'answer_expires_at': '2026-10-24T10:05:00Z'},
      });
      expect(fee.negotiation?.offeredVnd, 20000);
      expect(fee.negotiation?.currentVnd, 15000);
      expect(fee.negotiation?.deciderText, 'khách');
      expect(fee.negotiation?.byMe, isTrue);
      expect(fee.negotiation?.answerExpiresAt, isNotNull);
      expect(FeeView.fromJson(<String, Object?>{'mode': 'STANDARD', 'payer': 'SHOP', 'status': 'FINAL', 'amount_vnd': 1}).negotiation, isNull);
      final Map<String, Object?> offer = <String, Object?>{
        'delivery_id': 'o',
        'code': 'G-1',
        'shop': <String, Object?>{'name': 'Quán'},
        'destination_known': false,
        'goods_value_vnd': 1000,
        'unpaid_vnd': 0,
        'fee_status': 'FINAL',
        'fee_payer': 'SHOP',
        'search_expires_at': '2026-10-24T10:30:00Z',
        'server_now': '2026-10-24T10:00:00Z',
        'eligible': true,
      };
      expect(OfferView.fromJson(<String, Object?>{...offer, 'fee_counter_allowed': true}).canCounter, isTrue);
      expect(OfferView.fromJson(<String, Object?>{...offer, 'fee_counter_allowed': false}).canCounter, isFalse);
      expect(OfferView.fromJson(offer).canCounter, isFalse);
      expect(
        OfferView.fromJson(<String, Object?>{...offer, 'agreement': <String, Object?>{'state': 'PROPOSED', 'proposed_vnd': 1, 'reason_code': 'URGENT', 'expires_at': '2026-10-24T10:30:00Z'}}).canCounter,
        isTrue,
      );
    });
  });

  test('delivery helper builds a valid view', () {
    expect(_delivery('x', DeliveryState.accepted).state, DeliveryState.accepted);
  });
}

/// A customer's order as the shop sees its request: the Shipper's position is shown and only the customer can cancel.
class _OrderShop extends SampleShopSource {
  _OrderShop(this._order);

  final DeliveryView _order;

  @override
  Future<DeliveryView> get(String id) async => DeliveryView(
        deliveryId: _order.deliveryId,
        code: _order.code,
        source: 'ORDER',
        state: _order.state,
        version: _order.version,
        pickup: _order.pickup,
        recipient: _order.recipient,
        goods: _order.goods,
        fee: _order.fee,
        search: _order.search,
        assignment: _order.assignment,
        location: _order.location,
        can: _order.can,
      );
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

DeliveryView _held({String ownOutcome = '', DeliveryState state = DeliveryState.accepted, Set<String> can = const <String>{'release', 'pickup', 'propose_fee'}, FeeNegotiation? negotiation, String decider = 'CUSTOMER', int version = 1}) {
  final DeliveryView base = _delivery('h-1', state, can: can, version: version);
  return DeliveryView(
    deliveryId: base.deliveryId,
    code: base.code,
    source: 'ORDER',
    state: state,
    ownOutcome: ownOutcome.isEmpty ? null : ownOutcome,
    version: version,
    pickup: base.pickup,
    recipient: base.recipient,
    goods: base.goods,
    fee: FeeView(mode: 'STANDARD', payer: 'CUSTOMER', status: 'FINAL', amountVnd: 15000, decider: decider, negotiation: negotiation),
    search: base.search,
    can: can,
  );
}

/// Offers: a table fee (no agreement) that the Shipper may question. Proposing makes the server report the waiting proposal.
class _TableOfferShipper extends SampleShipperSource {
  final List<int> proposed = <int>[];
  bool _waiting = false;

  OfferView _offer() => OfferView(
        deliveryId: 't-1',
        code: 'G-T1',
        shopName: 'Quán Mẫu',
        destinationKnown: false,
        goodsValueVnd: 100000,
        unpaidVnd: 0,
        feeVnd: 15000,
        feeStatus: 'FINAL',
        feePayer: 'SHOP',
        expiresAt: DateTime.utc(2026, 10, 24, 10, 20),
        serverNow: DateTime.utc(2026, 10, 24, 10),
        eligible: true,
        feeDecider: 'SHOP',
        feeCounterAllowed: !_waiting,
        negotiation: _waiting ? const FeeNegotiation(currentVnd: 15000, offeredVnd: 20000, decider: 'SHOP', byMe: true) : null,
      );

  @override
  Future<List<OfferView>> offers() async => <OfferView>[_offer()];

  @override
  Future<OfferView> feeCounter(String id, {required int amountVnd, required String key}) async {
    proposed.add(amountVnd);
    _waiting = true;
    return _offer();
  }
}

/// A Shipper who already holds a delivery whose fee is settled; proposing puts the proposal on the delivery.
class _HeldShipper extends SampleShipperSource {
  final List<int> proposed = <int>[];
  DeliveryView _view = _held();

  @override
  Future<DeliveryView> get(String id) async => _view;

  @override
  Future<OfferView> feeCounter(String id, {required int amountVnd, required String key}) async {
    proposed.add(amountVnd);
    _view = _held(
      can: const <String>{'release'},
      version: 2,
      negotiation: FeeNegotiation(currentVnd: 15000, offeredVnd: amountVnd, decider: 'CUSTOMER', byMe: true),
    );
    return super.feeCounter('o-1', amountVnd: amountVnd, key: key);
  }
}

class _FixedMine extends SampleShipperSource {
  _FixedMine(this._items);

  final List<DeliveryView> _items;

  @override
  Future<List<DeliveryView>> mine({required bool history}) async => _items;
}

/// A shop whose delivery has a Shipper's proposal about the fee in force, waiting for the payer.
class _NegotiationShop extends SampleShopSource {
  _NegotiationShop({required this.decider, this.payer = 'SHOP', required this.can});

  final String decider;
  final String payer;
  final Set<String> can;
  final List<bool> answers = <bool>[];

  @override
  Future<DeliveryView> get(String id) async {
    final DeliveryView base = _delivery(id, DeliveryState.accepted, can: can, version: 4);
    return DeliveryView(
      deliveryId: base.deliveryId,
      code: base.code,
      source: decider == 'CUSTOMER' ? 'ORDER' : 'DIRECT',
      state: base.state,
      version: base.version,
      pickup: base.pickup,
      recipient: base.recipient,
      goods: base.goods,
      fee: FeeView(
        mode: 'STANDARD',
        payer: payer,
        status: 'FINAL',
        amountVnd: 15000,
        decider: decider,
        negotiation: FeeNegotiation(currentVnd: 15000, offeredVnd: 20000, decider: decider, byMe: false),
      ),
      search: base.search,
      assignment: AssignmentView(assignmentId: 'a', shipperName: 'Shipper Mẫu', acceptedAt: DateTime.utc(2026, 10, 18, 9), destinationConfirmed: true),
      can: can,
    );
  }

  @override
  Future<DeliveryView> answerCounter(String id, {required bool accept, required int expectedVersion, required String key}) async {
    answers.add(accept);
    return get(id);
  }
}
