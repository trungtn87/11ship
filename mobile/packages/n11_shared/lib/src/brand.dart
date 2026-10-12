import 'package:flutter/material.dart';

import 'tokens.dart';

// Brand identity of the two phone apps (brand guideline v1.0). The logos are the Owner-approved originals, only cropped and
// resized by tools/brand/build-brand-assets.py (never redrawn); if an asset cannot be loaded the app name is shown as text.

const String kSharedPackage = 'n11_shared';

enum AppId { food, ship }

class AppBrand {
  const AppBrand({required this.id, required this.name, required this.slogan, required this.logoAsset});

  final AppId id;

  /// The product name written as plain text (`11Food`).
  final String name;
  final String slogan;

  /// Asset path inside the n11_shared package.
  final String logoAsset;

  /// Full key of the asset as the Flutter asset bundle knows it.
  String get logoKey => 'packages/$kSharedPackage/$logoAsset';
}

const AppBrand foodBrand = AppBrand(id: AppId.food, name: '11Food', slogan: 'Thèm là có', logoAsset: 'assets/brand/logo-11food-ui.png');
const AppBrand shipBrand = AppBrand(id: AppId.ship, name: '11Ship', slogan: 'Gọi là có', logoAsset: 'assets/brand/logo-11ship-ui.png');

/// The horizontal logo of an app. [height] follows the guideline minimum (the 11Food/11Ship logo is at least ~72 px wide).
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, required this.brand, this.height = 32});

  final AppBrand brand;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      brand.logoAsset,
      package: kSharedPackage,
      height: height,
      fit: BoxFit.contain,
      semanticLabel: brand.name,
      errorBuilder: (BuildContext context, Object error, StackTrace? stackTrace) =>
          Text(brand.name, style: N11Text.title.copyWith(fontSize: height * 0.7)),
    );
  }
}
