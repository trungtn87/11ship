import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:n11_shared/n11_shared.dart';
import 'package:n11_shared/testing.dart';
import 'package:n11_shared/src/flows/shop_logo_data.dart';
import 'package:n11_shared/src/flows/shop_logo_widgets.dart';

import 'flows_test.dart' show signedIn;
import 'm02_shop_views_test.dart' show harness, tapKey;
import 'shop_ops_controller_test.dart' as ops_test;
import 'shop_logo_test.dart' show png;

const ShopLogoData oldLogo = ShopLogoData(
  contentType: 'image/png',
  encoded: png,
);

Future<void> finishNative(WidgetTester tester) async {
  await tester.runAsync(
    () async => Future<void>.delayed(const Duration(milliseconds: 250)),
  );
  await tester.pumpAndSettle();
}

class LogoOnlyPicker implements ImagePickerPort, ShopLogoPickerPort {
  PickedImage? next;
  bool unreadable = true;
  @override
  Future<PickedImage?> pick() async =>
      throw StateError('Dish picker must not be used for a logo');
  @override
  Future<PickedImage?> pickLogo() async {
    if (unreadable) {
      throw const ShopLogoException(
          'Không đọc được ảnh này. Vui lòng chọn ảnh khác.');
    }
    return next;
  }
}

