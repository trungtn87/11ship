import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/address_change/address_change_models.dart';
import 'package:n11_shared/src/address_change/address_change_widgets.dart';
import 'package:n11_shared/src/guidance/order_incident_guidance.dart';

void main() {
  group('AddressChangeModels (#218)', () {
    test('parses json correctly and handles expiry', () {
      final AddressChangeView pending = AddressChangeView.fromJson(<String, Object?>{
        'change_request_id': 'req-1',
        'status': 'PENDING',
        'is_expired': false,
        'time_remaining_seconds': 120,
        'source': 'ORDER',
        'target_actor': 'SHOP',
        'original_recipient': <String, Object?>{
          'name': 'Nguyễn Văn A',
          'phone': '0912345678',
          'address_text': 'Địa chỉ cũ',
        },
        'new_recipient': <String, Object?>{
          'name': 'Nguyễn Văn B',
          'phone': '0987654321',
          'address_text': 'Địa chỉ mới',
          'lat': 21.0,
          'lng': 105.8,
        },
        'original_fee_vnd': 20000,
        'new_fee_vnd': 30000,
        'fee_difference_vnd': 10000,
        'version': 1,
        'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'created_at': DateTime.now().toIso8601String(),
      });

      expect(pending.changeRequestId, 'req-1');
      expect(pending.isPending, isTrue);
      expect(pending.isAccepted, isFalse);
      expect(pending.isRejected, isFalse);
      expect(pending.timeRemainingSeconds, 120);
      expect(pending.feeDifferenceVnd, 10000);
      expect(pending.newRecipient.name, 'Nguyễn Văn B');
      expect(pending.newRecipient.lat, 21.0);
    });
  });

  group('AddressChangeBanner (#218)', () {
    final AddressChangeView pending = AddressChangeView.fromJson(<String, Object?>{
      'change_request_id': 'req-1',
      'status': 'PENDING',
      'is_expired': false,
      'time_remaining_seconds': 95,
      'source': 'ORDER',
      'target_actor': 'SHOP',
      'original_recipient': <String, Object?>{
        'name': 'Khách A',
        'phone': '0901234567',
        'address_text': '1 Cũ',
      },
      'new_recipient': <String, Object?>{
        'name': 'Khách B',
        'phone': '0909876543',
        'address_text': '2 Mới',
      },
      'fee_difference_vnd': 5000,
      'version': 1,
      'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
      'created_at': DateTime.now().toIso8601String(),
    });

    testWidgets('renders pending banner with actions for decider and requester', (WidgetTester tester) async {
      var cancelled = false;
      var accepted = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AddressChangeBanner(
              request: pending,
              canCancel: true,
              canDecide: true,
              onCancel: () => cancelled = true,
              onAccept: () => accepted = true,
              onReject: (_) {},
            ),
          ),
        ),
      );

      expect(find.textContaining('Đang xin đổi địa chỉ'), findsOneWidget);
      expect(find.textContaining('Khách B'), findsOneWidget);
      expect(find.textContaining('2 Mới'), findsOneWidget);
      expect(find.textContaining('95s'), findsOneWidget);

      await tester.tap(find.text('Hủy yêu cầu đổi địa chỉ'));
      expect(cancelled, isTrue);

      await tester.tap(find.text('Đồng ý'));
      expect(accepted, isTrue);
    });

    testWidgets('renders rejected and expired banners', (WidgetTester tester) async {
      final AddressChangeView rejected = AddressChangeView.fromJson(<String, Object?>{
        'change_request_id': 'req-2',
        'status': 'REJECTED',
        'reject_reason': 'Quá xa không giao được',
        'is_expired': false,
        'source': 'ORDER',
        'target_actor': 'SHIPPER',
        'original_recipient': <String, Object?>{'name': 'A', 'phone': '090', 'address_text': 'Old'},
        'new_recipient': <String, Object?>{'name': 'B', 'phone': '091', 'address_text': 'New'},
        'version': 2,
        'expires_at': DateTime.now().toIso8601String(),
        'created_at': DateTime.now().toIso8601String(),
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AddressChangeBanner(request: rejected),
          ),
        ),
      );

      expect(find.text('Yêu cầu đổi địa chỉ bị từ chối'), findsOneWidget);
      expect(find.text('Quá xa không giao được'), findsOneWidget);
    });

    testWidgets('renders banner with shipper notice that current fee is kept', (WidgetTester tester) async {
      final AddressChangeView shipperTarget = AddressChangeView.fromJson(<String, Object?>{
        'change_request_id': 'req-3',
        'status': 'PENDING',
        'is_expired': false,
        'time_remaining_seconds': 120,
        'source': 'ORDER',
        'target_actor': 'SHIPPER',
        'original_recipient': <String, Object?>{'name': 'A', 'phone': '090', 'address_text': 'Old'},
        'new_recipient': <String, Object?>{'name': 'B', 'phone': '091', 'address_text': 'New'},
        'original_fee_vnd': 25000,
        'new_fee_vnd': 35000,
        'version': 1,
        'expires_at': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'created_at': DateTime.now().toIso8601String(),
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AddressChangeBanner(request: shipperTarget),
          ),
        ),
      );

      expect(find.textContaining('Chờ Shipper duyệt'), findsOneWidget);
      expect(find.textContaining('giữ nguyên cước hiện tại; nếu cần điều chỉnh phí sẽ qua đề xuất phí riêng'), findsOneWidget);
    });

    testWidgets('renders AddressChangeRequestSheet with location picker support and text-only clear pin', (WidgetTester tester) async {
      String? submittedName;
      String? submittedAddress;
      double? submittedLat;
      double? submittedLng;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AddressChangeRequestSheet(
              initialName: 'Lê Văn C',
              initialPhone: '0933333333',
              initialAddress: '789 Giải Phóng',
              initialLat: 20.99,
              initialLng: 105.84,
              onSubmit: ({required String name, required String phone, required String address, double? lat, double? lng, String? note}) async {
                submittedName = name;
                submittedAddress = address;
                submittedLat = lat;
                submittedLng = lng;
              },
            ),
          ),
        ),
      );

      expect(find.text('Xin đổi địa chỉ giao hàng'), findsOneWidget);
      expect(find.textContaining('Tọa độ: 20.9900, 105.8400'), findsOneWidget);
      expect(find.text('Sửa vị trí'), findsOneWidget);

      // Test clearing pin to submit text-only address (#218)
      await tester.tap(find.byTooltip('Bỏ ghim tọa độ'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Địa chỉ chữ (chưa ghim tọa độ, giữ nguyên cước phí hiện tại)'), findsOneWidget);

      await tester.tap(find.text('Gửi yêu cầu đổi địa chỉ'));
      await tester.pumpAndSettle();

      expect(submittedName, 'Lê Văn C');
      expect(submittedAddress, '789 Giải Phóng');
      expect(submittedLat, isNull);
      expect(submittedLng, isNull);
    });
  });

  group('OrderIncidentGuidance & ShipperOperationalGuidance (#217)', () {
    testWidgets('shipper incident guidance aligns with M07 custody and lacks fail action', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: OrderIncidentGuidance(
              role: 'SHIPPER',
              deliveryState: 'delivering',
              initiallyExpanded: true,
            ),
          ),
        ),
      );

      // Verify guidance does NOT tell shipper to self-fail or cite 3 calls/15 mins
      expect(find.textContaining('chọn "Giao thất bại"'), findsNothing);
      expect(find.textContaining('Báo giao thất bại'), findsNothing);
      expect(find.textContaining('3 cuộc'), findsNothing);

      // Verify guidance directs contacting shop/customer and returning custody
      expect(find.textContaining('liên hệ quán hoặc trung tâm hỗ trợ'), findsOneWidget);
      expect(find.textContaining('mang trả lại quán'), findsOneWidget);
    });
    testWidgets('displays collapsible incident guidance and triggers expansion', (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: OrderIncidentGuidance(
              role: 'CUSTOMER',
              orderStatus: 'PREPARING',
              canRequestAddressChange: true,
              initiallyExpanded: false,
            ),
          ),
        ),
      );

      expect(find.text('Hướng dẫn xử lý sự cố'), findsOneWidget);
      // Collapsed initially
      expect(find.text('Không liên lạc được đối tác/khách'), findsNothing);

      // Tap to expand
      await tester.tap(find.text('Hướng dẫn xử lý sự cố'));
      await tester.pumpAndSettle();

      expect(find.text('Không liên lạc được đối tác/khách'), findsOneWidget);
      expect(find.text('Nhập sai hoặc cần đổi địa chỉ'), findsOneWidget);
    });

    testWidgets('opens ShipperOperationalGuidanceSheet', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => ElevatedButton(
                onPressed: () => ShipperOperationalGuidanceSheet.show(context),
                child: const Text('Open Help'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open Help'));
      await tester.pumpAndSettle();

      expect(find.text('Hướng dẫn hoạt động Shipper'), findsOneWidget);
      expect(find.text('Không thể Bật Online nhận đơn'), findsOneWidget);
      expect(find.text('Không thể Rút tiền từ ví'), findsOneWidget);
      expect(find.text('Không thể Đóng hoạt động / Nghỉ ca'), findsOneWidget);

      await tester.tap(find.text('Đã hiểu'));
      await tester.pumpAndSettle();

      expect(find.text('Hướng dẫn hoạt động Shipper'), findsNothing);
    });
  });
}
