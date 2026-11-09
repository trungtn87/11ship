import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #238 (P5-4): "Sửa đơn" changes the delivery address through the checkout's own picker (typed text + a confirmed pin) or the address book. A changed
// address voids the price check; an older price answer never overwrites the newer address; leaving the picker changes nothing.

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));

class _Previews extends SampleCustomerOrders {
  _Previews(super.store);
  final List<Completer<CheckoutPreview>> pending = <Completer<CheckoutPreview>>[];
  final List<CheckoutDraft> drafts = <CheckoutDraft>[];
  bool deferred = true;

  @override
  Future<CheckoutPreview> preview(CheckoutDraft draft) {
    if (!deferred) return super.preview(draft);
    drafts.add(draft);
    final Completer<CheckoutPreview> c = Completer<CheckoutPreview>();
    pending.add(c);
    return c.future;
  }
}

CheckoutPreview priced(int itemsVnd, int fee) => CheckoutPreview(ok: true, blockers: const <String>[], lines: const <PreviewLine>[], itemsVnd: itemsVnd, feeEstimateVnd: fee, feeDistanceM: 2000, expectedTotalVnd: itemsVnd + fee, tipVnd: 0, feeStatus: 'OK', feeReason: null, quoteSnapshot: 'q$fee');

class _Book implements AddressApi {
  const _Book(this.rows);
  final List<DeliveryAddress> rows;
  @override
  Future<List<DeliveryAddress>> list() async => rows;
  @override
  Future<DeliveryAddress> create(AddressInput input, {required String key}) => throw UnsupportedError('read only');
  @override
  Future<DeliveryAddress> update(String id, AddressInput input, {required int expectedVersion, required String key}) => throw UnsupportedError('read only');
  @override
  Future<String?> delete(String id, {required String key}) => throw UnsupportedError('read only');
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError('read only');
}

Widget _pin(BuildContext context, {required void Function(double, double) onPick, double? lat, double? lng, String? label}) =>
    TextButton(key: const Key('test-map-pin'), onPressed: () => onPick(21.5, 105.5), child: const Text('pin'));

const DeliveryAddress _a = DeliveryAddress(id: 'addr-a', label: AddressLabel.home, recipientName: 'An', contactPhone: '+84912345678', addressText: 'Địa chỉ A', deliveryNote: null, latitude: 21.1, longitude: 105.1, isDeliveryDefault: true, version: 1);
const DeliveryAddress _b = DeliveryAddress(id: 'addr-b', label: AddressLabel.other, recipientName: 'An', contactPhone: '+84912345678', addressText: 'Địa chỉ B', deliveryNote: null, latitude: 21.2, longitude: 105.2, isDeliveryDefault: false, version: 1);

Future<({SampleOrderStore store, _Previews customer, OrderRuntime runtime, String id})> open(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1080, 9000);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final SampleOrderStore store = SampleOrderStore();
  final _Previews customer = _Previews(store);
  final AddressBookController book = AddressBookController(api: const _Book(<DeliveryAddress>[_a, _b]));
  addTearDown(book.dispose);
  await book.load();
  final OrderRuntime runtime = OrderRuntime(customer: customer, shop: SampleShopOrders(store), cart: CartController(source: customer), addresses: book, pinPicker: _pin);
  final String id = store.seed();
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: CustomerOrderDetailScreen(runtime: runtime, orderId: id)));
  await settle(tester);
  await tap(tester, key('order-edit'));
  return (store: store, customer: customer, runtime: runtime, id: id);
}

