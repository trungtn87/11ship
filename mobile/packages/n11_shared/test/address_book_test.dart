import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

/// An in-memory server of /v1/customers/me/addresses with independent optional pickup/delivery defaults.
class FakeAddressServer {
  FakeAddressServer(this.api) {
    api.routes['GET /v1/customers/me/addresses'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'addresses': _view()}});
    api.routes['POST /v1/customers/me/addresses'] = (String m, String p, Map<String, String> h, String b) async {
      if (loseNext) {
        loseNext = false;
        _create(jsonDecode(b) as Map<String, Object?>);
        throw const AuthFailure(AuthFailureKind.unknownOutcome);
      }
      final String? key = h['idempotency-key'];
      if (key != null && replies.containsKey(key)) {
        return replies[key]!;
      }
      final ApiResponse r = json(201, <String, Object?>{'data': _create(jsonDecode(b) as Map<String, Object?>)});
      if (key != null) {
        replies[key] = r;
      }
      return r;
    };
  }

  final FakeApiTransport api;
  final List<Map<String, Object?>> rows = <Map<String, Object?>>[];
  final Map<String, ApiResponse> replies = <String, ApiResponse>{};
  bool loseNext = false;
  int seq = 0;

  Map<String, Object?> _create(Map<String, Object?> body) {
    if (body['is_delivery_default'] == true) {
      for (final Map<String, Object?> r in rows) {
        r['is_default'] = false;
        r['is_delivery_default'] = false;
      }
    }
    if (body['is_pickup_default'] == true) {
      for (final Map<String, Object?> r in rows) {
        r['is_pickup_default'] = false;
      }
    }
    final Map<String, Object?> row = <String, Object?>{
      'id': 'a${++seq}',
      'label': body['label'],
      'display_name': (body['display_name'] as String?)?.isEmpty == true ? null : body['display_name'],
      'recipient_name': body['recipient_name'],
      'contact_phone': (body['contact_phone']! as String).replaceFirst(RegExp(r'^0'), '+84'),
      'address_description': body['address_description'],
      'latitude': body['latitude'],
      'longitude': body['longitude'],
      'delivery_note': (body['delivery_note'] as String?)?.isEmpty == true ? null : body['delivery_note'],
      'is_default': body['is_delivery_default'] == true,
      'is_pickup_default': body['is_pickup_default'] == true,
      'is_delivery_default': body['is_delivery_default'] == true,
      'version': 1,
      'created_at': '2026-10-17T00:00:00.000Z',
      'updated_at': '2026-10-17T00:00:00.000Z',
    };
    rows.add(row);
    return row;
  }

  List<Map<String, Object?>> _view() {
    final List<Map<String, Object?>> sorted = <Map<String, Object?>>[...rows];
    sorted.sort((Map<String, Object?> a, Map<String, Object?> b) => (b['is_default']! as bool ? 1 : 0).compareTo(a['is_default']! as bool ? 1 : 0));
    return sorted;
  }

  void route(String method, String id, FakeHandler handler) => api.routes['$method /v1/customers/me/addresses/$id'] = handler;
}

Future<({SessionController session, FakeApiTransport api, FakeAddressServer server, AddressBookController controller})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  final FakeAddressServer server = FakeAddressServer(api);
  final AddressBookController controller = AddressBookController(api: HttpAddressApi(session: session), session: session, location: FakeLocationProvider());
  addTearDown(controller.dispose);
  return (session: session, api: api, server: server, controller: controller);
}

const AddressInput home = AddressInput(label: AddressLabel.home, recipientName: 'An', phone: '0912345678', addressText: '12 Lê Lợi', note: '', deliveryDefault: true);

