import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/models.dart';
import '../flows/location.dart';
import 'discovery_models.dart';
import 'route_distance.dart';
import 'availability_refresh.dart';

// The state behind the Home discovery (M02-KP01), the filter sheet (KP03) and the search screen (KP02). Rules that matter:
//  - GPS areas come only from configured backend coverage; manual choices remain available when location fails;
//  - the LATEST request wins: an answer for an older term / filter / area is dropped, so results never flash back from a previous term;
//  - data that was loaded stays on screen, marked "not up to date", when a refresh fails; a first load that fails is an error with a
//    retry, never an empty list;
//  - no sample shop, dish or area: only what the server returned.

enum DiscoveryLoad { idle, loading, ready, failed, notConnected }

/// Issue #411: the ranking pool stops after the page that reaches this many shops. Pages are 30 (server max 50), so the pool holds at most 210.
const int kRankingPoolCap = 200;

class DiscoveryController extends ChangeNotifier {
  DiscoveryController({required this.api, DiscoveryPosition? position, RouteDistanceController? distances})
      : position = position ?? DiscoveryPosition(),
        distances = distances ?? RouteDistanceController(api: api);

  /// The road distances of the shop cards of Home AND Search (one cache, so the same shop shows the same number in both).
  final RouteDistanceController distances;

  final DiscoveryPosition position;
  bool outsideCoverage = false;
  bool manualArea = false;
  bool resolvingArea = false;
  bool areaResolutionFailed = false;
  bool _gpsResolved = false;
  int _areaEpoch = 0;

  /// One foreground attempt; denied/failed attempts require explicit retry, never repeated permission prompts.
  Future<void> locate({DiscoveryPosition? source, bool force = false}) async {
    final DiscoveryPosition gps = source ?? position;
    if (_disposed ||
        resolvingArea ||
        gps.loading ||
        (!force && !gps.needsRefresh)) {
      return;
    }
    resolvingArea = true;
    areaResolutionFailed = false;
    final int epoch = ++_areaEpoch;
    _notify();
    await gps.locate();
    if (_disposed || epoch != _areaEpoch) return;
    final LocationFix? fix = gps.fix;
    if (fix != null) {
      try {
        final AreaChoice? found =
            await api.resolveArea(fix.latitude, fix.longitude);
        if (_disposed || epoch != _areaEpoch) return;
        _gpsResolved = true;
        outsideCoverage = found == null;
        manualArea = false;
        if (found != null && !_areas.any((AreaChoice a) => a.id == found.id)) {
          _areas = <AreaChoice>[..._areas, found];
        }
        final String? next = found?.id;
        if (next != areaId || found == null) {
          areaId = next;
          distances.reset();
          _epoch++; // Invalidate an old area page, including loadMore.
          _shops = const <ShopCardData>[];
          _shopDishes = const <String, List<DishHit>>{};
          _dishesQueryKey = null;
          _hasMore = _loadingMore = _stale = false;
          _list = DiscoveryLoad.idle;
          _notify();
          if (next != null) await refresh();
        }
      } on AuthFailure {
      freshness.failed();
        if (!_disposed && epoch == _areaEpoch) areaResolutionFailed = true;
      } on FeatureNotConnected {
      freshness.failed();
        if (!_disposed && epoch == _areaEpoch) areaResolutionFailed = true;
      }
    }
    if (!_disposed && epoch == _areaEpoch) {
      resolvingArea = false;
      _notify();
    }
  }

  // No `invalidate`: going to the background or starting a reload says nothing about the data; `_stale` is set only by a refresh that failed.
  late final AvailabilityRefresh freshness = AvailabilityRefresh(refresh: refreshAvailability);
  Future<void> refreshAvailability() => refresh();
  final DiscoveryApi api;

  // Choices
  DiscoveryLoad _choices = DiscoveryLoad.idle;
  List<AreaChoice> _areas = const <AreaChoice>[];
  List<CategoryChoice> _categories = const <CategoryChoice>[];

