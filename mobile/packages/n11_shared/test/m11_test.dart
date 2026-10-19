import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

// M11 phone layer: the strict wire parse (including privacy by type), the HTTP source (paths, bodies, the operation key kept for a retry) and the
// screens against a scripted source: a star must be chosen, a rating is confirmed before it is sent, the server alone decides which complaint
// actions exist, and a related party never sees the submitter's text.

const AppConfig config = AppConfig(apiBaseUrl: 'https://api.example.test', deviceEnvironment: 'fixture-env');

Map<String, Object?> summaryJson({double? average = 4.5, int count = 2}) => <String, Object?>{
      'average': average,
      'count': count,
      'distribution': <String, Object?>{'1': 0, '2': 0, '3': 0, '4': 1, '5': 1},
    };

Map<String, Object?> detailJson({String status = 'IN_PROGRESS', String relation = 'SUBMITTER', bool canSupplement = true, bool canReconsider = false, String? body = 'Hàng bị móp'}) => <String, Object?>{
      'complaint_id': 'c1',
      'code': 'PA-0001',
      'category': 'GOODS',
      'status': status,
      'relation': relation,
      'related': <String, Object?>{'code': 'G-1'},
      'body': body,
      'conclusion': null,
      'close_reason': null,
      'created_at': '2026-10-18T09:00:00Z',
      'closed_at': null,
      'version': 2,
      'awaiting_you': false,
      'can_supplement': canSupplement,
      'can_request_reconsideration': canReconsider,
      'reconsideration_expires_at': null,
      'reconsiderations': <Object?>[],
      'messages': <Object?>[
        <String, Object?>{'kind': 'SUBMITTED', 'author': 'YOU', 'body': 'Hàng bị móp', 'created_at': '2026-10-18T09:00:00Z', 'attachments': <Object?>[]},
      ],
      'server_now': '2026-10-18T10:00:00Z',
    };

Future<({SessionController session, FakeApiTransport api})> signedIn() async {
  final FakeApiTransport api = FakeApiTransport();
  installAccountRoutes(api);
  final SessionController session = createSessionController(ClientApp.food, config, transport: api, bridge: FakeDeviceBridge());
  await session.start();
  await session.login(phone: '0901234567', password: 'Correct-Horse-9');
  return (session: session, api: api);
}

class FakeM11 extends M11Source {
  FakeM11();

  final List<String> log = <String>[];
  final List<String> keys = <String>[];
  int stars = 0;
  String? comment;
  Object? failNext;
  ComplaintDetail detail = ComplaintDetail.fromJson(detailJson());

  Future<void> _maybeFail() async {
    final Object? f = failNext;
    failNext = null;
    if (f != null) {
      throw f;
    }
  }

  @override
  Future<CustomerOrderReviewState> customerOrder(String orderId) async => CustomerOrderReviewState.fromJson(<String, Object?>{
        'order': <String, Object?>{'code': 'OD-1', 'completed': true},
        'shop': <String, Object?>{'name': 'Quán Mẫu', 'can_review': true, 'review': null},
        'shipper': <String, Object?>{'name': 'Hùng', 'shipper_code': 'SP-9', 'rating': null, 'can_review': false, 'review': null},
      });

  @override
  Future<void> customerRateShop(String orderId, {required int stars, String? comment, required String key}) async {
    log.add('rate-shop');
    keys.add(key);
    this.stars = stars;
    this.comment = comment;
    await _maybeFail();
  }

  @override
  Future<void> customerRateShipper(String orderId, {required int stars, String? comment, required String key}) async => log.add('rate-shipper');

  @override
  Future<ShopDeliveryReviewState> shopDelivery(String deliveryId) => throw UnimplementedError();

  @override
  Future<void> shopRateShipper(String deliveryId, {required int stars, String? comment, required String key}) => throw UnimplementedError();

  @override
  Future<ShopReviewPage> shopReviews({int? stars}) => throw UnimplementedError();

  @override
  Future<void> saveReply(String reviewId, {required String body, int? expectedVersion, required String key}) => throw UnimplementedError();

  @override
  Future<ShipperReviewPage> shipperReviews({ReviewSource? source, int? stars}) async => ShipperReviewPage.fromJson(<String, Object?>{
        'summary': <String, Object?>{'all': summaryJson(), 'customer': summaryJson(average: null, count: 0), 'shop': summaryJson()},
        'items': <Object?>[
          <String, Object?>{'review_id': 'r1', 'source': 'CUSTOMER', 'stars': 2, 'comment': 'Giao chậm', 'created_at': '2026-10-17T09:00:00Z', 'complaint': null},
        ],
      });

