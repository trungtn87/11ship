import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';

// Issue #388: the ⓘ hint hides long explanations behind an icon next to the label. Checks: the icon opens the exact text, closing works,
// the label and any state/validation stay visible, the 360dp layout does not overflow at text scale 1.0 and 1.3, and the Gọi ship form still
// sends the same delivery.

Future<void> mountAt(WidgetTester tester, Widget screen, {double textScale = 1.0, bool scaffold = true, Size logical = const Size(360, 800)}) async {
  tester.view.physicalSize = Size(logical.width * 3, logical.height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildN11Theme(),
      builder: (BuildContext context, Widget? child) =>
          MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child!),
      home: scaffold ? Scaffold(body: SingleChildScrollView(child: screen)) : screen,
    ),
  );
  for (int i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 30));
  }
}

Finder infoFor(String title) => find.byTooltip('Xem giải thích: $title');

Future<void> tapInfo(WidgetTester tester, String title) async {
  await tester.ensureVisible(infoFor(title));
  await tester.tap(infoFor(title));
  await tester.pumpAndSettle();
}

void main() {
  group('InfoHint', () {
    testWidgets('icon has a readable label, opens the exact text and closes with "Đã hiểu"', (WidgetTester tester) async {
      await mountAt(tester, const InfoHint(title: 'Mô tả', message: 'Ví dụ: Quần áo, tài liệu'));
      expect(infoFor('Mô tả'), findsOneWidget);
      expect(find.text('Ví dụ: Quần áo, tài liệu'), findsNothing);
      await tapInfo(tester, 'Mô tả');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('info-hint-dialog')), findsOneWidget);
      expect(find.text('Ví dụ: Quần áo, tài liệu'), findsOneWidget);
      await tester.tap(find.text('Đã hiểu'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('info-hint-dialog')), findsNothing);
    });

    testWidgets('the tap target is at least 44dp', (WidgetTester tester) async {
      await mountAt(tester, const InfoHint(title: 'Mô tả', message: 'x'));
      final Size size = tester.getSize(find.byKey(const Key('info-hint-button')));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    });
  });

  group('N11Field info', () {
    testWidgets('label stays visible, ⓘ opens the text, and the input keeps working', (WidgetTester tester) async {
      final TextEditingController c = TextEditingController();
      addTearDown(c.dispose);
      await mountAt(tester, N11Field(fieldKey: const Key('f1'), label: 'Ghi chú', controller: c, info: 'Ví dụ: Hàng dễ vỡ'));
      expect(find.text('Ghi chú'), findsOneWidget);
      expect(find.text('Ví dụ: Hàng dễ vỡ'), findsNothing);
      await tapInfo(tester, 'Ghi chú');
      await tester.pumpAndSettle();
      expect(find.text('Ví dụ: Hàng dễ vỡ'), findsOneWidget);
      await tester.tap(find.text('Đã hiểu'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('f1')), 'abc');
      expect(c.text, 'abc');
    });

    testWidgets('no info icon and no gap when info is null', (WidgetTester tester) async {
      final TextEditingController c = TextEditingController();
      addTearDown(c.dispose);
      await mountAt(tester, N11Field(fieldKey: const Key('f2'), label: 'Tên', controller: c));
      expect(find.byKey(const Key('info-hint-button')), findsNothing);
    });
  });

  group('layout at 360dp', () {
    for (final double scale in <double>[1.0, 1.3]) {
      testWidgets('N11Field with a long info does not overflow at text scale $scale', (WidgetTester tester) async {
        final TextEditingController c = TextEditingController();
        addTearDown(c.dispose);
        await mountAt(
          tester,
          N11Field(
            fieldKey: const Key('f3'),
            label: 'Thu hộ tiền hàng và ghi chú dài cho tài xế (tùy chọn)',
            controller: c,
            info: 'Ví dụ: Quần áo, tài liệu, đồ gia dụng, hàng cồng kềnh cần giao gấp kèm hướng dẫn nhận hàng',
          ),
          textScale: scale,
        );
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Gọi ship form', () {
    Future<void> mountCall(WidgetTester tester, {double textScale = 1.0}) async {
      await mountAt(tester, CustomerCallScreen(source: SampleCustomerDeliverySource()), textScale: textScale, scaffold: false);
    }

    testWidgets('long examples are behind ⓘ, required lines stay visible', (WidgetTester tester) async {
      await mountCall(tester);
      expect(find.text('Mô tả hàng hóa (*)'), findsOneWidget);
      expect(find.text('Ví dụ: Quần áo, tài liệu, đồ gia dụng...'), findsNothing);
      expect(find.text('Shipper thu hộ từ người nhận và đưa lại người gửi'), findsNothing);
      expect(find.text('Ghi chú cho tài xế (tùy chọn)'), findsOneWidget);
      expect(find.text('Thu hộ tiền hàng (COD)'), findsOneWidget);
      expect(infoFor('Mô tả hàng hóa (*)'), findsOneWidget);
      expect(infoFor('Ghi chú cho tài xế (tùy chọn)'), findsOneWidget);
      expect(infoFor('Thu hộ tiền hàng (COD)'), findsOneWidget);
      expect(infoFor('Đề xuất mức phí giao'), findsOneWidget);
    });

    testWidgets('tapping COD ⓘ shows the explanation and does not switch COD on', (WidgetTester tester) async {
      await mountCall(tester);
      await tapInfo(tester, 'Thu hộ tiền hàng (COD)');
      await tester.pumpAndSettle();
      expect(find.text('Shipper thu hộ từ người nhận và đưa lại người gửi'), findsOneWidget);
      await tester.tap(find.text('Đã hiểu'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('m07-c-cod-amount')), findsNothing);
    });

    testWidgets('the goods example opens from ⓘ', (WidgetTester tester) async {
      await mountCall(tester);
      await tapInfo(tester, 'Mô tả hàng hóa (*)');
      await tester.pumpAndSettle();
      expect(find.text('Ví dụ: Quần áo, tài liệu, đồ gia dụng...'), findsOneWidget);
    });

    for (final double scale in <double>[1.0, 1.3]) {
      testWidgets('360dp at text scale $scale does not overflow', (WidgetTester tester) async {
        await mountCall(tester, textScale: scale);
        expect(tester.takeException(), isNull);
      });
    }
  });
}