  // Applied filters (what the list shows)
  String? areaId;
  String? categoryId;
  bool openOnly = false;

  // List
  DiscoveryLoad _list = DiscoveryLoad.idle;
  List<ShopCardData> _shops = const <ShopCardData>[];
  Map<String, List<DishHit>> _shopDishes = const <String, List<DishHit>>{};
  String? _dishesQueryKey;
  bool _hasMore = false;
  bool _loadingMore = false;
  bool _stale = false;
  int _epoch = 0;
  bool _disposed = false;

  DiscoveryLoad get choicesState => _choices;
  List<AreaChoice> get areas => _areas;
  List<CategoryChoice> get categories => _categories;
  DiscoveryLoad get listState => _list;
  List<ShopCardData> get shops => _shops;
  List<DishHit> dishesForShop(String shopId) =>
      _shopDishes[shopId] ?? const <DishHit>[];
  bool get hasMore => _hasMore;
  bool get loadingMore => _loadingMore;
  bool get stale => _stale;
  bool get filtersActive => categoryId != null || openOnly;

  AreaChoice? get area {
    for (final AreaChoice a in _areas) {
      if (a.id == areaId) {
        return a;
      }
    }
    return null;
  }

  CategoryChoice? categoryOf(String id) {
    for (final CategoryChoice c in _categories) {
      if (c.id == id) {
        return c;
      }
    }
    return null;
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    freshness.dispose();
    position.dispose();
    super.dispose();
  }

  /// Opens the screen: areas and groups, then the shops of the chosen area.
  Future<void> start() async {
    if (_choices == DiscoveryLoad.loading) {
      return;
    }
    _choices = DiscoveryLoad.loading;
    _notify();
    try {
      final List<List<Object>> got = await Future.wait<List<Object>>(
        <Future<List<Object>>>[api.areas(), api.categories()],
      );
      _areas = got[0].cast<AreaChoice>();
      _categories = got[1].cast<CategoryChoice>();
      _choices = DiscoveryLoad.ready;
      if (areaId != null && area == null) {
        areaId = null;
      }
      if (!_gpsResolved && areaId == null && _areas.length == 1) {
        // One-area fallback is only for browsing; it is not a GPS-verified location.
        areaId = _areas.single.id;
        manualArea = true;
      }
      if (categoryId != null && categoryOf(categoryId!) == null) {
        categoryId = null;
      }
    } on FeatureNotConnected {
      freshness.failed();
      _choices = DiscoveryLoad.notConnected;
    } on AuthFailure {
      freshness.failed();
      _choices = DiscoveryLoad.failed;
    }
    _notify();
    if (_choices == DiscoveryLoad.ready && areaId != null) {
      await refresh();
    }
  }

  /// Pull to refresh / "Thử lại": the first page again.
  Future<void> refresh() async {
    final String? chosen = areaId;
    if (chosen == null) {
      return;
    }
    final String? activeCategory = categoryId;
    final bool activeOpenOnly = openOnly;
    final String queryKey = '$chosen|${activeCategory ?? ''}|$activeOpenOnly';
    if (_dishesQueryKey != queryKey) {
      _dishesQueryKey = queryKey;
      _shopDishes = const <String, List<DishHit>>{};
    }
    final int epoch = ++_epoch;
    _loadingMore = false;
    if (_shops.isEmpty || _list == DiscoveryLoad.failed) {
      _list = DiscoveryLoad.loading;
    }
    _notify();
    try {
      final DiscoveryPage<ShopCardData> page = await api.shops(
        DiscoveryQuery(
          areaId: chosen,
          categoryId: activeCategory,
          openOnly: activeOpenOnly,
        ),
      );
      if (epoch != _epoch) {
        return;
      }
      _shops = onlyPublic(page.items);
      freshness.arm(page.nextRefreshMs);
      _hasMore = page.hasMore;
      _list = DiscoveryLoad.ready;
      _stale = false;
      unawaited(
        _loadShopDishes(
          area: chosen,
          category: activeCategory,
          open: activeOpenOnly,
          epoch: epoch,
        ),
      );
    } on FeatureNotConnected {
      freshness.failed();
      if (epoch == _epoch) {
        _stale = _shops.isNotEmpty;
        _list = _shops.isNotEmpty ? DiscoveryLoad.ready : DiscoveryLoad.notConnected;
      }
    } on AuthFailure {
      freshness.failed();
      if (epoch != _epoch) {
        return;
      }
      if (_list == DiscoveryLoad.ready || _shops.isNotEmpty) {
        _stale = true;
        _list = DiscoveryLoad.ready;
      } else {
        _list = DiscoveryLoad.failed;
      }
    }
    _notify();
  }

