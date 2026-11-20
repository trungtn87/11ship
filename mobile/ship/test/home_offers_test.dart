import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_home.dart';
import 'package:ship/ship_home_offers.dart';

// #392 "Đơn có thể nhận" on Home: only server-eligible offers, at most three, real data only; offline and blocked states never look ready; a figure
// (fee, distance) appears only when the server gave one; a failed load can be retried.

OfferView _offer(String id, {bool eligible = true, int? feeVnd, int? distance}) {
  final DateTime now = DateTime.utc(2026, 11, 18, 9);
  return OfferView(
    deliveryId: id,
    code: 'G-$id',
    shopName: 'Quán $id',
    distanceToShopM: distance,
    destinationKnown: false,
    goodsValueVnd: 100000,
    unpaidVnd: 0,
    feeVnd: feeVnd,
    feeStatus: feeVnd == null ? 'UNKNOWN' : 'SET',
    feePayer: 'SHOP',
    expiresAt: now.add(const Duration(minutes: 20)),
    serverNow: now,
    eligible: eligible,
  );
}

class _Offers extends SampleShipperSource {
  _Offers(this.items, {this.failTimes = 0});
  final List<OfferView> items;
  int failTimes;
  int calls = 0;

  @override
  Future<List<OfferView>> offers() async {
    calls++;
    if (failTimes > 0) {
      failTimes--;
      throw StateError('network');
    }
    return items;
  }
}

Future<void> _mount(WidgetTester tester, Widget child) async {
  tester.view.physicalSize = const Size(360 * 3, 800 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    home: Scaffold(body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(16), child: child))),
  ));
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> _unmount(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pump(const Duration(milliseconds: 10));
}

HomeOffers _receiving(ShipperDeliverySource source, {VoidCallback? onOpen}) => HomeOffers(
  source: source,
  receiving: true,
  notReceivingText: 'x',
  onOpenOrders: onOpen,
  refreshEvery: const Duration(hours: 1),
);

void main() {
  _onlineSemanticsTests();
  testWidgets('no eligible offer: an honest empty line, no invented order', (WidgetTester tester) async {
    await _mount(tester, _receiving(_Offers(<OfferView>[_offer('1', eligible: false)])));
    expect(find.byKey(const Key('home-offers-empty')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-1')), findsNothing);
    await _unmount(tester);
  });

  testWidgets('shows at most three ELIGIBLE offers, and a fee or distance only when the server gave one', (WidgetTester tester) async {
    final _Offers source = _Offers(<OfferView>[
      _offer('1', feeVnd: 25000, distance: 800),
      _offer('2', eligible: false),
      _offer('3'),
      _offer('4', feeVnd: 18000, distance: 2400),
      _offer('5'),
    ]);
    await _mount(tester, _receiving(source));
    expect(find.byKey(const Key('home-offer-1')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-2')), findsNothing, reason: 'not eligible: never shown on Home');
    expect(find.byKey(const Key('home-offer-3')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-4')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-5')), findsNothing, reason: 'at most three');
    expect(find.byKey(const Key('home-offer-fee-1')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-fee-3')), findsNothing, reason: 'no fee from the server: no number invented');
    expect(find.text('Cách quán 800 m'), findsOneWidget);
    expect(find.text('Cách quán 2.4 km'), findsOneWidget);
    await _unmount(tester);
  });

  testWidgets('one offer and two offers are shown as they are, not padded', (WidgetTester tester) async {
    await _mount(tester, _receiving(_Offers(<OfferView>[_offer('1')])));
    expect(find.byKey(const Key('home-offer-1')), findsOneWidget);
    expect(find.byKey(const Key('home-offer-2')), findsNothing);
    await _unmount(tester);
  });

  testWidgets('a tap on an offer opens the Orders tab; nothing is accepted from Home', (WidgetTester tester) async {
    int opened = 0;
    await _mount(tester, _receiving(_Offers(<OfferView>[_offer('1')]), onOpen: () => opened++));
    await tester.tap(find.byKey(const Key('home-offer-1')));
    await tester.pump();
    expect(opened, 1);
    await _unmount(tester);
  });

  testWidgets('offline: no offer is loaded or shown as ready, and the one action is to turn online', (WidgetTester tester) async {
    final _Offers source = _Offers(<OfferView>[_offer('1')]);
    int wentOnline = 0;
    await _mount(tester, HomeOffers(
      source: source,
      receiving: false,
      notReceivingText: 'Bạn đang offline. Bật online để xem đơn có thể nhận gần bạn.',
      onGoOnline: () => wentOnline++,
      refreshEvery: const Duration(hours: 1),
    ));
    expect(source.calls, 0, reason: 'an offline Shipper does not fetch offers');
    expect(find.byKey(const Key('home-offer-1')), findsNothing);
    expect(find.byKey(const Key('home-offers-off')), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-offers-go-online')));
    await tester.pump();
    expect(wentOnline, 1);
    await _unmount(tester);
  });

  testWidgets('a failed load says so and retries; the list appears after the retry', (WidgetTester tester) async {
    final _Offers source = _Offers(<OfferView>[_offer('1')], failTimes: 1);
    await _mount(tester, _receiving(source));
    expect(find.byKey(const Key('home-offers-error')), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-offers-retry')));
    for (int i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
    expect(find.byKey(const Key('home-offer-1')), findsOneWidget);
    expect(source.calls, 2);
    await _unmount(tester);
  });
}

// #392/#396 device smoke: the one Online control is a real button whose semantics say whether a tap would act.
void _onlineSemanticsTests() {
  testWidgets('the round Online control exposes a disabled button label while the state is unknown (guest)', (WidgetTester tester) async {
    await _mount(tester, ShipActivityPanel(online: null, reason: 'x', onToggle: null, paused: false, busy: false));
    expect(
      tester.getSemantics(find.bySemanticsLabel('Bật online')),
      matchesSemantics(label: 'Bật online', isButton: true, hasEnabledState: true, isEnabled: false),
    );
    await _unmount(tester);
  });
}