void main() {
  test('the book uses only an explicitly selected default and refreshes after a write', () async {
    final t = await signedIn();
    await t.controller.load();
    expect(t.controller.loadState, AddressLoad.ready);
    expect(t.controller.addresses, isEmpty);
    expect(await t.controller.save(home), isTrue);
    expect(t.controller.addresses.single.isDefault, isTrue);
    expect(t.controller.addresses.single.phoneText, '0912345678');
    final RecordedRequest post = t.api.to('POST', '/v1/customers/me/addresses').single;
    expect(post.headers['idempotency-key'], isNotEmpty);
    expect(jsonDecode(post.body), containsPair('contact_phone', '0912345678'));
    expect(jsonDecode(post.body), isNot(contains('latitude')), reason: 'no coordinates are invented');
    expect(t.api.to('GET', '/v1/customers/me/addresses'), hasLength(2), reason: 'initial read + refresh after the write');
  });

  test('a second tap while a write runs does nothing (no duplicate)', () async {
    final t = await signedIn();
    final Future<bool> first = t.controller.save(home);
    final Future<bool> second = t.controller.save(home);
    expect(await second, isFalse);
    expect(await first, isTrue);
    expect(t.server.rows, hasLength(1));
  });

  test('M05-12: a lost answer keeps the operation; the retry reuses the same Idempotency-Key and creates exactly one address', () async {
    final t = await signedIn();
    t.server.loseNext = true;
    expect(await t.controller.save(home), isFalse);
    expect(t.controller.pending, isNotNull);
    expect(await t.controller.save(home), isFalse, reason: 'nothing else may be written while an outcome is unknown');
    final String key = t.api.to('POST', '/v1/customers/me/addresses').single.headers['idempotency-key']!;
    // The server committed once; the retry carries the same key.
    t.server.replies[key] = json(201, <String, Object?>{'data': t.server.rows.single});
    expect(await t.controller.retryPending(), isTrue);
    expect(t.api.to('POST', '/v1/customers/me/addresses').last.headers['idempotency-key'], key);
    expect(t.server.rows, hasLength(1));
    expect(t.controller.pending, isNull);
  });

  test('update sends expected_version; delete and set-default use the contract routes and refresh the list', () async {
    final t = await signedIn();
    await t.controller.save(home);
    await t.controller.save(const AddressInput(label: AddressLabel.office, recipientName: '', phone: '0987654321', addressText: '5 Nguyễn Huệ', note: 'Tầng 3', makeDefault: false));
    t.server.route('PUT', 'a2/defaults/delivery', (String m, String p, Map<String, String> h, String b) async {
      t.server.rows[0]['is_default'] = false;
      t.server.rows[0]['is_delivery_default'] = false;
      t.server.rows[1]['is_default'] = true;
      t.server.rows[1]['is_delivery_default'] = true;
      return json(200, <String, Object?>{'data': t.server.rows[1]});
    });
    expect(await t.controller.setDefault('a2'), isTrue);
    expect(t.controller.addresses.first.id, 'a2');
    t.server.route('PATCH', 'a1', (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{...t.server.rows[0], 'address_description': '99 Mới', 'version': 2}}));
    expect(await t.controller.save(home, editing: t.controller.byId('a1')), isTrue);
    expect(jsonDecode(t.api.to('PATCH', '/v1/customers/me/addresses/a1').single.body), containsPair('expected_version', 1));
    t.server.route('DELETE', 'a1', (String m, String p, Map<String, String> h, String b) async {
      t.server.rows.removeAt(0);
      return json(200, <String, Object?>{'data': <String, Object?>{'id': 'a1', 'deleted': true, 'default_address_id': 'a2'}});
    });
    expect(await t.controller.delete('a1'), isTrue);
    expect(t.controller.addresses.map((DeliveryAddress a) => a.id), <String>['a2']);
  });

  test('409 VERSION_CONFLICT reloads and flags the conflict; 404 reloads and flags gone', () async {
    final t = await signedIn();
    await t.controller.save(home);
    t.server.route('PATCH', 'a1', (String m, String p, Map<String, String> h, String b) async => apiError(409, 'VERSION_CONFLICT'));
    expect(await t.controller.save(home, editing: t.controller.byId('a1')), isFalse);
    expect(t.controller.conflict, isTrue);
    t.server.route('DELETE', 'a1', (String m, String p, Map<String, String> h, String b) async => apiError(404, 'CUSTOMER_ADDRESS_NOT_FOUND'));
    expect(await t.controller.delete('a1'), isFalse);
    expect(t.controller.gone, isTrue);
    expect(t.controller.pending, isNull);
  });

  test('a failed read shows a failed state, never fake data; Thử lại reads again', () async {
    final t = await signedIn();
    t.api.routes['GET /v1/customers/me/addresses'] = (String m, String p, Map<String, String> h, String b) async => apiError(503, 'SERVICE_UNAVAILABLE');
    await t.controller.load();
    expect(t.controller.loadState, AddressLoad.failed);
    expect(t.controller.addresses, isEmpty);
  });

  test('logout clears the private data', () async {
    final t = await signedIn();
    await t.controller.save(home);
    expect(t.controller.addresses, isNotEmpty);
    await t.session.logout();
    expect(t.controller.addresses, isEmpty);
    expect(t.controller.loadState, AddressLoad.idle);
  });

  test('a 401 ends the session and the book is cleared', () async {
    final t = await signedIn();
    await t.controller.save(home);
    t.api.routes['GET /v1/customers/me/addresses'] = (String m, String p, Map<String, String> h, String b) async => apiError(401, 'SESSION_REVOKED');
    await t.controller.load();
    expect(t.session.status, isNot(SessionStatus.signedIn));
    expect(t.controller.addresses, isEmpty);
  });

  Future<void> show(WidgetTester tester, Widget screen) async {
    await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
    await tester.pumpAndSettle();
  }

  testWidgets('empty book -> add -> the new address is listed without an automatic default', (WidgetTester tester) async {
    final t = await tester.runAsync(signedIn) as dynamic;
    final AddressBookController c = t.controller as AddressBookController;
    await show(tester, AddressBookScreen(controller: c));
    expect(find.text('Chưa có địa chỉ'), findsOneWidget);
    await tester.tap(find.byKey(const Key('address-add')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('address-save')));
    await tester.pumpAndSettle();
    expect(find.text('Nhập tên người liên hệ.'), findsOneWidget);
    expect(find.text('Nhập số điện thoại người nhận.'), findsNothing, reason: 'the account phone is prefilled');
    await tester.enterText(find.byKey(const Key('address-phone')), '123');
    await tester.tap(find.byKey(const Key('address-save')));
    await tester.pumpAndSettle();
    expect(find.text('Số điện thoại chưa hợp lệ.'), findsOneWidget);
    expect(find.text('Nhập địa chỉ giao hàng chi tiết.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('address-phone')), '0912 345 678');
    await tester.enterText(find.byKey(const Key('address-name')), 'Nguyễn Văn An');
    await tester.ensureVisible(find.byKey(const Key('address-text')));
    await tester.tap(find.byKey(const Key('address-text')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), '12 Lê Lợi, Q1');
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('address-save')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(find.text('12 Lê Lợi, Q1'), findsOneWidget);
    expect(find.text('12 Lê Lợi, Q1'), findsOneWidget);
    expect(c.addresses.single.latitude, 10.0123);
    expect(c.addresses.single.longitude, 106.0456);
  });

  testWidgets('new address: the phone of the signed-in account is prefilled and can be changed; the account phone is not touched', (WidgetTester tester) async {
    final t = await tester.runAsync(signedIn) as dynamic;
    final AddressBookController c = t.controller as AddressBookController;
    final SessionController session = t.session as SessionController;
    await show(tester, AddressFormScreen(controller: c));
    String phoneField() => tester.widget<TextField>(find.byKey(const Key('address-phone'))).controller!.text;
    expect(phoneField(), '0901234567');
    await tester.enterText(find.byKey(const Key('address-phone')), '0987 654 321');
    await tester.enterText(find.byKey(const Key('address-name')), 'Nguyễn Văn An');
    await tester.ensureVisible(find.byKey(const Key('address-text')));
    await tester.tap(find.byKey(const Key('address-text')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('location-address-text')), '5 Nguyễn Huệ');
    await tester.tap(find.byKey(const Key('location-current')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('location-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('address-save')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    final RecordedRequest post = (t.api as FakeApiTransport).to('POST', '/v1/customers/me/addresses').single;
    expect(jsonDecode(post.body), containsPair('contact_phone', '0987654321'));
    expect(session.identity!.phoneNormalized, '+84901234567', reason: 'the login phone does not change');
  });

  testWidgets('edit address: the form shows the phone of that address, not the account phone', (WidgetTester tester) async {
    final t = await tester.runAsync(signedIn) as dynamic;
    final AddressBookController c = t.controller as AddressBookController;
    await tester.runAsync(() => c.save(const AddressInput(label: AddressLabel.office, recipientName: 'Bình', phone: '0987654321', addressText: '5 Nguyễn Huệ', note: '', makeDefault: false)));
    await show(tester, AddressFormScreen(controller: c, editing: c.addresses.single));
    expect(tester.widget<TextField>(find.byKey(const Key('address-phone'))).controller!.text, '0987654321');
  });

  testWidgets('delete asks for confirmation and removes the address', (WidgetTester tester) async {
    final t = await tester.runAsync(signedIn) as dynamic;
    final AddressBookController c = t.controller as AddressBookController;
    await tester.runAsync(() => c.save(home));
    await show(tester, AddressBookScreen(controller: c));
    await tester.tap(find.byKey(const Key('address-delete-a1')));
    await tester.pumpAndSettle();
    expect(find.text('Xóa địa chỉ này?'), findsOneWidget);
    expect(((t.server as FakeAddressServer).rows), hasLength(1));
    (t.server as FakeAddressServer).route('DELETE', 'a1', (String m, String p, Map<String, String> h, String b) async {
      (t.server as FakeAddressServer).rows.clear();
      return json(200, <String, Object?>{'data': <String, Object?>{'id': 'a1', 'deleted': true, 'default_address_id': null}});
    });
    await tester.tap(find.byKey(const Key('address-confirm-delete')));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(find.text('Chưa có địa chỉ'), findsOneWidget);
  });

  testWidgets('picker: default is preselected, another can be chosen, confirm returns it', (WidgetTester tester) async {
    final t = await tester.runAsync(signedIn) as dynamic;
    final AddressBookController c = t.controller as AddressBookController;
    await tester.runAsync(() async {
      await c.save(home);
      await c.save(const AddressInput(label: AddressLabel.office, recipientName: 'Bình', phone: '0987654321', addressText: '5 Nguyễn Huệ', note: '', makeDefault: false));
    });
    DeliveryAddress? picked;
    await show(tester, Scaffold(body: SingleChildScrollView(child: DeliveryAddressPicker(controller: c, onConfirm: (DeliveryAddress a) => picked = a))));
    await tester.tap(find.byKey(const Key('picker-confirm')));
    expect(picked?.id, 'a1', reason: 'the default');
    await tester.tap(find.byKey(const Key('picker-a2')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('picker-confirm')));
    expect(picked?.id, 'a2');
  });

}