  Future<void> _loadShopDishes({
    required String area,
    required String? category,
    required bool open,
    required int epoch,
  }) async {
    try {
      final DiscoveryPage<DishHit> page = await api.dishes(
        DiscoveryQuery(
          areaId: area,
          categoryId: category,
          openOnly: open,
          limit: 50,
        ),
      );
      if (_disposed || epoch != _epoch) {
        return;
      }
      final Map<String, List<DishHit>> grouped = <String, List<DishHit>>{};
      for (final DishHit dish in page.items) {
        if (!dish.shop.isPublic) {
          continue;
        }
        grouped.putIfAbsent(dish.shop.shopId, () => <DishHit>[]).add(dish);
      }
      for (final MapEntry<String, List<DishHit>> entry in grouped.entries) {
        entry.value.sort((DishHit a, DishHit b) {
          final int cmp = (b.soldCount ?? -1).compareTo(a.soldCount ?? -1);
          return cmp != 0 ? cmp : a.name.compareTo(b.name);
        });
        if (entry.value.length > 3) {
          grouped[entry.key] = entry.value.sublist(0, 3);
        }
      }
      _shopDishes = grouped;
      _notify();
    } on Object {
      // Dish chips are supplementary; an unwired or failing dish endpoint never blocks shop cards.
    }
  }

  Future<void> loadMore() async {
    final String? chosen = areaId;
    if (chosen == null ||
        !_hasMore ||
        _loadingMore ||
        _list != DiscoveryLoad.ready) {
      return;
    }
    final int epoch = _epoch;
    _loadingMore = true;
    _notify();
    try {
      final DiscoveryPage<ShopCardData> page = await api.shops(
        DiscoveryQuery(
          areaId: chosen,
          categoryId: categoryId,
          openOnly: openOnly,
          offset: _shops.length,
        ),
      );
      if (epoch != _epoch) {
        return;
      }
      final Set<String> seen = _shops.map((ShopCardData s) => s.shopId).toSet();
      _shops = <ShopCardData>[
        ..._shops,
        for (final ShopCardData s in onlyPublic(page.items))
          if (!seen.contains(s.shopId)) s,
      ];
      _hasMore = page.hasMore;
      _stale = false;
    } on FeatureNotConnected {
      freshness.failed();
      // unchanged
    } on AuthFailure {
      // A failed next page does not make the first page outdated.
      freshness.failed();
    }
    if (epoch == _epoch) {
      _loadingMore = false;
      _notify();
    }
  }

  /// Issue #411: "Quán nổi bật" and the no-GPS "Quán gần bạn" rank by the rating of the WHOLE list, so the next pages are read up to
  /// [kRankingPoolCap] shops (a stated limit, not the whole area). Stops when the list ends, when the cap is reached, or when a page adds
  /// nothing (failure or another load in progress), so it never loops.
  Future<void> fillRankingPool() async {
    final int epoch = _epoch;
    while (epoch == _epoch && _hasMore && _shops.length < kRankingPoolCap) {
      final int before = _shops.length;
      await loadMore();
      if (epoch != _epoch || _shops.length == before) {
        break;
      }
    }
  }

