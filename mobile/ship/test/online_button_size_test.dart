// #392 (20/11 Owner update): the round Online button is about 56 dp, its tap area is at least 48 dp, and the card keeps every state
// (Online / Offline / paused / loading / disabled / refused) and every warning readable at 1.5x font on a narrow screen.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_home.dart';

const String _reason = 'Lý do thử nghiệm';

Future<void> _mount(
  WidgetTester tester,
  Widget child, {
  double width = 390,
  double textScale = 1,
}) async {
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(
    theme: buildN11Theme(),
    builder: (BuildContext context, Widget? w) => MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(textScale)),
      child: w!,
    ),
    home: Scaffold(
      body: SingleChildScrollView(child: child),
    ),
  ));
}

void main() {
  testWidgets('round button is about 56 dp and its tap area is at least 48 dp',
      (WidgetTester tester) async {
    await _mount(
        tester,
        ShipActivityPanel(
            online: false, reason: _reason, onToggle: () {}));
    final Size size = tester.getSize(find.byKey(const Key('online-button')));
    expect(kShipOnlineButtonSize, inInclusiveRange(52, 64));
    expect(size, const Size(56, 56));
    expect(size.width >= 48 && size.height >= 48, isTrue);
  });

  testWidgets('Offline with a working toggle calls it once per tap',
      (WidgetTester tester) async {
    int taps = 0;
    await _mount(
        tester,
        ShipActivityPanel(
            online: false, reason: _reason, onToggle: () => taps++));
    expect(find.text('Offline'), findsOneWidget);
    await tester.tap(find.byKey(const Key('online-button')));
    await tester.pump();
    expect(taps, 1);
  });

  testWidgets('Online and paused: label, sub-line and the same single button',
      (WidgetTester tester) async {
    await _mount(
        tester,
        ShipActivityPanel(
            online: true,
            paused: true,
            reason: _reason,
            onToggle: () {}));
    expect(find.text('Online'), findsOneWidget);
    expect(find.text('Tạm dừng nhận đơn'), findsOneWidget);
    expect(find.byKey(const Key('online-button')), findsOneWidget);
  });

  testWidgets('loading: spinner shown, button disabled, a second tap does nothing',
      (WidgetTester tester) async {
    int taps = 0;
    await _mount(
        tester,
        ShipActivityPanel(
            online: false,
            reason: _reason,
            busy: true,
            onToggle: () => taps++));
    expect(
      find.descendant(
        of: find.byKey(const Key('online-button')),
        matching: find.byType(CircularProgressIndicator),
      ),
      findsOneWidget,
    );
    final FilledButton button =
        tester.widget<FilledButton>(find.byKey(const Key('online-button')));
    expect(button.onPressed, isNull);
    await tester.tap(find.byKey(const Key('online-button')), warnIfMissed: false);
    await tester.pump();
    expect(taps, 0);
  });

  testWidgets('unknown state and blocked (no toggle): disabled, badge and refusal message visible',
      (WidgetTester tester) async {
    await _mount(
        tester, ShipActivityPanel(online: null, reason: _reason));
    expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('online-button')))
            .onPressed,
        isNull);
    expect(find.text('Chưa xác định'), findsOneWidget);

    await _mount(
        tester,
        const ShipActivityPanel(
            online: false,
            reason: _reason,
            message: 'Chưa thể bật online lúc này.'));
    expect(find.byKey(const Key('home-status-badge')), findsOneWidget);
    expect(find.text('Chưa đủ điều kiện'), findsOneWidget);
    expect(find.byKey(const Key('home-online-message')), findsOneWidget,
        reason: 'a server refusal stays visible without opening the (i)');
    expect(find.byKey(const Key('home-online-reason')), findsNothing,
        reason: 'the long explanation stays behind the (i)');
  });

  testWidgets('a location problem stays visible on the card', (WidgetTester tester) async {
    await _mount(
        tester,
        ShipActivityPanel(
            online: true,
            reason: _reason,
            onToggle: () {},
            problem: const Text('Cần bật định vị', key: Key('gps-problem'))));
    expect(find.byKey(const Key('gps-problem')), findsOneWidget);
  });

  for (final ({String name, double width, double scale}) c in <({String name, double width, double scale})>[
    (name: 'font 1.5x on 390 wide', width: 390, scale: 1.5),
    (name: 'font 1.5x on 320 wide', width: 320, scale: 1.5),
  ]) {
    testWidgets('${c.name}: no overflow, button stays 56 dp, Online label visible',
        (WidgetTester tester) async {
      await _mount(
          tester,
          ShipActivityPanel(
              online: true,
              paused: false,
              reason: _reason,
              message: 'Thông báo khá dài để kiểm tra việc xuống dòng trên màn hình hẹp.',
              onToggle: () {}),
          width: c.width,
          textScale: c.scale);
      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byKey(const Key('online-button'))), const Size(56, 56));
      expect(find.text('Online'), findsOneWidget);
    });
  }
}
