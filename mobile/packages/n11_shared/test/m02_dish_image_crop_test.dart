import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';

import 'm02_shop_views_test.dart' show harness, tapKey, Harness;

Uint8List makeTestPng(int width, int height, {img.Color? color}) {
  final img.Image image = img.Image(width: width, height: height);
  img.fill(image, color: color ?? img.ColorRgb8(220, 100, 40));
  // Draw top border green, bottom border blue
  for (int x = 0; x < width; x++) {
    image.setPixelRgb(x, 0, 0, 255, 0);
    image.setPixelRgb(x, height - 1, 0, 0, 255);
  }
  return Uint8List.fromList(img.encodePng(image));
}

void main() {
  group('1. Pure Crop & Bake Math (Portrait, Landscape, Square)', () {
    test('Portrait image (200x400): crops 1:1, clamps bounds, preserves aspect ratio without empty space', () {
      final Uint8List rawPortrait = makeTestPng(200, 400);

      // Center crop at 1.0x
      final PickedImage centered = bakeDishCrop(
        rawBytes: rawPortrait,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: Offset.zero,
        targetDimension: 512,
      );
      expect(centered.contentType, 'image/png');
      expect(centered.bytes.length, lessThanOrEqualTo(kDishImageMaxBytes));
      final img.Image? decodedCenter = img.decodeImage(centered.bytes);
      expect(decodedCenter, isNotNull);
      expect(decodedCenter!.width, 512);
      expect(decodedCenter.height, 512);

      // Extreme top pan (+300) should clamp to top edge
      final Rect topRect = computeDishCropRect(
        imageWidth: 200,
        imageHeight: 400,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: const Offset(0, 300),
      );
      expect(topRect.left, 0.0);
      expect(topRect.top, 0.0);
      expect(topRect.width, 200.0);
      expect(topRect.height, 200.0);

      // Extreme bottom pan (-300) should clamp to bottom edge
      final Rect bottomRect = computeDishCropRect(
        imageWidth: 200,
        imageHeight: 400,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: const Offset(0, -300),
      );
      expect(bottomRect.left, 0.0);
      expect(bottomRect.top, 200.0);
      expect(bottomRect.width, 200.0);
      expect(bottomRect.height, 200.0);
    });

    test('Landscape image (400x200): crops 1:1, clamps horizontal bounds without empty space', () {
      final Uint8List rawLandscape = makeTestPng(400, 200);

      // Center crop
      final PickedImage centered = bakeDishCrop(
        rawBytes: rawLandscape,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: Offset.zero,
        targetDimension: 512,
      );
      expect(centered.contentType, 'image/png');
      final img.Image? decoded = img.decodeImage(centered.bytes);
      expect(decoded, isNotNull);
      expect(decoded!.width, 512);
      expect(decoded.height, 512);

      // Extreme left pan (+300)
      final Rect leftRect = computeDishCropRect(
        imageWidth: 400,
        imageHeight: 200,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: const Offset(300, 0),
      );
      expect(leftRect.left, 0.0);
      expect(leftRect.top, 0.0);
      expect(leftRect.width, 200.0);
      expect(leftRect.height, 200.0);

      // Extreme right pan (-300)
      final Rect rightRect = computeDishCropRect(
        imageWidth: 400,
        imageHeight: 200,
        viewportSize: 280,
        zoom: 1.0,
        panOffset: const Offset(-300, 0),
      );
      expect(rightRect.left, 200.0);
      expect(rightRect.top, 0.0);
      expect(rightRect.width, 200.0);
      expect(rightRect.height, 200.0);
    });

    test('Square image (300x300) with Zoom: supports 1.0x to 4.0x zoom and sub-region crop', () {
      final Uint8List rawSquare = makeTestPng(300, 300);

      // Zoom 2.0x
      final Rect zoomRect = computeDishCropRect(
        imageWidth: 300,
        imageHeight: 300,
        viewportSize: 300,
        zoom: 2.0,
        panOffset: Offset.zero,
      );
      expect(zoomRect.width, 150.0);
      expect(zoomRect.height, 150.0);
      expect(zoomRect.left, 75.0);
      expect(zoomRect.top, 75.0);

      final PickedImage zoomed = bakeDishCrop(
        rawBytes: rawSquare,
        viewportSize: 300,
        zoom: 2.0,
        panOffset: const Offset(50, 50),
        targetDimension: 512,
      );
      expect(zoomed.contentType, 'image/png');
      final img.Image? decoded = img.decodeImage(zoomed.bytes);
      expect(decoded!.width, 512);
      expect(decoded.height, 512);
    });
  });

  group('2. DishImageCropScreen Widget UI & Gestures', () {
    testWidgets('supports zoom in/out buttons, slider, pan drag, reset, and done', (WidgetTester tester) async {
      final Uint8List portrait = makeTestPng(200, 400);
      PickedImage? result;

      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: ElevatedButton(
              onPressed: () async {
                result = await Navigator.of(context).push<PickedImage>(
                  MaterialPageRoute<PickedImage>(
                    builder: (_) => DishImageCropScreen(rawBytes: portrait),
                  ),
                );
              },
              child: const Text('Open Crop'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open Crop'));
      await tester.pumpAndSettle();

      expect(find.text('Căn chỉnh ảnh món'), findsOneWidget);
      expect(find.byKey(const Key('dish-image-crop-box')), findsOneWidget);

      // Test Zoom In
      expect(find.text('1.0x'), findsOneWidget);
      await tester.tap(find.byKey(const Key('dish-image-zoom-in')));
      await tester.pumpAndSettle();
      expect(find.text('1.3x'), findsOneWidget);

      // Test Zoom Out
      await tester.tap(find.byKey(const Key('dish-image-zoom-out')));
      await tester.pumpAndSettle();
      expect(find.text('1.0x'), findsOneWidget);

      // Drag to pan
      await tester.drag(find.byKey(const Key('dish-image-crop-box')), const Offset(0, -60));
      await tester.pumpAndSettle();

      // Test Reset
      expect(find.byKey(const Key('dish-image-reset')), findsOneWidget);
      await tester.tap(find.byKey(const Key('dish-image-reset')));
      await tester.pumpAndSettle();
      expect(find.text('1.0x'), findsOneWidget);

      // Tap Done -> returns cropped PickedImage
      await tester.tap(find.byKey(const Key('dish-image-crop-done')));
      await tester.pumpAndSettle();

      expect(result, isNotNull);
      expect(result!.contentType, 'image/png');
      expect(result!.bytes.length, lessThanOrEqualTo(kDishImageMaxBytes));
      expect(find.text('Căn chỉnh ảnh món'), findsNothing);
    });

    testWidgets('cancelling crop via back button returns null without changes', (WidgetTester tester) async {
      final Uint8List portrait = makeTestPng(200, 400);
      PickedImage? result = PickedImage(bytes: Uint8List.fromList(<int>[1]), contentType: 'test');

      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: ElevatedButton(
              onPressed: () async {
                result = await Navigator.of(context).push<PickedImage>(
                  MaterialPageRoute<PickedImage>(
                    builder: (_) => DishImageCropScreen(rawBytes: portrait),
                  ),
                );
              },
              child: const Text('Open Crop'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('Open Crop'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('dish-image-crop-cancel')));
      await tester.pumpAndSettle();

      expect(result, isNull);
    });
  });

  group('3. DishFormScreen 1:1 Aspect Ratio & Integration Flow', () {
    testWidgets('DishFormScreen preview has 1:1 aspect ratio matching kDishImageAspectRatio', (WidgetTester tester) async {
      final Harness h = await harness(tester, menu: FakeMenuApi());
      await h.flows.menu.load();
      h.flows.menu.startNew();
      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: DishFormScreen(flows: h.flows),
      ));
      await tester.pumpAndSettle();

      final Finder previewFinder = find.byKey(const Key('dish-image'));
      expect(previewFinder, findsOneWidget);

      final Size size = tester.getSize(previewFinder);
      expect(size.width, equals(size.height)); // 1:1 Aspect ratio
      expect(kDishImageAspectRatio, 1.0);
    });

    testWidgets('Thêm món flow with image: pick portrait -> crop -> upload -> preview in list and preview screen', (WidgetTester tester) async {
      final Uint8List portrait = makeTestPng(200, 400);
      final FakeImagePicker picker = FakeImagePicker()
        ..next = PickedImage(bytes: portrait, contentType: 'image/png');

      final Harness h = await harness(tester, menu: FakeMenuApi(), cropper: null);
      // Replace picker with portrait image picker
      final M02Flows flows = createM02Flows(
        session: h.session,
        location: h.gps,
        menuApi: h.menuApi,
        picker: picker,
        pollEvery: Duration.zero,
      );

      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: MenuListScreen(flows: flows),
      ));
      await tester.pumpAndSettle();

      // Open Add dish form
      await tapKey(tester, 'menu-add-empty');
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('dish-name')), 'Trà tắc khổng lồ');
      await tester.enterText(find.byKey(const Key('dish-price')), '25000');
      await tapKey(tester, 'dish-category');
      await tester.tap(find.text('Ốc').last);
      await tester.pumpAndSettle();

      // Tap image-pick
      await tapKey(tester, 'image-pick');
      await tester.pumpAndSettle();

      // Crop screen opens
      expect(find.text('Căn chỉnh ảnh món'), findsOneWidget);
      await tapKey(tester, 'dish-image-crop-done');
      await tester.pumpAndSettle();

      // Back on form, image upload succeeded
      expect(find.byKey(const Key('image-replace')), findsOneWidget);
      expect(find.byKey(const Key('image-recrop')), findsOneWidget);

      // Save dish
      await tapKey(tester, 'dish-save');
      await tester.pumpAndSettle();

      // On MenuListScreen
      expect(find.text('Trà tắc khổng lồ'), findsOneWidget);
      expect(find.byType(DishThumb), findsOneWidget);

      // Verify DishThumb is 1:1
      final Size thumbSize = tester.getSize(find.byType(DishThumb).first);
      expect(thumbSize.width, equals(thumbSize.height));
      expect(thumbSize.width, 72.0);
    });

    testWidgets('Sửa món: cancel in crop screen keeps old image untouched', (WidgetTester tester) async {
      final FakeMenuApi api = FakeMenuApi(items: <MenuItem>[
        FakeMenuApi.item('item-1', 'Cà phê muối', 30000, 'c1', image: 'old-ref'),
      ]);
      final Uint8List landscape = makeTestPng(400, 200);
      final FakeImagePicker picker = FakeImagePicker()
        ..next = PickedImage(bytes: landscape, contentType: 'image/png');

      final Harness h = await harness(tester, menu: api);
      final M02Flows flows = createM02Flows(
        session: h.session,
        location: h.gps,
        menuApi: api,
        picker: picker,
        pollEvery: Duration.zero,
      );

      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: MenuListScreen(flows: flows),
      ));
      await tester.pumpAndSettle();

      await tapKey(tester, 'dish-item-1');
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('image-replace')), findsOneWidget);

      // Tap replace
      await tapKey(tester, 'image-replace');
      await tester.pumpAndSettle();

      expect(find.text('Căn chỉnh ảnh món'), findsOneWidget);

      // Cancel crop
      await tapKey(tester, 'dish-image-crop-cancel-btn');
      await tester.pumpAndSettle();

      // Old image is preserved!
      expect(find.text('Căn chỉnh ảnh món'), findsNothing);
      expect(flows.menu.form?.imageUrl, api.items.first.imageUrl);
      expect(flows.menu.form?.imageRef, 'old-ref');
      expect(find.byKey(const Key('image-error')), findsNothing);
    });

    testWidgets('Recrop: tapping Căn chỉnh lại reopens crop screen on raw picked image without picking again', (WidgetTester tester) async {
      final Uint8List portrait = makeTestPng(200, 400);
      int pickCalls = 0;
      final FakeImagePicker picker = FakeImagePicker()
        ..next = PickedImage(bytes: portrait, contentType: 'image/png');

      final Harness h = await harness(tester, menu: FakeMenuApi(), cropper: null);
      final M02Flows flows = createM02Flows(
        session: h.session,
        location: h.gps,
        menuApi: h.menuApi,
        picker: picker,
        pollEvery: Duration.zero,
      );

      await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: MenuListScreen(flows: flows),
      ));
      await tester.pumpAndSettle();

      await tapKey(tester, 'menu-add-empty');
      await tester.pumpAndSettle();

      // Pick & crop
      await tapKey(tester, 'image-pick');
      await tester.pumpAndSettle();
      pickCalls = picker.calls;
      expect(pickCalls, greaterThan(0));

      await tapKey(tester, 'dish-image-crop-done');
      await tester.pumpAndSettle();

      // Tap recrop
      expect(find.byKey(const Key('image-recrop')), findsOneWidget);
      await tapKey(tester, 'image-recrop');
      await tester.pumpAndSettle();

      // Crop screen reopened WITHOUT picking from device again
      expect(find.text('Căn chỉnh ảnh món'), findsOneWidget);
      expect(picker.calls, equals(pickCalls)); // Picker was not called again!

      await tapKey(tester, 'dish-image-crop-done');
      await tester.pumpAndSettle();

      expect(find.text('Căn chỉnh ảnh món'), findsNothing);
    });
  });
}