  /// The person picks an area (the list reloads inside it; the filters stay).
  Future<void> chooseArea(String id) async {
    if (!_areas.any((AreaChoice area) => area.id == id)) return;
    _areaEpoch++;
    resolvingArea = false;
    manualArea = true;
    areaId = id;
    distances.reset();
    _shops = const <ShopCardData>[];
    _shopDishes = const <String, List<DishHit>>{};
    _dishesQueryKey = null;
    _hasMore = false;
    _list = DiscoveryLoad.idle;
    _stale = false;
    await refresh();
  }

  /// A category chip on the Home page (the same as the sheet's group): chosen again clears it.
  Future<void> toggleCategory(String id) async {
    categoryId = categoryId == id ? null : id;
    await refresh();
  }

  /// "Áp dụng" of the filter sheet: area, group and open-only at once.
  Future<void> apply({
    required String? area,
    required String? category,
    required bool open,
  }) async {
    final bool areaChanged = area != null && area != areaId;
    if (areaChanged) {
      _areaEpoch++;
      resolvingArea = false;
      manualArea = true;
    }
    if (area != null) {
      areaId = area;
    }
    categoryId = category;
    openOnly = open;
    if (areaChanged) {
      distances.reset();
      _shops = const <ShopCardData>[];
      _shopDishes = const <String, List<DishHit>>{};
      _dishesQueryKey = null;
      _hasMore = false;
      _list = DiscoveryLoad.idle;
    }
    await refresh();
  }

  /// "Đặt lại": clears the group and the open-only switch and keeps the current area.
  Future<void> reset() async {
    categoryId = null;
    openOnly = false;
    await refresh();
  }
}