  @override
  Future<ShopReviewPage> publicShopReviews(String shopId, {int? stars}) async => ShopReviewPage.fromJson(<String, Object?>{
        'shop': <String, Object?>{'name': 'Quán Mẫu'},
        'summary': summaryJson(average: null, count: 0),
        'items': <Object?>[],
      });

  @override
  Future<String> uploadEvidence(M11Role role, PickedImage image) async {
    log.add('upload');
    return 'a${log.length}';
  }

  @override
  Future<ComplaintListPage> complaints(M11Role role, {required bool closed}) async => ComplaintListPage.fromJson(<String, Object?>{
        'counts': <String, Object?>{'open': 1, 'closed': 0},
        'items': <Object?>[
          <String, Object?>{
            'complaint_id': 'c1',
            'code': 'PA-0001',
            'category': 'GOODS',
            'status': 'IN_PROGRESS',
            'relation': 'SUBMITTER',
            'related_code': 'G-1',
            'summary': 'Hàng bị móp',
            'created_at': '2026-10-18T09:00:00Z',
            'updated_at': '2026-10-18T09:30:00Z',
            'can_request_reconsideration': false,
          },
        ],
        'involving_me': <Object?>[],
        'involving_me_counts': <String, Object?>{'open': 0, 'closed': 0},
        'server_now': '2026-10-18T10:00:00Z',
      });

  @override
  Future<ComplaintDetail> complaint(M11Role role, String id) async => detail;

  @override
  Future<ComplaintFiled> fileComplaint(M11Role role, {required ComplaintSubject subject, required ComplaintCategory category, required String body, List<String> attachmentIds = const <String>[], required String key}) async {
    log.add('file:${category.wire}:${attachmentIds.length}');
    keys.add(key);
    await _maybeFail();
    return ComplaintFiled(appended: false, complaint: detail);
  }

  @override
  Future<ComplaintDetail> supplement(M11Role role, String id, {String? body, List<String> attachmentIds = const <String>[], required String key}) async {
    log.add('supplement');
    return detail;
  }

  @override
  Future<ComplaintDetail> reconsider(M11Role role, String id, {required String reason, required String key}) async {
    log.add('reconsider');
    keys.add(key);
    return detail;
  }
}

Future<void> mount(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1080, 7200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(theme: buildN11Theme(), home: screen));
  await settle(tester);
}

Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Future<void> tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await settle(tester);
}

Finder key(String value) => find.byKey(Key(value));