void main() {
  test(
    'actual byte limit is checked even when Base64 length is still within the old limit',
    () {
      // 1 MiB + 1 and 1 MiB have the same Base64 length.
      final String oversized = base64Encode(Uint8List(shopLogoMaxBytes + 1));
      expect(oversized.length, 1398104);
      expect(
        ShopLogoData.tryParse(<String, Object?>{
          'content_type': 'image/png',
          'data_base64': oversized,
        }),
        isNull,
      );
      expect(
        () =>
            ShopLogoData(contentType: 'image/png', encoded: oversized).toWire(),
        throwsA(isA<ShopLogoException>()),
      );
    },
  );

  test(
    'JPEG fallback runs off the UI isolate and measures bytes before returning',
    () async {
      final Uint8List small = img.encodePng(img.Image(width: 384, height: 384));
      final Uint8List padded = Uint8List(shopLogoMaxBytes + 100)
        ..setRange(0, small.length, small);
      final ShopLogoData result = await encodeShopLogo(padded);
      expect(result.contentType, 'image/jpeg');
      expect(result.bytes.length, lessThanOrEqualTo(shopLogoMaxBytes));
      final img.Image decoded = img.decodeJpg(result.bytes)!;
      expect(<int>[decoded.width, decoded.height], <int>[384, 384]);
      await expectLater(
        encodeShopLogo(Uint8List(shopLogoMaxBytes + 1)),
        throwsA(isA<ShopLogoException>()),
      );
    },
  );

  testWidgets(
    'bad image -> choose another -> crop; explicit cancel preserves previous logo',
    (WidgetTester tester) async {
      final h = await harness(tester);
      final FakeImagePicker picker = FakeImagePicker()
        ..next = PickedImage(
          bytes: Uint8List.fromList(<int>[1, 2, 3]),
          contentType: 'image/png',
        );
      ShopLogoData? value = oldLogo;
      await tester.pumpWidget(
        MaterialApp(
          theme: buildN11Theme(),
          home: StatefulBuilder(
            builder: (BuildContext context, StateSetter set) => Scaffold(
              body: ShopLogoField(
                value: value,
                picker: picker,
                session: h.session,
                onChanged: (ShopLogoData? next) => set(() => value = next),
              ),
            ),
          ),
        ),
      );
      await tapKey(tester, 'shop-logo-pick');
      await finishNative(tester);
      expect(
        find.text('Không đọc được ảnh này. Vui lòng chọn ảnh khác.'),
        findsOneWidget,
      );
      expect(value, oldLogo);
      picker.next = PickedImage(
        bytes: base64Decode(png),
        contentType: 'image/png',
      );
      await tapKey(tester, 'shop-logo-choose-other');
      await finishNative(tester);
      await tapKey(tester, 'shop-logo-cancel');
      expect(value, oldLogo);
      await tapKey(tester, 'shop-logo-pick');
      await finishNative(tester);
      await tapKey(tester, 'shop-logo-crop-done');
      await finishNative(tester);
      expect(value, isNot(oldLogo));
      final ui.Codec codec = await tester
          .runAsync(() => ui.instantiateImageCodec(value!.bytes)) as ui.Codec;
      final ui.FrameInfo frame =
          await tester.runAsync(codec.getNextFrame) as ui.FrameInfo;
      expect(<int>[frame.image.width, frame.image.height], <int>[384, 384]);
      expect(value!.bytes.length, lessThanOrEqualTo(shopLogoMaxBytes));
      frame.image.dispose();
      codec.dispose();
    },
  );

  testWidgets(
      'picker errors and unsupported files recover; logo picker accepts JPEG and WebP',
      (WidgetTester tester) async {
    final h = await harness(tester);
    final LogoOnlyPicker picker = LogoOnlyPicker();
    ShopLogoData? value = oldLogo;
    await tester.pumpWidget(MaterialApp(
        theme: buildN11Theme(),
        home: StatefulBuilder(
            builder: (BuildContext context, StateSetter set) => Scaffold(
                    body: ShopLogoField(
                  value: value,
                  picker: picker,
                  session: h.session,
                  onChanged: (ShopLogoData? next) => set(() => value = next),
                )))));
    await tapKey(tester, 'shop-logo-pick');
    await finishNative(tester);
    expect(find.text('Không đọc được ảnh này. Vui lòng chọn ảnh khác.'),
        findsOneWidget);
    picker.unreadable = false;
    picker.next =
        PickedImage(bytes: base64Decode(png), contentType: 'image/gif');
    await tapKey(tester, 'shop-logo-choose-other');
    await finishNative(tester);
    expect(
        find.text(
            'Ảnh không đúng định dạng. Vui lòng chọn JPG, PNG hoặc WebP.'),
        findsOneWidget);
    expect(value, oldLogo);
    picker.next = PickedImage(
        bytes: img.encodeJpg(img.decodePng(base64Decode(png))!),
        contentType: 'image/jpeg');
    await tapKey(tester, 'shop-logo-choose-other');
    await finishNative(tester);
    await tapKey(tester, 'shop-logo-crop-done');
    await finishNative(tester);
    expect(value!.contentType, 'image/png');
    picker.next = PickedImage(
        bytes: base64Decode(
            'UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoIAAQAAUAmJaACdLoB+AADsAD+9pWX/iGej1Lw//lKvBY3N8AAAA=='),
        contentType: 'image/webp');
    await tapKey(tester, 'shop-logo-pick');
    await finishNative(tester);
    await tapKey(tester, 'shop-logo-crop-done');
    await finishNative(tester);
    final img.Image decoded = img.decodePng(value!.bytes)!;
    expect(<int>[decoded.width, decoded.height], <int>[384, 384]);
    expect(value!.bytes.length, lessThanOrEqualTo(shopLogoMaxBytes));
  });

  for (final int edge in <int>[1280, 2200]) {
    testWidgets(
      'large $edge px source (5–20 MB) is sampled and saved at 384 square',
      (WidgetTester tester) async {
        final Uint8List source = (await tester.runAsync(() async {
          final img.Image image = img.Image(
            width: edge,
            height: edge,
            numChannels: 4,
          );
          final Random random = Random(11);
          final Uint8List pixels = image.data!.buffer.asUint8List();
          for (int i = 0; i < pixels.length; i++) {
            pixels[i] = random.nextInt(256);
          }
          return img.encodePng(image, level: 0);
        }))!;
        expect(
          source.length,
          inInclusiveRange(5 * 1024 * 1024, 20 * 1024 * 1024),
        );
        final h = await harness(tester);
        final FakeImagePicker picker = FakeImagePicker()
          ..next = PickedImage(bytes: source, contentType: 'image/png');
        ShopLogoData? result;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildN11Theme(),
            home: Scaffold(
              body: ShopLogoField(
                value: null,
                picker: picker,
                session: h.session,
                onChanged: (ShopLogoData? logo) => result = logo,
              ),
            ),
          ),
        );
        await tapKey(tester, 'shop-logo-pick');
        await finishNative(tester);
        await tapKey(tester, 'shop-logo-crop-done');
        await finishNative(tester);
        expect(result, isNotNull);
        expect(result!.bytes.length, lessThanOrEqualTo(shopLogoMaxBytes));
        final img.Image decoded = img.decodePng(result!.bytes)!;
        expect(<int>[decoded.width, decoded.height], <int>[384, 384]);
      },
    );
  }

  for (final int status in <int>[400, 413]) {
    test(
      'onboarding $status unlocks replacement and preserves fields and saved logo',
      () async {
        final t = await signedIn(ClientApp.food);
        final FakeShopServer server = FakeShopServer(t.api);
        final ShopController shop = ShopController(
          session: t.session,
          location: FakeLocationProvider(),
        );
        shop
          ..name = 'Ốc 11'
          ..contactPhone = '0901234567'
          ..addressText = 'Cao Bằng';
        shop.setLogo(oldLogo);
        expect(await shop.saveDraft(), isTrue);
        final ShopLogoData replacement = ShopLogoData(
          contentType: 'image/png',
          encoded: base64Encode(<int>[...base64Decode(png), 1]),
        );
        shop.setLogo(replacement);
        shop.name = 'Tên đã nhập';
        final FakeHandler put =
            t.api.routes['PUT /v1/onboarding/shop/profile']!;
        t.api.routes['PUT /v1/onboarding/shop/profile'] =
            (String m, String p, Map<String, String> h, String b) async =>
                apiError(
                  status,
                  status == 413 ? 'SHOP_LOGO_TOO_LARGE' : 'INVALID_SHOP_LOGO',
                );
        expect(await shop.saveDraft(), isFalse);
        expect(shop.hasPendingWrite, isFalse);
        expect(shop.busy, isFalse);
        expect(shop.profile!.logo, oldLogo);
        expect(shop.name, 'Tên đã nhập');
        expect(
          shopLogoFailureText(shop.failure!),
          contains('Logo không hợp lệ'),
        );
        final String? rejectedKey = t.api
            .to('PUT', '/v1/onboarding/shop/profile')
            .last
            .headers['idempotency-key'];
        shop.setLogo(null);
        t.api.routes['PUT /v1/onboarding/shop/profile'] = put;
        expect(await shop.saveDraft(), isTrue);
        expect(shop.profile!.logo, isNull);
        expect(
            t.api
                .to('PUT', '/v1/onboarding/shop/profile')
                .last
                .headers['idempotency-key'],
            isNot(rejectedKey));
        expect(server.puts.last['name'], 'Tên đã nhập');
        shop.dispose();
      },
    );
  }

  test(
    'onboarding timeout locks new intent, reload preserves draft, retry uses old key/body',
    () async {
      final t = await signedIn(ClientApp.food);
      final FakeShopServer server = FakeShopServer(t.api);
      final ShopController shop = ShopController(
        session: t.session,
        location: FakeLocationProvider(),
      );
      await shop.load();
      shop
        ..name = 'Ốc 11'
        ..contactPhone = '0901234567'
        ..addressText = 'Cao Bằng';
      shop.setLogo(oldLogo);
      t.api.failNext = const AuthFailure(AuthFailureKind.unknownOutcome);
      expect(await shop.saveDraft(), isFalse);
      final RecordedRequest first =
          t.api.to('PUT', '/v1/onboarding/shop/profile').single;
      shop.setLogo(null);
      expect(shop.logo, oldLogo);
      await shop.load();
      expect(shop.name, 'Ốc 11');
      expect(shop.hasPendingWrite, isTrue);
      expect(await shop.saveDraft(), isTrue);
      final RecordedRequest retry =
          t.api.to('PUT', '/v1/onboarding/shop/profile').last;
      expect(retry.body, first.body);
      expect(first.headers['idempotency-key'], isNotNull);
      expect(
        retry.headers['idempotency-key'],
        first.headers['idempotency-key'],
      );
      expect(server.puts, hasLength(1));
      expect(shop.profile!.logo, oldLogo);
      shop.dispose();
    },
  );

  test('an in-flight or expired replay does not release the old profile intent',
      () async {
    final t = await ops_test.setup();
    t.ops.setLogo(oldLogo);
    t.server.loseAnswerOnce = true;
    expect(await t.ops.saveProfile(), isFalse);
    final PendingWrite original = t.ops.pending!;
    final FakeHandler put = t.api.routes['PUT /v1/shop/me/profile']!;
    for (final String code in <String>[
      'IDEMPOTENCY_BUSY',
      'IDEMPOTENCY_REPLAY_EXPIRED'
    ]) {
      t.api.routes['PUT /v1/shop/me/profile'] =
          (String m, String p, Map<String, String> h, String b) async =>
              apiError(409, code);
      expect(await t.ops.retryPending(), isFalse);
      expect(t.ops.locked, isTrue);
      expect(t.ops.pending!.key, original.key);
      expect(t.ops.pending!.body, original.body);
    }
    t.api.routes['PUT /v1/shop/me/profile'] = put;
    expect(await t.ops.retryPending(), isTrue);
    expect(t.server.effects, hasLength(1));
    t.ops.dispose();
  });

  test(
    'active profile rejection keeps old logo, allows replacement; lost success replays once',
    () async {
      final t = await ops_test.setup();
      t.server.logo = oldLogo.toWire();
      await t.ops.refresh();
      final FakeHandler put = t.api.routes['PUT /v1/shop/me/profile']!;
      t.ops.setLogo(null);
      t.ops.profile.name = 'Tên đã nhập';
      t.api.routes['PUT /v1/shop/me/profile'] =
          (String m, String p, Map<String, String> h, String b) async =>
              apiError(413, 'SHOP_LOGO_TOO_LARGE');
      expect(await t.ops.saveProfile(), isFalse);
      expect(t.ops.locked, isFalse);
      expect(t.ops.overview!.logo, oldLogo);
      expect(t.ops.profile.name, 'Tên đã nhập');
      t.ops.setLogo(oldLogo);
      t.api.routes['PUT /v1/shop/me/profile'] = put;
      t.server.loseAnswerOnce = true;
      expect(await t.ops.saveProfile(), isFalse);
      final PendingWrite pending = t.ops.pending!;
      t.ops.setLogo(null);
      expect(t.ops.profile.logo, oldLogo);
      expect(await t.ops.retryPending(), isTrue);
      expect(t.server.effects, hasLength(1));
      expect(t.api.to('PUT', '/v1/shop/me/profile').last.body, pending.body);
      expect(t.ops.overview!.logo, oldLogo);
      expect(t.ops.locked, isFalse);
      t.ops.dispose();
    },
  );
}