/// One foreground fix, shared across Home and search; no tracking or delivery-address mutation.
class DiscoveryPosition extends ChangeNotifier {
  DiscoveryPosition({LocationProvider? provider})
      : provider = provider ?? MethodChannelLocationProvider();
  final LocationProvider provider;
  LocationFix? fix;
  bool loading = false;
  DateTime? attemptedAt;
  LocationFailure? failure;
  bool get needsRefresh =>
      attemptedAt == null ||
      (failure == null &&
          DateTime.now().difference(attemptedAt!) >=
              const Duration(minutes: 5));
  bool _disposed = false;
  Future<void> locate() async {
    if (loading) return;
    loading = true;
    attemptedAt = DateTime.now();
    failure = null;
    fix = null;
    notifyListeners();
    try {
      final LocationFix found = await provider.currentFix();
      if (!_disposed) fix = found;
    } on LocationException catch (error) {
      failure = error.failure;
      // Unknown stays unknown; never substitute a saved address or map center.
    } finally {
      loading = false;
      if (!_disposed) notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Both public name searches run together, independently of the Home filters.
class DishSearchController extends ChangeNotifier {
  DishSearchController({
    required this.api,
    required this.areaId,
    String? categoryId,
    bool openOnly = false,
    this.debounce = const Duration(milliseconds: 350),
  });
  // No `invalidate`: see DiscoveryController; `stale` is set only by a failed first-page refresh.
  late final AvailabilityRefresh freshness = AvailabilityRefresh(refresh: refreshAvailability);
  Future<void> refreshAvailability() => run();
  final DiscoveryApi api;
  String? areaId;
  void setArea(String? id) {
    if (id == areaId) return;
    areaId = id;
    _epoch++;
    _timer?.cancel();
    shops = <ShopCardData>[];
    dishes = <DishHit>[];
    _moreShops = _moreDishes = loadingMore = stale = false;
    state = DiscoveryLoad.idle;
    _notify();
    if (id != null && hasTerm) unawaited(run());
  }

  final Duration debounce;
  String _term = '';
  List<ShopCardData> shops = <ShopCardData>[];
  List<DishHit> dishes = <DishHit>[];
  DiscoveryLoad state = DiscoveryLoad.idle;
  bool stale = false;
  bool loadingMore = false;
  bool _moreShops = false;
  bool _moreDishes = false;
  int _shopOffset = 0;
  int _dishOffset = 0;
  int _epoch = 0;
  bool _disposed = false;
  Timer? _timer;
  String get term => _term;
  bool get hasTerm => _term.trim().isNotEmpty;
  bool get hasMore => _moreShops || _moreDishes;
  List<ShopCardData> get groupedShops {
    final Map<String, ShopCardData> unique = <String, ShopCardData>{
      for (final ShopCardData shop in shops) shop.shopId: shop,
    };
    for (final DishHit dish in dishes) {
      unique.putIfAbsent(dish.shop.shopId, () => dish.shop);
    }
    return unique.values.toList();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    freshness.dispose();
    _epoch++;
    _timer?.cancel();
    super.dispose();
  }

  void setTerm(String value) {
    if (value == _term) return;
    _term = value;
    _epoch++;
    _timer?.cancel();
    shops = <ShopCardData>[];
    dishes = <DishHit>[];
    _moreShops = _moreDishes = loadingMore = stale = false;
    state = hasTerm ? DiscoveryLoad.loading : DiscoveryLoad.idle;
    _notify();
    if (hasTerm) _timer = Timer(debounce, run);
  }

  Future<void> run() async {
    if (!hasTerm || _disposed || areaId == null) return;
    _timer?.cancel();
    final int epoch = ++_epoch;
    loadingMore = false;
    state = DiscoveryLoad.loading;
    _notify();
    await _fetch(epoch, more: false);
  }

  Future<void> loadMore() async {
    if (!hasTerm || !hasMore || loadingMore || state != DiscoveryLoad.ready) {
      return;
    }
    loadingMore = true;
    _notify();
    await _fetch(_epoch, more: true);
  }

  Future<void> _fetch(int epoch, {required bool more}) async {
    final String? chosen = areaId;
    if (chosen == null) return;
    // Each endpoint keeps its own raw offset: deduplicating cards must not skip pages.
    final DiscoveryQuery shopQuery = DiscoveryQuery(
      areaId: chosen,
      term: _term,
      offset: more ? _shopOffset : 0,
    );
    final DiscoveryQuery dishQuery = DiscoveryQuery(
      areaId: chosen,
      term: _term,
      offset: more ? _dishOffset : 0,
    );
    try {
      final List<Object?> pages = await Future.wait<Object?>(<Future<Object?>>[
        !more || _moreShops ? api.shops(shopQuery) : Future<Object?>.value(),
        !more || _moreDishes ? api.dishes(dishQuery) : Future<Object?>.value(),
      ]);
      if (epoch != _epoch || _disposed) return;
      final DiscoveryPage<ShopCardData>? sp =
          pages[0] as DiscoveryPage<ShopCardData>?;
      final DiscoveryPage<DishHit>? dp = pages[1] as DiscoveryPage<DishHit>?;
      if (sp != null) {
        _shopOffset = shopQuery.offset + sp.items.length;
        shops = <String, ShopCardData>{
          for (final ShopCardData s in <ShopCardData>[
            if (more) ...shops,
            ...onlyPublic(sp.items),
          ])
            s.shopId: s,
        }.values.toList();
        _moreShops = sp.hasMore;
      }
      if (dp != null) {
        _dishOffset = dishQuery.offset + dp.items.length;
        dishes = <String, DishHit>{
          for (final DishHit d in <DishHit>[if (more) ...dishes, ...dp.items.where((DishHit d) => d.shop.isPublic)])
            d.itemId: d,
        }.values.toList();
        _moreDishes = dp.hasMore;
      }
      state = DiscoveryLoad.ready;
      stale = false;
      if (!more) freshness.arm(sp?.nextRefreshMs ?? dp?.nextRefreshMs);
    } on FeatureNotConnected {
      freshness.failed();
      // A failed next page ("more") does not make the first page outdated.
      if (epoch == _epoch && !more) {
        state = DiscoveryLoad.notConnected;
      }
    } on AuthFailure {
      freshness.failed();
      if (epoch == _epoch && !more) {
        state = DiscoveryLoad.failed;
      }
    }
    if (epoch == _epoch) {
      loadingMore = false;
      _notify();
    }
  }
}
