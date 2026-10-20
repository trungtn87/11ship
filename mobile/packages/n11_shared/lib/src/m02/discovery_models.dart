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
  const ShopCardData({required this.shopId, required this.name, required this.address, required this.reason, this.logoUrl});

  final String? logoUrl;
  final String shopId;
  final String name;
  final String address;

  /// ONLINE / OUTSIDE_BUSINESS_HOURS / NO_BUSINESS_HOURS, as the server computed it.
  final String reason;

  bool get open => reason == 'ONLINE';
}

@immutable
class DishHit {
  const DishHit({required this.itemId, required this.name, required this.priceVnd, required this.imageUrl, required this.shop, this.soldCount});

  final String itemId;
  final String name;
  final int priceVnd;
  final int? soldCount;
  final String? imageUrl;
  final ShopCardData shop;
}

@immutable
class DiscoveryPage<T> {
  const DiscoveryPage({required this.items, required this.hasMore});

  final List<T> items;
  final bool hasMore;
}

/// What is asked of the server: always inside ONE area; [term] is what the person typed (the server folds case and marks).
@immutable
class DiscoveryQuery {
  const DiscoveryQuery({required this.areaId, this.categoryId, this.openOnly = false, this.term = '', this.offset = 0, this.limit = 30});

  final String areaId;
  final String? categoryId;
  final bool openOnly;
  final String term;
  final int offset;
  final int limit;

  DiscoveryQuery next(int newOffset) => DiscoveryQuery(areaId: areaId, categoryId: categoryId, openOnly: openOnly, term: term, offset: newOffset, limit: limit);
}

/// Throws [AuthFailure] (no answer / refusal) or [FeatureNotConnected].
abstract class DiscoveryApi {
  Future<List<AreaChoice>> areas();
  Future<List<CategoryChoice>> categories();
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query);
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query);
}

class UnwiredDiscoveryApi implements DiscoveryApi {
  const UnwiredDiscoveryApi();

  @override
  Future<List<AreaChoice>> areas() => Future<List<AreaChoice>>.error(const FeatureNotConnected());

  @override
  Future<List<CategoryChoice>> categories() => Future<List<CategoryChoice>>.error(const FeatureNotConnected());

  @override
  Future<DiscoveryPage<ShopCardData>> shops(DiscoveryQuery query) => Future<DiscoveryPage<ShopCardData>>.error(const FeatureNotConnected());

  @override
  Future<DiscoveryPage<DishHit>> dishes(DiscoveryQuery query) => Future<DiscoveryPage<DishHit>>.error(const FeatureNotConnected());
}
