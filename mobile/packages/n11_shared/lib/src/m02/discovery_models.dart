import 'dart:math' as math;

import '../flows/location.dart';

import 'package:flutter/foundation.dart';

import 'menu_models.dart' show FeatureNotConnected;

export 'menu_models.dart' show FeatureNotConnected;

// M02 discovery (docs/current/M02-discovery-UI-LOCKED-20261016.md): the areas and groups a customer chooses from, the shops of an area,
// the dishes, the search and the filters. A port, like MenuApi: the screens show only what it returned. The HTTP implementation is in
// http_m02_api.dart; the unwired one says "not connected".

@immutable
class AreaChoice {
  const AreaChoice({required this.id, required this.name});

  final String id;
  final String name;
}

@immutable
class CategoryChoice {
  const CategoryChoice({required this.id, required this.name});

  final String id;
  final String name;
}

@immutable
class ShopCardData {
  const ShopCardData({
    required this.shopId,
    required this.name,
    required this.address,
    required this.reason,
    this.logoUrl,
    this.ratingAverage,
    this.ratingCount = 0,
    this.latitude,
    this.longitude,
  });

  final double? ratingAverage;
  final int ratingCount;
  final double? latitude;
  final double? longitude;
  /// The STRAIGHT-LINE distance (Haversine). Issue #190: it is never the distance a card shows as a route; it exists only to be shown as a
  /// reference labelled "đường chim bay" when the road is unknown. The road distance comes from [RouteDistanceController].
  double? straightLineKm(LocationFix? fix) {
    if (fix == null || latitude == null || longitude == null) return null;
    double rad(double n) => n * math.pi / 180;
    final double a =
        math.pow(math.sin(rad(latitude! - fix.latitude) / 2), 2).toDouble() +
        math.cos(rad(fix.latitude)) *
            math.cos(rad(latitude!)) *
            math.pow(math.sin(rad(longitude! - fix.longitude) / 2), 2);
    return 6371 * 2 * math.asin(math.sqrt(a.clamp(0, 1)));
  }

  final String? logoUrl;
  final String shopId;
  final String name;
  final String address;

  /// ONLINE / OUTSIDE_BUSINESS_HOURS, as the server computed it (a shop in any other state is not listed).
  final String reason;

  bool get open => reason == 'ONLINE';

  /// Issue #190: customers see a shop only when the server says it is set up: open now, or closed by its schedule. Any other reason
  /// (no schedule, locked, not set up) comes from an older server or a stale list and is never drawn.
  bool get isPublic => reason == 'ONLINE' || reason == 'OUTSIDE_BUSINESS_HOURS';
}

/// The cards a customer may be shown (see [ShopCardData.isPublic]).
List<ShopCardData> onlyPublic(Iterable<ShopCardData> shops) => <ShopCardData>[for (final ShopCardData s in shops) if (s.isPublic) s];

@immutable
class DishHit {
  const DishHit({
    required this.itemId,
    required this.name,
    required this.priceVnd,
    required this.imageUrl,
    required this.shop,
    this.soldCount,
  });

  final String itemId;
  final String name;
  final int priceVnd;
  final int? soldCount;
  final String? imageUrl;
  final ShopCardData shop;
}

@immutable
class DiscoveryPage<T> {
  const DiscoveryPage({required this.items, required this.hasMore, this.nextRefreshMs});

  final List<T> items;
  final bool hasMore;
  final int? nextRefreshMs;
}

/// What is asked of the server: always inside ONE area; [term] is what the person typed (the server folds case and marks).
@immutable
class DiscoveryQuery {
  const DiscoveryQuery({
    required this.areaId,
    this.categoryId,
    this.openOnly = false,
    this.term = '',
    this.offset = 0,
    this.limit = 30,
  });

  final String areaId;
  final String? categoryId;
  final bool openOnly;
  final String term;
  final int offset;
  final int limit;

  DiscoveryQuery next(int newOffset) => DiscoveryQuery(
    areaId: areaId,
    categoryId: categoryId,
    openOnly: openOnly,
    term: term,
    offset: newOffset,
    limit: limit,
  );
}

/// Throws [AuthFailure] (no answer / refusal) or [FeatureNotConnected].
abstract class DiscoveryApi {
  /// Issue #190: the road distance in metres from the position to the pickup point of each shop (null = not known), keyed by shop id. The shops
  /// the server does not mention are simply absent. Throws [AuthFailure] or [FeatureNotConnected].
  Future<Map<String, int?>> routeDistances(double latitude, double longitude, List<String> shopIds);

  Future<AreaChoice?> resolveArea(double latitude, double longitude);
  Future<List<AreaChoice>> areas();
  Future<List<CategoryChoice>> categories();
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query);
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query);
}

class UnwiredDiscoveryApi implements DiscoveryApi {
  const UnwiredDiscoveryApi();

  @override
  Future<Map<String, int?>> routeDistances(double latitude, double longitude, List<String> shopIds) =>
      Future<Map<String, int?>>.error(const FeatureNotConnected());

  @override
  Future<AreaChoice?> resolveArea(double latitude, double longitude) =>
      Future<AreaChoice?>.error(const FeatureNotConnected());

  @override
  Future<List<AreaChoice>> areas() =>
      Future<List<AreaChoice>>.error(const FeatureNotConnected());

  @override
  Future<List<CategoryChoice>> categories() =>
      Future<List<CategoryChoice>>.error(const FeatureNotConnected());

  @override
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query) =>
      Future<DiscoveryPage<ShopCardData>>.error(const FeatureNotConnected());

  @override
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query) =>
      Future<DiscoveryPage<DishHit>>.error(const FeatureNotConnected());
}