void main() {
  testWidgets('a typed address needs its pin confirmed in the shared picker; saving writes text and pin, the old pin is not kept', (WidgetTester tester) async {
    final env = await open(tester);
    env.customer.deferred = false;
    final OrderView before = await env.runtime.customer.get(env.id);
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-typed'));
    await tester.enterText(key('location-address-text'), '12 Phố Huế, Hà Nội');
    await settle(tester);
    await tap(tester, key('test-map-pin'));
    await tap(tester, key('location-save'));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('12 Phố Huế, Hà Nội'), findsOneWidget);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull, reason: 'a changed address must be priced again');
    await tap(tester, key('order-edit-review'));
    await tap(tester, key('order-edit-save'));
    await tester.pump(const Duration(seconds: 1));
    final OrderView after = await env.runtime.customer.get(env.id);
    expect(after.recipient.addressText, '12 Phố Huế, Hà Nội');
    expect((after.recipient.lat, after.recipient.lng), (21.5, 105.5));
    expect(after.version, before.version + 1);
    expect(after.customerEditCount, 1);
  });

  testWidgets('an address-book choice replaces text and pin together and voids the earlier price check', (WidgetTester tester) async {
    final env = await open(tester);
    env.customer.deferred = false;
    await tap(tester, key('order-edit-review'));
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNotNull);
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-addr-a'));
    expect(find.text('Địa chỉ A'), findsOneWidget);
    expect(key('order-edit-compare'), findsNothing);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull);
    await tap(tester, key('order-edit-review'));
    await tap(tester, key('order-edit-save'));
    await tester.pump(const Duration(seconds: 1));
    final OrderView after = await env.runtime.customer.get(env.id);
    expect((after.recipient.addressText, after.recipient.lat, after.recipient.lng), ('Địa chỉ A', 21.1, 105.1));
  });

  testWidgets('address A then B quickly: the late answer for A is dropped, only B is priced', (WidgetTester tester) async {
    final env = await open(tester);
    await tap(tester, key('order-edit-review')); // pending[0]: the order's own address
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-addr-a'));
    await tap(tester, key('order-edit-review')); // pending[1]: A
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-addr-b'));
    await tap(tester, key('order-edit-review')); // pending[2]: B
    expect(env.customer.drafts.map((CheckoutDraft d) => d.address.text).toList().sublist(1), <String>['Địa chỉ A', 'Địa chỉ B']);
    env.customer.pending[2].complete(priced(100000, 30000));
    await settle(tester);
    env.customer.pending[1].complete(priced(100000, 10000)); // late answer for A
    env.customer.pending[0].complete(priced(100000, 5000));
    await settle(tester);
    expect(find.textContaining('30.000'), findsOneWidget, reason: 'only the fee quoted for B is shown');
    expect(find.textContaining('10.000 đ'), findsNothing);
    expect(find.text('Địa chỉ B'), findsOneWidget);
  });

  testWidgets('a late price answer started before the address changed never becomes the preview', (WidgetTester tester) async {
    final env = await open(tester);
    await tap(tester, key('order-edit-review'));
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-addr-b'));
    env.customer.pending.single.complete(priced(100000, 5000));
    await settle(tester);
    expect(key('order-edit-compare'), findsNothing);
    expect(tester.widget<N11Button>(key('order-edit-save')).onPressed, isNull);
    expect(tester.widget<N11Button>(key('order-edit-review')).onPressed, isNotNull, reason: 'the customer can price the new address at once');
  });

  testWidgets('leaving the picker (Back) or the sheet changes nothing', (WidgetTester tester) async {
    final env = await open(tester);
    env.customer.deferred = false;
    await tap(tester, key('order-edit-review'));
    final String original = (await env.runtime.customer.get(env.id)).recipient.addressText;
    await tap(tester, key('order-edit-pick-address'));
    await tester.tapAt(const Offset(5, 5)); // dismiss the sheet
    await settle(tester);
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-typed'));
    await tester.enterText(key('location-address-text'), 'Chỗ khác');
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await settle(tester);
    expect(find.text(original), findsOneWidget);
    expect(key('order-edit-compare'), findsOneWidget, reason: 'the earlier price check is still valid');
    expect((await env.runtime.customer.get(env.id)).customerEditCount, 0);
  });

  testWidgets('once the shop confirmed, saving an address change writes nothing', (WidgetTester tester) async {
    final env = await open(tester);
    env.customer.deferred = false;
    final OrderView before = await env.runtime.customer.get(env.id);
    await tap(tester, key('order-edit-pick-address'));
    await tap(tester, key('order-edit-address-addr-b'));
    await tap(tester, key('order-edit-review'));
    await env.runtime.shop.confirm(env.id, expectedVersion: before.version, key: 'k-confirm');
    await tap(tester, key('order-edit-save'));
    expect(key('order-edit-locked'), findsOneWidget);
    final OrderView after = await env.runtime.customer.get(env.id);
    expect(after.recipient.addressText, before.recipient.addressText);
    expect(after.customerEditCount, 0);
  });
}
