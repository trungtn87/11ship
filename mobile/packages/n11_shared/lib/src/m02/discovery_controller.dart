import 'dart:async';

import 'package:flutter/foundation.dart';

import '../account/models.dart';
import '../flows/location.dart';
import 'discovery_models.dart';

// The state behind the Home discovery (M02-KP01), the filter sheet (KP03) and the search screen (KP02). Rules that matter:
//  - the area is chosen by the person (one area is chosen for them only when the server offers exactly one); nothing is guessed from GPS;
//  - the LATEST request wins: an answer for an older term / filter / area is dropped, so results never flash back from a previous term;
//  - data that was loaded stays on screen, marked "not up to date", when a refresh fails; a first load that fails is an error with a
//    retry, never an empty list;
//  - no sample shop, dish or area: only what the server returned.

enum DiscoveryLoad { idle, loading, ready, failed, notConnected }

class DiscoveryController extends ChangeNotifier {
  DiscoveryController({required this.api});

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
      if (areaId == null && _areas.length == 1) {
        areaId = _areas.single.id;
      }
      if (categoryId != null && categoryOf(categoryId!) == null) {
        categoryId = null;
      }
    } on FeatureNotConnected {
      _choices = DiscoveryLoad.notConnected;
    } on AuthFailure {
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
          categoryId: categoryId,
          openOnly: openOnly,
        ),
      );
      if (epoch != _epoch) {
        return;
      }
      _shops = page.items;
      _hasMore = page.hasMore;
      _list = DiscoveryLoad.ready;
      _stale = false;
    } on FeatureNotConnected {
      if (epoch == _epoch) {
        _list = DiscoveryLoad.notConnected;
      }
    } on AuthFailure {
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
        for (final ShopCardData s in page.items)
          if (!seen.contains(s.shopId)) s,
      ];
      _hasMore = page.hasMore;
      _stale = false;
    } on FeatureNotConnected {
      // unchanged
    } on AuthFailure {
      if (epoch == _epoch) {
        _stale = true;
      }
    }
    if (epoch == _epoch) {
      _loadingMore = false;
      _notify();
    }
  }

  /// The person picks an area (the list reloads inside it; the filters stay).
  Future<void> chooseArea(String id) async {
    areaId = id;
    _shops = const <ShopCardData>[];
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
    if (area != null) {
      areaId = area;
    }
    categoryId = category;
    openOnly = open;
    if (areaChanged) {
      _shops = const <ShopCardData>[];
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

/// One foreground fix for the current discovery visit, requested by the customer; no tracking.
class DiscoveryPosition extends ChangeNotifier {
  DiscoveryPosition({LocationProvider? provider})
    : provider = provider ?? MethodChannelLocationProvider();
  final LocationProvider provider;
  LocationFix? fix;
  bool loading = false;
  bool _disposed = false;
  Future<void> locate() async {
    if (loading) return;
    loading = true;
    fix = null;
    notifyListeners();
    try {
      final LocationFix found = await provider.currentFix();
      if (!_disposed) fix = found;
    } on LocationException {
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
  final DiscoveryApi api;
  final String areaId;
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
    if (!hasTerm || _disposed) return;
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
    // Each endpoint keeps its own raw offset: deduplicating cards must not skip pages.
    final DiscoveryQuery shopQuery = DiscoveryQuery(
      areaId: areaId,
      term: _term,
      offset: more ? _shopOffset : 0,
    );
    final DiscoveryQuery dishQuery = DiscoveryQuery(
      areaId: areaId,
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
            ...sp.items,
          ])
            s.shopId: s,
        }.values.toList();
        _moreShops = sp.hasMore;
      }
      if (dp != null) {
        _dishOffset = dishQuery.offset + dp.items.length;
        dishes = <String, DishHit>{
          for (final DishHit d in <DishHit>[if (more) ...dishes, ...dp.items])
            d.itemId: d,
        }.values.toList();
        _moreDishes = dp.hasMore;
      }
      state = DiscoveryLoad.ready;
      stale = false;
    } on FeatureNotConnected {
      if (epoch == _epoch) {
        if (more) {
          stale = true;
        } else {
          state = DiscoveryLoad.notConnected;
        }
      }
    } on AuthFailure {
      if (epoch == _epoch) {
        if (more) {
          stale = true;
        } else {
          state = DiscoveryLoad.failed;
        }
      }
    }
    if (epoch == _epoch) {
      loadingMore = false;
      _notify();
    }
  }
}
