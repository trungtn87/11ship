import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/n11_shared.dart';
import 'package:ship/ship_home.dart';

// Fixture renders are opt-in; interaction/layout assertions always run.
void main() {
  final String? out = Platform.environment['N11_SHIP_V4_SCREENSHOTS'];
  final GlobalKey boundary = GlobalKey();

  setUpAll(() async {
    if (out == null) return;
    final FontLoader font = FontLoader('packages/n11_shared/PlusJakartaSans');
    for (final String weight in <String>['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
      final Uint8List bytes = File('../packages/n11_shared/assets/fonts/PlusJakartaSans-$weight.ttf').readAsBytesSync();
      font.addFont(Future<ByteData>.value(ByteData.sublistView(bytes)));
    }
    await font.load();
    final FontLoader icons = FontLoader('MaterialIcons');
    icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await icons.load();
  });

  Future<void> mount(WidgetTester tester, Widget screen, double width, double scale) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundary,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: buildN11Theme(),
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: screen,
        ),
      ),
    );
    for (int i = 0; i < 8; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
    expect(tester.takeException(), isNull);
  }

  Future<void> shot(WidgetTester tester, String name) async {
    if (out == null) return;
    final RenderRepaintBoundary render = tester.renderObject(find.byKey(boundary));
    final ui.Image image = (await tester.runAsync(() => render.toImage(pixelRatio: 2)))!;
    final ByteData? bytes = await tester.runAsync<ByteData?>(() => image.toByteData(format: ui.ImageByteFormat.png));
    Directory(out).createSync(recursive: true);
    File('$out/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
    image.dispose();
  }

  for (final double width in <double>[320, 390, 600]) {
    final double scale = width == 320 ? 2 : 1;
    testWidgets('V4 offer, activity and wallet at ${width.toInt()}dp / ${scale}x text preserve actions', (WidgetTester tester) async {
      final SampleShipperSource source = SampleShipperSource();
      final OfferView offer = (await source.offers()).first;
      int accepted = 0;
      await mount(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: OfferCard(offer: offer, busy: false, onAccept: () => accepted++, onAgree: () {}, onSkip: () {}, onCounter: () {}),
          ),
        ),
        width,
        scale,
      );
      await shot(tester, 'offer-${width.toInt()}');
      final Finder accept = find.byKey(Key('m07-accept-${offer.deliveryId}'));
      await tester.ensureVisible(accept);
      await tester.tap(accept);
      await tester.pump();
      expect(accepted, 1);
      expect(tester.takeException(), isNull);
      int toggled = 0;
      await mount(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: ShipActivityPanel(online: true, reason: 'Ví đủ điều kiện. Bạn có thể bật hoạt động.', onToggle: () => toggled++),
          ),
        ),
        width,
        scale,
      );
      await shot(tester, 'activity-${width.toInt()}');
      await tester.tap(find.byKey(const Key('online-button')));
      expect(toggled, 1);
      await mount(tester, WalletHomeScreen(source: SampleWalletSource()), width, scale);
      await shot(tester, 'wallet-${width.toInt()}');
      final Finder txn = find.byType(WalletTxnTile).first;
      await tester.ensureVisible(txn);
      await tester.tap(txn);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('txn-sheet')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
    });
  }

  testWidgets('delivery map is lazy, can open and close, and completion stays available', (WidgetTester tester) async {
    int built = 0;
    await mount(
      tester,
      ShipperDeliveryDetailScreen(
        source: SampleShipperSource(),
        deliveryId: 'm-run',
        mapBuilder: (BuildContext context, List<M07MapPin> pins) {
          built++;
          return const ColoredBox(color: N11Colors.yellowSoft);
        },
      ),
      390,
      1,
    );
    expect(built, 0);
    expect(find.byKey(const Key('m07-complete')), findsOneWidget);
    final Finder header = find.byKey(const Key('section-ship-map-header'));
    await tester.ensureVisible(header);
    await tester.tap(header);
    await tester.pump();
    expect(find.byKey(const Key('m07-ship-map')), findsOneWidget);
    expect(built, greaterThan(0));
    await shot(tester, 'detail-map-open');
    await tester.tap(header);
    await tester.pump();
    expect(find.byKey(const Key('m07-ship-map')), findsNothing);
    expect(find.byKey(const Key('m07-complete')), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });
}
