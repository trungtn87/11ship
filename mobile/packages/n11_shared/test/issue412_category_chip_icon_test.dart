import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:n11_shared/src/m02/category_chip_icon.dart';

// Issue #412: the home category chip shows the Administration picture when there is one, and the #386 fallback icon otherwise (no
// picture, still loading, a failed or offline load). The picture is never stretched: it is drawn in a square box with BoxFit.contain.

/// A 1x1 transparent PNG (a valid, decodable picture).
final Uint8List _png = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');

/// Stands for a picture that cannot be loaded (offline, 404, a broken file).
class _Offline extends ImageProvider<_Offline> {
  const _Offline();

  @override
  Future<_Offline> obtainKey(ImageConfiguration configuration) => SynchronousFuture<_Offline>(this);

  @override
  ImageStreamCompleter loadImage(_Offline key, ImageDecoderCallback decode) =>
      OneFrameImageStreamCompleter(Future<ImageInfo>.error(Exception('offline')));
}

Widget _host(Widget child) => MaterialApp(
      home: Scaffold(body: Center(child: child)),
    );

void main() {
  const IconData fallback = Icons.set_meal_rounded;

  testWidgets('no picture: the fallback icon is drawn and no image is built', (WidgetTester tester) async {
    await tester.pumpWidget(_host(const CategoryChipIcon(icon: fallback, color: Colors.black)));
    expect(find.byIcon(fallback), findsOneWidget);
    expect(find.byType(Image), findsNothing);
  });

  testWidgets('a picture that cannot be loaded falls back to the group icon (no broken box)', (WidgetTester tester) async {
    await tester.pumpWidget(_host(const CategoryChipIcon(icon: fallback, color: Colors.black, provider: _Offline())));
    await tester.pump();
    await tester.pump();
    expect(find.byIcon(fallback), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a picture that loads replaces the fallback and keeps the square box (BoxFit.contain, no stretch)', (WidgetTester tester) async {
    await tester.pumpWidget(_host(CategoryChipIcon(icon: fallback, color: Colors.black, provider: MemoryImage(_png))));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pump();
    final Image image = tester.widget<Image>(find.byType(Image));
    expect(image.fit, BoxFit.contain);
    expect(image.width, image.height);
    expect(find.byIcon(fallback), findsNothing);
  });
}