void main() {
  group('wire models', () {
    test('an empty summary is "no rating", never a default star', () {
      final RatingSummary s = RatingSummary.fromJson(summaryJson(average: null, count: 0));
      expect(s.isEmpty, isTrue);
      expect(s.average, isNull);
    });

    test('a Shipper rating carries only the source, never who wrote it', () {
      final ShipperReview r = ShipperReview.fromJson(<String, Object?>{'review_id': 'r', 'source': 'SHOP', 'stars': 3, 'comment': null, 'created_at': '2026-10-17T09:00:00Z', 'complaint': null});
      expect(r.source, ReviewSource.shop);
      expect(r.complaint, isNull);
    });

    test('stars out of range, an unknown status or source are refused', () {
      expect(() => OwnReview.fromJson(<String, Object?>{'review_id': 'r', 'stars': 6, 'comment': null, 'created_at': null}), throwsFormatException);
      expect(() => complaintStatusOf('DONE'), throwsFormatException);
      expect(() => ShipperReview.fromJson(<String, Object?>{'review_id': 'r', 'source': 'PLATFORM', 'stars': 3, 'comment': null, 'created_at': '2026-10-17T09:00:00Z', 'complaint': null}), throwsFormatException);
    });

    test('a related party sees no body from the server and the model keeps it null', () {
      final ComplaintDetail d = ComplaintDetail.fromJson(detailJson(relation: 'PARTY', body: null, canSupplement: true));
      expect(d.asParty, isTrue);
      expect(d.body, isNull);
    });
  });

  group('HTTP source', () {
    test('filing sends the subject, category and pictures with the key', () async {
      final t = await signedIn();
      t.api.routes['POST /v1/customers/me/complaints'] = (String m, String p, Map<String, String> h, String b) async => json(201, <String, Object?>{'data': <String, Object?>{'appended': false, 'complaint': detailJson()}});
      final ComplaintFiled filed = await HttpM11Source(session: t.session).fileComplaint(M11Role.customer, subject: const ComplaintSubject.order('o1'), category: ComplaintCategory.goods, body: ' Hàng bị móp ', attachmentIds: <String>['a1'], key: '11111111-1111-4111-8111-111111111111');
      expect(filed.appended, isFalse);
      final RecordedRequest sent = t.api.to('POST', '/v1/customers/me/complaints').single;
      expect(sent.headers['idempotency-key'], '11111111-1111-4111-8111-111111111111');
      final Map<String, Object?> body = jsonDecode(sent.body) as Map<String, Object?>;
      expect(body, <String, Object?>{'category': 'GOODS', 'body': 'Hàng bị móp', 'order_id': 'o1', 'attachment_ids': <String>['a1']});
    });

    test('each role uses its own route family', () async {
      final t = await signedIn();
      for (final String path in <String>['/v1/shop/me/complaints?scope=open', '/v1/driver/complaints?scope=closed']) {
        t.api.routes['GET $path'] = (String m, String p, Map<String, String> h, String b) async => json(403, <String, Object?>{'error': <String, Object?>{'code': 'COMPLAINT_FORBIDDEN'}});
      }
      final HttpM11Source source = HttpM11Source(session: t.session);
      await expectLater(source.complaints(M11Role.shop, closed: false), throwsA(isA<M07Failure>().having((M07Failure f) => f.code, 'code', 'COMPLAINT_FORBIDDEN')));
      await expectLater(source.complaints(M11Role.shipper, closed: true), throwsA(isA<M07Failure>()));
    });

    test('a lost answer is offline, and a state conflict is a conflict', () async {
      final t = await signedIn();
      t.api.routes['POST /v1/driver/complaints/c1/reconsideration'] = (String m, String p, Map<String, String> h, String b) async => json(409, <String, Object?>{'error': <String, Object?>{'code': 'COMPLAINT_STATE_CONFLICT'}});
      final HttpM11Source source = HttpM11Source(session: t.session);
      await expectLater(source.reconsider(M11Role.shipper, 'c1', reason: 'x', key: '11111111-1111-4111-8111-111111111111'), throwsA(isA<M07Failure>().having((M07Failure f) => f.kind, 'kind', M07FailureKind.conflict)));
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      await expectLater(source.reconsider(M11Role.shipper, 'c1', reason: 'x', key: '11111111-1111-4111-8111-111111111111'), throwsA(isA<M07Failure>().having((M07Failure f) => f.kind, 'kind', M07FailureKind.offline)));
    });

    test('a body that is not the contract is a server failure, not a half screen', () async {
      final t = await signedIn();
      t.api.routes['GET /v1/driver/reviews'] = (String m, String p, Map<String, String> h, String b) async => json(200, <String, Object?>{'data': <String, Object?>{'items': 'x'}});
      await expectLater(HttpM11Source(session: t.session).shipperReviews(), throwsA(isA<M07Failure>().having((M07Failure f) => f.code, 'code', 'BAD_RESPONSE')));
    });
  });

  group('screens', () {
    testWidgets('the rating needs a star, asks for confirmation, and a lost answer is retried with the SAME key', (WidgetTester tester) async {
      final FakeM11 source = FakeM11();
      await mount(tester, CustomerOrderRatingScreen(source: source, orderId: 'o1', picker: FakeImagePicker()));
      expect(find.text('Quán Mẫu'), findsOneWidget);
      expect(key('m11-rate-shipper-why'), findsOneWidget, reason: 'the shipper cannot be rated yet');
      await tap(tester, key('m11-rate-shop-rate'));
      expect(tester.widget<N11Button>(key('m11-rate-send')).onPressed, isNull, reason: 'no star chosen: no default 5');
      await tap(tester, key('m11-star-4'));
      await tester.enterText(key('m11-rate-comment'), 'Ngon');
      source.failNext = const M07Failure(M07FailureKind.offline);
      await tap(tester, key('m11-rate-send'));
      await tap(tester, key('m07-confirm-yes'));
      expect(source.log, <String>['rate-shop']);
      await tap(tester, key('m11-rate-send'));
      await tap(tester, key('m07-confirm-yes'));
      expect(source.log, <String>['rate-shop', 'rate-shop']);
      expect(source.keys[0], source.keys[1], reason: 'a retry after a lost answer reuses the operation key');
      expect(source.stars, 4);
      expect(source.comment, 'Ngon');
    });

    testWidgets('the Shipper sees the source tabs and the "Phản ánh đánh giá" button', (WidgetTester tester) async {
      await mount(tester, ShipperReviewsScreen(source: FakeM11(), picker: FakeImagePicker()));
      expect(find.text('Khách đánh giá'), findsWidgets);
      expect(key('m11-review-complain-r1'), findsOneWidget);
      expect(find.text('Giao chậm'), findsOneWidget);
    });

    testWidgets('the public page of a shop without ratings says so', (WidgetTester tester) async {
      await mount(tester, ShopReviewsScreen(source: FakeM11(), shopId: 's1', title: 'Quán Mẫu'));
      expect(key('m11-summary-empty'), findsOneWidget);
      expect(find.text('Chưa có đánh giá'), findsWidgets);
    });

    testWidgets('the complaint form needs a category and a text, uploads pictures, and sends once', (WidgetTester tester) async {
      final FakeM11 source = FakeM11();
      await mount(tester, ComplaintFormScreen(source: source, role: M11Role.customer, subject: const ComplaintSubject.order('o1'), subjectLabel: 'Đơn OD-1', picker: FakeImagePicker()));
      expect(tester.widget<N11Button>(key('m11-complaint-send')).onPressed, isNull);
      await tap(tester, key('m11-category-GOODS'));
      await tester.enterText(key('m11-complaint-body'), 'Hàng bị móp');
      await settle(tester);
      await tap(tester, key('m11-evidence-add'));
      expect(find.text('Đã chọn 1 ảnh'), findsOneWidget);
      await tap(tester, key('m11-complaint-send'));
      expect(source.log, <String>['upload', 'file:GOODS:1']);
      expect(key('m11-complaint-code'), findsOneWidget, reason: 'the file opens after filing');
    });

    testWidgets('a complaint about a rating has exactly the Shipper-review category', (WidgetTester tester) async {
      await mount(tester, ComplaintFormScreen(source: FakeM11(), role: M11Role.shipper, subject: const ComplaintSubject.review('r1'), subjectLabel: 'Đánh giá 2 sao', picker: FakeImagePicker()));
      expect(key('m11-category-SHIPPER_REVIEW'), findsNothing, reason: 'the single group is chosen for the person');
      await tester.enterText(key('m11-complaint-body'), 'Nhầm đơn');
      await settle(tester);
      expect(tester.widget<N11Button>(key('m11-complaint-send')).onPressed, isNotNull);
    });

    testWidgets('the file shows only the actions the server allows', (WidgetTester tester) async {
      final FakeM11 source = FakeM11()..detail = ComplaintDetail.fromJson(detailJson(canSupplement: false));
      await mount(tester, ComplaintDetailScreen(source: source, role: M11Role.customer, complaintId: 'c1', picker: FakeImagePicker()));
      expect(find.text('Đang xử lý'), findsOneWidget);
      expect(key('m11-supplement'), findsNothing);
      expect(key('m11-reconsider'), findsNothing);
    });

    testWidgets('a closed file inside the window offers the reconsideration, which the server alone decides', (WidgetTester tester) async {
      final Map<String, Object?> json = detailJson(status: 'RESOLVED', canSupplement: false, canReconsider: true)..['reconsideration_expires_at'] = '2026-10-25T09:00:00Z';
      final FakeM11 source = FakeM11()..detail = ComplaintDetail.fromJson(json);
      await mount(tester, ComplaintDetailScreen(source: source, role: M11Role.customer, complaintId: 'c1', picker: FakeImagePicker()));
      expect(key('m11-reconsider-until'), findsOneWidget);
      await tap(tester, key('m11-reconsider'));
      await tester.enterText(key('m07-reason-field'), 'Chưa thỏa đáng');
      await settle(tester);
      await tap(tester, key('m07-reason-confirm'));
      await tap(tester, key('m11-reconsider-send'));
      expect(source.log, <String>['reconsider']);
      expect(key('m11-reconsider-sent'), findsOneWidget);
    });

    testWidgets('an expired closed file says "Đã hết hạn xem xét lại"', (WidgetTester tester) async {
      final Map<String, Object?> json = detailJson(status: 'CLOSED_NO_ACTION', canSupplement: false)..['reconsideration_expires_at'] = '2026-10-10T09:00:00Z';
      final FakeM11 source = FakeM11()..detail = ComplaintDetail.fromJson(json);
      await mount(tester, ComplaintDetailScreen(source: source, role: M11Role.customer, complaintId: 'c1', picker: FakeImagePicker()));
      expect(key('m11-reconsider-expired'), findsOneWidget);
      expect(key('m11-reconsider'), findsNothing);
    });

    testWidgets('a related party sees no submitter text', (WidgetTester tester) async {
      final FakeM11 source = FakeM11()..detail = ComplaintDetail.fromJson(detailJson(relation: 'PARTY', body: null));
      await mount(tester, ComplaintDetailScreen(source: source, role: M11Role.shop, complaintId: 'c1', picker: FakeImagePicker()));
      expect(find.text('Bạn là bên liên quan'), findsOneWidget);
      expect(find.text('Nội dung bạn gửi'), findsNothing);
      expect(find.text('Giải trình'), findsOneWidget);
    });

    testWidgets('"Phản ánh của tôi" lists the open files with the counts', (WidgetTester tester) async {
      await mount(tester, ComplaintsScreen(source: FakeM11(), role: M11Role.shop, picker: FakeImagePicker()));
      expect(find.text('Đang mở (1)'), findsOneWidget);
      expect(find.text('Đã đóng (0)'), findsOneWidget);
      expect(find.text('PA-0001'), findsOneWidget);
    });
  });
}
